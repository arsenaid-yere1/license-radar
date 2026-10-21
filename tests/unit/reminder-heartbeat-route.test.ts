import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  recoveryClaim: vi.fn(),
  recoveryBegin: vi.fn(),
  recoveryRecord: vi.fn(),
  recordCheck: vi.fn(),
  recoveryExpire: vi.fn(),
  send: vi.fn(),
  sendRecovery: vi.fn(),
  gmailConfig: vi.fn(),
  gmailAuthorize: vi.fn(),
  gmailReady: vi.fn(),
  gmailBegin: vi.fn(),
  gmailRecord: vi.fn(),
  gmailExpire: vi.fn(),
}));
vi.mock("@/lib/reminders/config", () => ({
  emailConfig: boundary.config,
  emailWebhookConfig: boundary.webhook,
  reminderWorkerSecret: boundary.secret,
}));
vi.mock("@/lib/reminders/email-provider", () => ({
  createEmailProvider: boundary.provider,
}));
vi.mock("@/lib/reminders/gmail-config", async (original) => ({
  ...(await original<typeof import("@/lib/reminders/gmail-config")>()),
  gmailConfig: boundary.gmailConfig,
}));
vi.mock("@/lib/reminders/gmail-provider", () => ({
  authorizeGmail: boundary.gmailAuthorize,
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
  claimReminderRecovery: boundary.recoveryClaim,
  beginReminderRecovery: boundary.recoveryBegin,
  recordReminderRecovery: boundary.recoveryRecord,
  recordReminderCheck: boundary.recordCheck,
  expireReminderRecovery: boundary.recoveryExpire,
  gmailReminderReadiness: boundary.gmailReady,
  beginGmailReminder: boundary.gmailBegin,
  recordGmailReminder: boundary.gmailRecord,
  expireGmailReminders: boundary.gmailExpire,
}));
import { POST as run } from "@/app/api/reminders/run/route";
const id = "10000000-0000-4000-8000-000000000001";
const config = {
  mode: "fixture",
  namespace: "fixture",
  from: "reminders@example.test",
  replyTo: "support@example.test",
  appUrl: "http://127.0.0.1:3000",
  apiKey: "fixture-only",
  baseUrl: "http://127.0.0.1:55326",
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
  boundary.recoveryExpire.mockResolvedValue(0);
  boundary.gmailExpire.mockResolvedValue(0);
  boundary.drain.mockResolvedValue(0);
  boundary.reconcile.mockResolvedValue({ scanned: 0 });
  boundary.claim.mockResolvedValue({ status: "idle" });
  boundary.recoveryClaim.mockResolvedValue({ status: "idle" });
  boundary.finish.mockResolvedValue(true);
  boundary.provider.mockReturnValue({
    retrieve: boundary.retrieve,
    send: boundary.send,
    sendRecovery: boundary.sendRecovery,
  });
});
afterEach(() => vi.unstubAllEnvs());
const monitorUrl = "https://hc-ping.com/10000000-0000-4000-8000-000000000001";
const network = vi.fn();
beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("EMAIL_PROVIDER_FIXTURE", undefined);
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "true");
  vi.stubEnv("REMINDER_HEALTHCHECK_ENABLED", "true");
  vi.stubEnv("REMINDER_HEALTHCHECK_URL", monitorUrl);
  vi.stubGlobal("fetch", network);
  network.mockResolvedValue(new Response("OK"));
  boundary.gmailConfig.mockReturnValue({
    ...config,
    binding: { subject: "verified" },
  });
  boundary.gmailAuthorize.mockResolvedValue({ send: boundary.send });
  boundary.gmailReady.mockResolvedValue(4);
});
afterEach(() => vi.unstubAllGlobals());
function request(auth = "Bearer fixture-secret", body?: string) {
  return new Request("https://example.com/api/reminders/run", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body,
  });
}
it("SA01 SA08 real Gmail and Resend route adapters ping only after successful persistence", async () => {
  for (const provider of ["gmail", "resend"]) {
    vi.clearAllMocks();
    vi.stubEnv("EMAIL_PROVIDER", provider);
    expect((await run(request())).status).toBe(200);
    expect(network).toHaveBeenCalledExactlyOnceWith(
      monitorUrl,
      expect.objectContaining({ method: "POST" }),
    );
    expect(boundary.finish.mock.invocationCallOrder[0]).toBeLessThan(
      network.mock.invocationCallOrder[0],
    );
    expect(boundary.send).not.toHaveBeenCalled();
  }
});
it("SA02 rejected requests and failed operations cannot claim live health through either real adapter", async () => {
  for (const provider of ["gmail", "resend"]) {
    vi.stubEnv("EMAIL_PROVIDER", provider);
    for (const mode of ["auth", "body", "finish", "storage", "disabled"]) {
      vi.clearAllMocks();
      boundary.finish.mockResolvedValue(mode !== "finish");
      boundary.storage.mockReturnValue(mode !== "storage");
      vi.stubEnv("EMAIL_REMINDERS_ENABLED", String(mode !== "disabled"));
      const response = await run(
        request(
          mode === "auth" ? "wrong" : "Bearer fixture-secret",
          mode === "body" ? "{" : undefined,
        ),
      );
      expect(response.status).toBe(
        mode === "disabled"
          ? 200
          : mode === "auth"
            ? 401
            : mode === "body"
              ? 400
              : 503,
      );
      expect(network).not.toHaveBeenCalled();
    }
  }
});
it("SA05 monitor transport failures leave the real endpoint contract private and complete", async () => {
  for (const provider of ["gmail", "resend"]) {
    vi.clearAllMocks();
    vi.stubEnv("EMAIL_PROVIDER", provider);
    network.mockRejectedValueOnce(Error(monitorUrl));
    const response = await run(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      status: "complete",
      counts: {
        scanned: 0,
        accounts: 0,
        expired: 0,
        submitted: 0,
        accepted: 0,
        failed: 0,
        uncertain: 0,
      },
    });
    expect(body).not.toContain(monitorUrl);
    expect(network).toHaveBeenCalledTimes(1);
    expect(boundary.finish).toHaveBeenCalledTimes(1);
  }
});
