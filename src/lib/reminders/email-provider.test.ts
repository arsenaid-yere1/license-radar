import { afterEach, expect, it, vi } from "vitest";
import { createEmailProvider } from "./email-provider";
import type { EmailConfig } from "./config";
import type { EmailSubmission } from "./messages";
import { submissionSchema } from "./messages";
const attemptId = "ad2304c4-fcb0-4624-95be-3beaf983c041",
  providerId = "c8a1bbaf-3d82-444e-bdae-f205f4d5039c";
const config: EmailConfig = {
  mode: "live",
  namespace: "fixture-team",
  from: "reminders@example.com",
  replyTo: "support@example.com",
  appUrl: "https://example.com",
  baseUrl: "https://api.resend.com",
  apiKey: "re_fixture-only",
  webhookSecret: "fixture-only",
};
const submission: EmailSubmission = {
  status: "submit",
  attemptId,
  token: "10000000-0000-4000-8000-000000000002",
  key: `reminder-email/${attemptId}`,
  payload: {
    from: config.from,
    to: ["fixture@example.test"],
    reply_to: config.replyTo,
    subject: "Credential renewal reminder: 60 days",
    text: "Sign in to review your record.",
    html: "<p>Sign in to review your record.</p>",
    tags: [{ name: "reminder_attempt", value: attemptId }],
  },
};
afterEach(() => vi.unstubAllGlobals());
it("EP01 one POST carries exactly the frozen payload, opaque tag and idempotency key", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ id: providerId }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetcher);
  expect(await createEmailProvider(config).send(submission)).toEqual({
    outcome: "accepted",
    providerId,
    error: null,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect(options).toMatchObject({
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": submission.key,
    },
  });
  expect(JSON.parse(options.body)).toEqual(submission.payload);
  expect(options.signal).toBeInstanceOf(AbortSignal);
});
it("EP05 fixture transport stays fixed and oversized responses/lookup failures never authorize a resend", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ id: providerId })));
  vi.stubGlobal("fetch", fetcher);
  await createEmailProvider({
    ...config,
    mode: "fixture",
    baseUrl: "https://attacker.invalid",
  }).send(submission);
  expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:55326/emails");
  for (const status of [400, 408, 409, 429, 500, 302]) {
    fetcher.mockResolvedValue(new Response("{}", { status }));
    expect((await createEmailProvider(config).send(submission)).outcome).toBe(
      status === 400 ? "failed" : "uncertain",
    );
  }
  fetcher.mockResolvedValue(new Response("x".repeat(65537)));
  expect(await createEmailProvider(config).send(submission)).toEqual({
    outcome: "uncertain",
    providerId: null,
    error: "invalid-response",
  });
  fetcher.mockResolvedValue(new Response("{}", { status: 404 }));
  await expect(
    createEmailProvider(config).retrieve(providerId),
  ).rejects.toThrow();
});
it("EP02 provider rejection is permanent for this consumed attempt, while timeout and malformed acceptance are uncertain", async () => {
  for (const [response, outcome, error] of [
    [new Response("{}", { status: 422 }), "failed", "provider-rejected"],
    [new Response("{}", { status: 500 }), "uncertain", "provider-unavailable"],
    [new Response("{}", { status: 429 }), "uncertain", "provider-unavailable"],
    [
      new Response(JSON.stringify({ id: "untrusted" }), { status: 200 }),
      "uncertain",
      "invalid-response",
    ],
    [
      new Response("not-json", { status: 200 }),
      "uncertain",
      "invalid-response",
    ],
  ] as const) {
    const fetcher = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetcher);
    expect(await createEmailProvider(config).send(submission)).toEqual({
      outcome,
      providerId: null,
      error,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));
  vi.stubGlobal("fetch", fetcher);
  expect(await createEmailProvider(config).send(submission)).toEqual({
    outcome: "uncertain",
    providerId: null,
    error: "provider-unavailable",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("EP03 retrieval only accepts UUID paths and never repeats or follows a redirect", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ id: providerId }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetcher);
  expect(await createEmailProvider(config).retrieve(providerId)).toEqual({
    id: providerId,
  });
  expect(fetcher).toHaveBeenCalledWith(
    `https://api.resend.com/emails/${providerId}`,
    expect.objectContaining({
      method: "GET",
      redirect: "error",
      cache: "no-store",
    }),
  );
  await expect(
    createEmailProvider(config).retrieve("../domains"),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("EP04 dispatch schema rejects extra destinations, altered guard tags, keys and optional provider scheduling", () => {
  expect(submissionSchema.safeParse(submission).success).toBe(true);
  for (const bad of [
    { ...submission, key: "foreign" },
    {
      ...submission,
      payload: {
        ...submission.payload,
        to: [...submission.payload.to, "another@example.test"],
      },
    },
    {
      ...submission,
      payload: {
        ...submission.payload,
        tags: [{ name: "reminder_attempt", value: providerId }],
      },
    },
    {
      ...submission,
      payload: { ...submission.payload, scheduled_at: "2030-01-01" },
    },
  ])
    expect(submissionSchema.safeParse(bad).success).toBe(false);
});
