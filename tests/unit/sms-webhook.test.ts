import { expect, test, vi } from "vitest";
import twilio from "twilio";
import { handleSmsWebhook } from "@/lib/sms/webhook";
const config = {
  accountSid: `AC${"1".repeat(32)}`,
  messagingServiceSid: `MG${"2".repeat(32)}`,
  authToken: "local-callback-fixture-only",
  url: "https://app.example.test/api/sms/twilio/inbound",
  senders: ["+12025550000"],
};
const fields = {
  AccountSid: config.accountSid,
  MessagingServiceSid: config.messagingServiceSid,
  MessageSid: `SM${"4".repeat(32)}`,
  From: "+12025550123",
  To: config.senders[0],
  OptOutType: "STOP",
  Body: "sensitive",
};
function request(
  values: Record<string, string> = fields,
  options: {
    signature?: string;
    url?: string;
    body?: string;
    type?: string;
    length?: string;
  } = {},
) {
  return new Request("https://untrusted-host.example/ignore", {
    method: "POST",
    headers: {
      "Content-Type":
        options.type ?? "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Twilio-Signature":
        options.signature ??
        twilio.getExpectedTwilioSignature(
          config.authToken,
          options.url ?? config.url,
          values,
        ),
      ...(options.length ? { "Content-Length": options.length } : {}),
    },
    body: options.body ?? new URLSearchParams(values).toString(),
  });
}
test("STOP is signed and globally terminal", async () => {
  const persist = vi.fn().mockResolvedValue({ status: "success" });
  const response = await handleSmsWebhook(request(), config, persist);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("<Response/>");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toBe("text/xml; charset=utf-8");
  expect(persist).toHaveBeenCalledExactlyOnceWith(
    config.accountSid,
    config.messagingServiceSid,
    fields.From,
    fields.MessageSid,
    "STOP",
  );
});
test("START and HELP never restore consent", async () => {
  const persist = vi.fn().mockResolvedValue({ status: "success" });
  for (const type of ["START", "HELP"])
    expect(
      (
        await handleSmsWebhook(
          request({ ...fields, OptOutType: type }),
          config,
          persist,
        )
      ).status,
    ).toBe(200);
  const { OptOutType, ...ordinary } = fields;
  void OptOutType;
  expect(
    (await handleSmsWebhook(request(ordinary), config, persist)).status,
  ).toBe(200);
  expect(persist).toHaveBeenCalledTimes(2);
});
test("Hostile callbacks fail before persistence", async () => {
  const persist = vi.fn();
  for (const options of [
    { signature: "bad" },
    { signature: "" },
    { url: "https://wrong.example/" },
    { body: new URLSearchParams(fields).toString() + "&From=%2B19999999999" },
    { type: "application/json" },
    { length: "16385" },
    { body: "x".repeat(16385) },
  ]) {
    expect(
      (await handleSmsWebhook(request(fields, options), config, persist))
        .status,
    ).toBeGreaterThanOrEqual(400);
  }
  for (const patch of [
    { AccountSid: `AC${"9".repeat(32)}` },
    { MessagingServiceSid: `MG${"9".repeat(32)}` },
    { MessageSid: "bad" },
    { From: "bad" },
    { To: "+19999999999" },
    { OptOutType: "bad" },
  ])
    expect(
      (
        await handleSmsWebhook(
          request({ ...fields, ...patch }),
          config,
          persist,
        )
      ).status,
    ).toBe(403);
  expect(persist).not.toHaveBeenCalled();
});
test("Callback storage failure is retryable", async () => {
  const persist = vi.fn().mockResolvedValue(null);
  expect((await handleSmsWebhook(request(), null, persist)).status).toBe(503);
  expect(persist).not.toHaveBeenCalled();
  expect((await handleSmsWebhook(request(), config, persist)).status).toBe(503);
  persist.mockResolvedValueOnce({ status: "conflict" });
  const conflict = await handleSmsWebhook(request(), config, persist);
  expect(conflict.status).toBe(503);
  expect(await conflict.text()).toBe("");
  persist.mockRejectedValueOnce(new Error("private failure"));
  expect((await handleSmsWebhook(request(), config, persist)).status).toBe(503);
  persist.mockResolvedValue({ status: "success" });
  expect((await handleSmsWebhook(request(), config, persist)).status).toBe(200);
  const noBody = new Request(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  expect((await handleSmsWebhook(noBody, config, persist)).status).toBe(400);
});
test("Callback body bounds and media normalization are exact", async () => {
  const persist = vi.fn().mockResolvedValue({ status: "success" });
  const padded = { ...fields, Padding: "" };
  padded.Padding = "x".repeat(
    16384 - new URLSearchParams(padded).toString().length,
  );
  expect(
    new TextEncoder().encode(new URLSearchParams(padded).toString()),
  ).toHaveLength(16384);
  expect(
    (
      await handleSmsWebhook(
        request(padded, {
          length: "16384",
          type: " APPLICATION/X-WWW-FORM-URLENCODED ; charset=UTF-8",
        }),
        config,
        persist,
      )
    ).status,
  ).toBe(200);
  expect(persist).toHaveBeenCalledTimes(1);
  expect(
    (
      await handleSmsWebhook(
        request(padded, {
          body: new URLSearchParams({
            ...padded,
            Padding: padded.Padding + "x",
          }).toString(),
        }),
        config,
        persist,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handleSmsWebhook(
        request(fields, { length: "16385" }),
        config,
        persist,
      )
    ).status,
  ).toBe(413);
  const split = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(8000)));
      controller.enqueue(new TextEncoder().encode("x".repeat(8385)));
      controller.close();
    },
  });
  const streamed = {
    headers: new Headers({
      "Content-Type": "application/x-www-form-urlencoded",
    }),
    body: split,
  } as unknown as Request;
  expect((await handleSmsWebhook(streamed, config, persist)).status).toBe(400);
  expect(persist).toHaveBeenCalledTimes(1);
});
test("Callback message and source syntax rejects anchored lookalikes", async () => {
  const persist = vi.fn();
  for (const key of ["MessageSid", "From"] as const)
    for (const value of [`x${fields[key]}`, `${fields[key]}x`])
      expect(
        (
          await handleSmsWebhook(
            request({ ...fields, [key]: value }),
            config,
            persist,
          )
        ).status,
      ).toBe(403);
  expect(persist).not.toHaveBeenCalled();
});
test("Invalid UTF-8 and broken streams fail before signature or persistence", async () => {
  const persist = vi.fn();
  const malformed = new Request(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new Uint8Array([0xc0, 0xaf]),
  });
  expect((await handleSmsWebhook(malformed, config, persist)).status).toBe(400);
  const broken = {
    headers: new Headers({
      "Content-Type": "application/x-www-form-urlencoded",
    }),
    body: {
      getReader: () => ({
        read: async () => {
          throw new Error("connection lost");
        },
      }),
    },
  } as unknown as Request;
  expect((await handleSmsWebhook(broken, config, persist)).status).toBe(400);
  expect(persist).not.toHaveBeenCalled();
});
