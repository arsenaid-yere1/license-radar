import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Webhook } from "svix";
const boundary = vi.hoisted(() => ({
  config: vi.fn(),
  webhook: vi.fn(),
  secret: vi.fn(),
  provider: vi.fn(),
  storage: vi.fn(),
  start: vi.fn(),
  expire: vi.fn(),
  drain: vi.fn(),
  reconcile: vi.fn(),
  claim: vi.fn(),
  begin: vi.fn(),
  record: vi.fn(),
  finish: vi.fn(),
  binding: vi.fn(),
  event: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock("@/lib/reminders/config", () => ({
  emailConfig: boundary.config,
  emailWebhookConfig: boundary.webhook,
  reminderWorkerSecret: boundary.secret,
}));
vi.mock("@/lib/reminders/email-provider", () => ({
  createEmailProvider: boundary.provider,
}));
vi.mock("@/lib/sms/privileged-repository", () => ({
  reminderStorageConfigured: boundary.storage,
  startReminderRun: boundary.start,
  expireReminderSubmissions: boundary.expire,
  drainReminderAccounts: boundary.drain,
  reconcileReminderJobs: boundary.reconcile,
  claimReminderJob: boundary.claim,
  beginReminderSubmission: boundary.begin,
  recordReminderSubmission: boundary.record,
  finishReminderRun: boundary.finish,
  findReminderBinding: boundary.binding,
  applyReminderEvent: boundary.event,
}));
import { POST as run } from "@/app/api/reminders/run/route";
import { POST as webhook } from "@/app/api/reminders/email/webhook/route";
const id = "10000000-0000-4000-8000-000000000001";
const config = {
  namespace: "fixture",
  from: "reminders@example.test",
  webhookSecret:
    "whsec_" +
    Buffer.from("fixture-signing-secret-e4-s2-only!").toString("base64"),
};
beforeEach(() => {
  vi.resetAllMocks();
  boundary.secret.mockReturnValue("fixture-secret");
  boundary.config.mockReturnValue(config);
  boundary.webhook.mockReturnValue(config);
  boundary.storage.mockReturnValue(true);
  boundary.start.mockResolvedValue(id);
  boundary.expire.mockResolvedValue(0);
  boundary.drain.mockResolvedValue(0);
  boundary.reconcile.mockResolvedValue({ scanned: 0 });
  boundary.claim.mockResolvedValue({ status: "idle" });
  boundary.finish.mockResolvedValue(true);
  boundary.provider.mockReturnValue({
    retrieve: boundary.retrieve,
    send: vi.fn(),
  });
});
afterEach(() => vi.unstubAllEnvs());
it("AR01 the real worker route authenticates before storage and independently enables sending", async () => {
  const request = (auth = "Bearer fixture-secret") =>
    new Request("http://127.0.0.1", {
      method: "POST",
      headers: { Authorization: auth },
    });
  expect((await run(request("wrong"))).status).toBe(401);
  expect(boundary.storage).not.toHaveBeenCalled();
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "false");
  expect((await run(request())).status).toBe(200);
  expect(boundary.expire).toHaveBeenCalledOnce();
  expect(boundary.config).not.toHaveBeenCalled();
  expect(boundary.provider).not.toHaveBeenCalled();
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "true");
  expect((await run(request())).status).toBe(200);
  expect(boundary.config).toHaveBeenCalledOnce();
  expect(boundary.reconcile).toHaveBeenCalledWith("fixture");
});
it("AR02 the real callback route uses resource lookup when signed tags are absent, including when sending is off", async () => {
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "false");
  const data = {
    email_id: id,
    from: config.from,
    to: ["fixture@example.test"],
  };
  const body = JSON.stringify({ type: "email.sent", data }),
    when = new Date(),
    eventId = "evt_fixture_route";
  const request = () =>
    new Request("http://127.0.0.1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": eventId,
        "svix-timestamp": String(Math.floor(when.getTime() / 1000)),
        "svix-signature": new Webhook(config.webhookSecret).sign(
          eventId,
          when,
          body,
        ),
      },
      body,
    });
  boundary.binding
    .mockResolvedValueOnce({ status: "missing" })
    .mockResolvedValue({
      attemptId: id,
      providerId: null,
      from: config.from,
      to: data.to,
    });
  boundary.retrieve.mockResolvedValue({
    id,
    from: config.from,
    to: data.to,
    tags: [{ name: "reminder_attempt", value: id }],
  });
  boundary.event.mockResolvedValue({ status: "recorded" });
  expect((await webhook(request())).status).toBe(200);
  expect(boundary.provider).toHaveBeenCalledWith(config);
  expect(boundary.retrieve).toHaveBeenCalledWith(id);
  expect(boundary.event).toHaveBeenCalledWith(
    "fixture",
    eventId,
    id,
    id,
    "sent",
    config.from,
    data.to[0],
  );
  boundary.webhook.mockReturnValue(null);
  expect((await webhook(request())).status).toBe(503);
  expect(boundary.retrieve).toHaveBeenCalledOnce();
});
