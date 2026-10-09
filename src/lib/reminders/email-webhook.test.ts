import { expect, it, vi } from "vitest";
import { Webhook } from "svix";
import { handleEmailWebhook } from "./email-webhook";
import type { EmailConfig } from "./config";
const attemptId = "ad2304c4-fcb0-4624-95be-3beaf983c041",
  providerId = "c8a1bbaf-3d82-444e-bdae-f205f4d5039c";
const config: EmailConfig = {
  mode: "fixture",
  namespace: "fixture-reminders",
  from: "reminders@example.test",
  replyTo: "support@example.test",
  appUrl: "http://127.0.0.1:3000",
  baseUrl: "http://127.0.0.1:55326",
  apiKey: "fixture-key",
  webhookSecret:
    "whsec_" +
    Buffer.from("fixture-signing-secret-e4-s2-only!").toString("base64"),
};
const data = {
  email_id: providerId,
  from: config.from,
  to: ["fixture@example.test"],
  tags: { reminder_attempt: attemptId },
};
const event = { type: "email.delivered", data };
function signed(
  value: unknown = event,
  when = new Date(),
  mutate?: (body: string) => string,
) {
  const body = JSON.stringify(value, null, 2),
    id = "evt_fixture_e4_s2",
    signature = new Webhook(config.webhookSecret).sign(id, when, body);
  return new Request("http://127.0.0.1:3000/api/reminders/email/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(when.getTime() / 1000)),
      "svix-signature": signature,
    },
    body: mutate ? mutate(body) : body,
  });
}
function services() {
  return {
    binding: vi.fn().mockResolvedValue({
      attemptId,
      providerId: null,
      from: config.from,
      to: data.to,
    }),
    retrieve: vi.fn().mockResolvedValue({
      id: providerId,
      from: config.from,
      to: data.to,
      tags: [{ name: "reminder_attempt", value: attemptId }],
    }),
    persist: vi.fn().mockResolvedValue({ status: "recorded" }),
  };
}
it("EH01 authentic raw bytes bind the consumed attempt and persist only sanitized event fields", async () => {
  const s = services(),
    response = await handleEmailWebhook(signed(), config, s);
  expect(response.status).toBe(200);
  expect(s.persist).toHaveBeenCalledWith(
    config.namespace,
    "evt_fixture_e4_s2",
    providerId,
    attemptId,
    "delivered",
    config.from,
    data.to[0],
  );
  expect(s.retrieve).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("EH09 header bounds, signed malformed JSON, unsupported methods and private conflict replies are exact", async () => {
  const badId = signed();
  const oversizedId = "x".repeat(257),
    oversizedWhen = new Date();
  badId.headers.set("svix-id", oversizedId);
  badId.headers.set(
    "svix-signature",
    new Webhook(config.webhookSecret).sign(
      oversizedId,
      oversizedWhen,
      JSON.stringify(event, null, 2),
    ),
  );
  expect((await handleEmailWebhook(badId, config, services())).status).toBe(
    403,
  );
  const id = "x".repeat(256),
    body = "invalid-json",
    when = new Date(),
    signature = new Webhook(config.webhookSecret).sign(id, when, body);
  const request = new Request("http://127.0.0.1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(when.getTime() / 1000)),
      "svix-signature": signature,
    },
    body,
  });
  expect((await handleEmailWebhook(request, config, services())).status).toBe(
    400,
  );
  expect(
    (
      await handleEmailWebhook(
        new Request("http://127.0.0.1"),
        config,
        services(),
      )
    ).status,
  ).toBe(405);
  const unsupported = signed();
  unsupported.headers.set("content-type", "text/plain");
  expect(
    (await handleEmailWebhook(unsupported, config, services())).status,
  ).toBe(415);
  expect((await handleEmailWebhook(signed(), null, services())).status).toBe(
    503,
  );
  for (const status of ["invalid", "conflict"]) {
    const s = services();
    s.persist.mockResolvedValue({ status });
    expect((await handleEmailWebhook(signed(), config, s)).status).toBe(400);
  }
  for (const header of ["svix-timestamp", "svix-signature"]) {
    const absent = signed();
    absent.headers.delete(header);
    expect((await handleEmailWebhook(absent, config, services())).status).toBe(
      403,
    );
  }
});
it("EH10 known provider IDs and mismatched attempt tags cannot invent a binding", async () => {
  const withoutTag = () =>
    signed({ type: "email.delivered", data: { ...data, tags: undefined } });
  const s = services();
  expect((await handleEmailWebhook(withoutTag(), config, s)).status).toBe(400);
  s.binding.mockResolvedValue({
    attemptId,
    providerId,
    from: config.from,
    to: data.to,
  });
  expect((await handleEmailWebhook(withoutTag(), config, s)).status).toBe(200);
  expect(s.retrieve).not.toHaveBeenCalled();
  s.binding.mockResolvedValue({
    attemptId: "6e7540ed-dfaa-4738-9b22-abb0b555c333",
    providerId,
    from: config.from,
    to: data.to,
  });
  expect((await handleEmailWebhook(signed(), config, s)).status).toBe(400);
});
it("EH11 resource fallback validates each bound field, ignores unrelated mail and rejects duplicate/malformed tags", async () => {
  for (const [patch, status] of [
    [{ id: attemptId }, 400],
    [{ from: "foreign@example.test" }, 400],
    [{ to: ["foreign@example.test"] }, 400],
    [{ tags: [{ name: "other", value: "x" }] }, 200],
    [{ tags: [{ name: "reminder_attempt", value: "bad" }] }, 400],
    [
      {
        tags: [
          { name: "reminder_attempt", value: attemptId },
          { name: "reminder_attempt", value: attemptId },
        ],
      },
      400,
    ],
  ] as const) {
    const s = services();
    s.binding.mockResolvedValue({ status: "missing" });
    s.retrieve.mockResolvedValue({
      id: providerId,
      from: config.from,
      to: data.to,
      tags: [
        { name: "other", value: "x" },
        { name: "reminder_attempt", value: attemptId },
      ],
      ...patch,
    });
    expect(
      (
        await handleEmailWebhook(
          signed({
            type: "email.delivered",
            data: { ...data, tags: undefined },
          }),
          config,
          s,
        )
      ).status,
    ).toBe(status);
    expect(s.persist).not.toHaveBeenCalled();
  }
});
it("EH12 all signed unknown types including object prototype names are ignored, and an empty app tag is malformed", async () => {
  for (const type of ["__proto__", "constructor", "toString", "email.opened"]) {
    const s = services();
    expect((await handleEmailWebhook(signed({ type }), config, s)).status).toBe(
      200,
    );
    expect(s.binding).not.toHaveBeenCalled();
  }
  expect(
    (
      await handleEmailWebhook(
        signed({
          type: "email.delivered",
          data: { ...data, tags: { reminder_attempt: "" } },
        }),
        config,
        services(),
      )
    ).status,
  ).toBe(400);
});
it("EH02 tampering, reformatted raw bytes, absent signatures and stale timestamps are rejected before storage", async () => {
  for (const request of [
    signed(event, new Date(), (body) => body + " "),
    signed(event, new Date(), (body) => JSON.stringify(JSON.parse(body))),
    signed(event, new Date(Date.now() - 360000)),
    signed(event, new Date(Date.now() + 360000)),
    new Request("http://127.0.0.1/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }),
  ]) {
    const s = services();
    expect((await handleEmailWebhook(request, config, s)).status).toBe(403);
    expect(s.binding).not.toHaveBeenCalled();
    expect(s.persist).not.toHaveBeenCalled();
  }
});
it("EH03 oversized and invalid UTF-8 streams fail before signature or database access", async () => {
  for (const body of [new Uint8Array([0xff]), new Uint8Array(65537)]) {
    const s = services();
    const request = new Request("http://127.0.0.1/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect((await handleEmailWebhook(request, config, s)).status).toBe(
      body.length > 65536 ? 413 : 400,
    );
    expect(s.binding).not.toHaveBeenCalled();
  }
});
it("EH04 a missing tag uses provider resource tags; unknown app attempts request retry", async () => {
  const s = services();
  s.binding.mockResolvedValueOnce({ status: "missing" }).mockResolvedValue({
    attemptId,
    providerId: null,
    from: config.from,
    to: data.to,
  });
  expect(
    (
      await handleEmailWebhook(
        signed({ type: "email.sent", data: { ...data, tags: undefined } }),
        config,
        s,
      )
    ).status,
  ).toBe(200);
  expect(s.retrieve).toHaveBeenCalledWith(providerId);
  expect(s.binding).toHaveBeenLastCalledWith(
    config.namespace,
    providerId,
    attemptId,
  );
  const pending = services();
  pending.binding.mockResolvedValue({ status: "missing" });
  expect((await handleEmailWebhook(signed(), config, pending)).status).toBe(
    503,
  );
  expect(pending.persist).not.toHaveBeenCalled();
});
it("EH05 another message, sender, recipient or malformed tag never binds to this attempt", async () => {
  for (const altered of [
    { ...data, from: "foreign@example.test" },
    { ...data, to: ["foreign@example.test"] },
    { ...data, to: [...data.to, "extra@example.test"] },
    { ...data, tags: { reminder_attempt: "bad-id" } },
  ]) {
    const s = services();
    expect(
      (
        await handleEmailWebhook(
          signed({ type: "email.delivered", data: altered }),
          config,
          s,
        )
      ).status,
    ).toBe(400);
    expect(s.persist).not.toHaveBeenCalled();
  }
  const s = services();
  s.binding.mockResolvedValue({
    attemptId,
    providerId: "6e7540ed-dfaa-4738-9b22-abb0b555c333",
    from: config.from,
    to: data.to,
  });
  expect((await handleEmailWebhook(signed(), config, s)).status).toBe(400);
  expect(s.persist).not.toHaveBeenCalled();
});
it("EH06 unknown signed types are ignored; provider callbacks stay usable with sending switched off", async () => {
  const s = services();
  expect(
    (await handleEmailWebhook(signed({ type: "email.opened" }), config, s))
      .status,
  ).toBe(200);
  expect(s.binding).not.toHaveBeenCalled();
  expect(s.persist).not.toHaveBeenCalled();
  expect((await handleEmailWebhook(signed(), config, services())).status).toBe(
    200,
  );
});
it("EH07 storage and lookup failures are retryable without a partial event commit", async () => {
  const lost = services();
  lost.persist.mockResolvedValue(null);
  expect((await handleEmailWebhook(signed(), config, lost)).status).toBe(503);
  const unavailable = services();
  unavailable.binding.mockResolvedValue(null);
  expect((await handleEmailWebhook(signed(), config, unavailable)).status).toBe(
    503,
  );
  expect(unavailable.retrieve).not.toHaveBeenCalled();
  const lookup = services();
  lookup.binding.mockResolvedValue({ status: "missing" });
  lookup.retrieve.mockRejectedValue(new Error("lookup timeout"));
  expect(
    (
      await handleEmailWebhook(
        signed({ type: "email.delivered", data: { ...data, tags: undefined } }),
        config,
        lookup,
      )
    ).status,
  ).toBe(503);
  expect(lookup.persist).not.toHaveBeenCalled();
});
it("EH08 permanent bounce, complaint and suppression are distinct, while untrusted bounce classification cannot globally suppress", async () => {
  for (const [type, extra, status] of [
    ["email.bounced", { bounce: { type: "Permanent" } }, "bounced"],
    ["email.bounced", { bounce: { type: "Transient" } }, "failed"],
    ["email.complained", {}, "complained"],
    ["email.suppressed", {}, "suppressed"],
    ["email.delivery_delayed", {}, "delayed"],
    ["email.failed", {}, "failed"],
  ] as const) {
    const s = services();
    expect(
      (
        await handleEmailWebhook(
          signed({ type, data: { ...data, ...extra } }),
          config,
          s,
        )
      ).status,
    ).toBe(200);
    expect(s.persist).toHaveBeenCalledWith(
      config.namespace,
      expect.any(String),
      providerId,
      attemptId,
      status,
      config.from,
      data.to[0],
    );
  }
});

it("EH13 malformed opaque attempt tags stop before privileged lookup even when storage cannot find them", async () => {
  for (const reminder_attempt of ["", "bad-id"]) {
    const s = services();
    s.binding.mockResolvedValue({ status: "missing" });
    expect(
      (
        await handleEmailWebhook(
          signed({
            type: "email.delivered",
            data: { ...data, tags: { reminder_attempt } },
          }),
          config,
          s,
        )
      ).status,
    ).toBe(400);
    expect(s.binding).not.toHaveBeenCalled();
    expect(s.retrieve).not.toHaveBeenCalled();
  }
});
