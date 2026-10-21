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
import { POST as webhook } from "@/app/api/reminders/email/webhook/route";
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
  expect(boundary.provider).toHaveBeenCalledWith(config);
  expect(boundary.recoveryClaim).toHaveBeenCalledWith("fixture", false);
  expect(boundary.send).not.toHaveBeenCalled();
  expect(boundary.sendRecovery).not.toHaveBeenCalled();
  expect(boundary.recoveryExpire).toHaveBeenCalledOnce();
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "true");
  expect((await run(request())).status).toBe(200);
  expect(boundary.config).toHaveBeenCalledOnce();
  expect(boundary.reconcile).toHaveBeenCalledWith("fixture");
  expect(boundary.recoveryClaim).toHaveBeenLastCalledWith("fixture", true);
  expect(boundary.claim).not.toHaveBeenCalled();
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

const attemptId = "10000000-0000-4000-8000-000000000002";
const token = "10000000-0000-4000-8000-000000000003";
const submissionId = "10000000-0000-4000-8000-000000000004";
const providerId = "10000000-0000-4000-8000-000000000005";
const checkId = "10000000-0000-4000-8000-000000000006";
const payload = {
  from: config.from,
  to: ["fixture-recipient@example.test"],
  reply_to: config.replyTo,
  subject: "Credential renewal reminder: 60 days",
  text: "Frozen reminder",
  html: "<p>Frozen reminder</p>",
  tags: [{ name: "reminder_attempt", value: attemptId }],
};
const accepted = {
  kind: "accepted",
  providerId,
  errorCode: null,
  retryAfterSeconds: null,
};
function workerRequest() {
  return new Request("http://127.0.0.1", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-secret" },
  });
}
function permission(ordinal = 1) {
  return {
    status: "submit",
    attemptId,
    token,
    submissionId,
    ordinal,
    key: `reminder-email/${attemptId}`,
    payload,
    deadline: new Date(Date.now() + 60000).toISOString(),
    expiresAt: new Date(Date.now() + 23 * 3600000).toISOString(),
  };
}
function checkClaim() {
  return {
    kind: "check",
    attemptId,
    token,
    checkId,
    providerId,
    from: config.from,
    to: payload.to[0],
    deadline: permission().deadline,
  };
}
function gmailRoute() {
  vi.stubEnv("EMAIL_PROVIDER", "gmail");
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "true");
  const gmail = {
    namespace: "gmail-pilot",
    from: "fixture@gmail.com",
    replyTo: "fixture@gmail.com",
    appUrl: "https://example.com",
    binding: { subject: "verified-subject" },
  };
  boundary.gmailConfig.mockReturnValue(gmail);
  boundary.gmailAuthorize.mockResolvedValue({ send: boundary.send });
  boundary.gmailReady.mockResolvedValue(2);
  boundary.claim.mockResolvedValueOnce({ jobId: id, token });
  boundary.gmailBegin.mockResolvedValue({
    status: "submit",
    attemptId,
    token,
    key: `reminder-email/${attemptId}`,
    payload: {
      ...payload,
      from: gmail.from,
      reply_to: gmail.replyTo,
      to: [gmail.from],
    },
    deadline: new Date(Date.now() + 30000).toISOString(),
  });
  boundary.gmailRecord.mockResolvedValue({ status: "recorded" });
  boundary.send.mockResolvedValue({
    outcome: "accepted",
    providerId: "19a8df",
    error: null,
  });
  return gmail;
}
it("GM03 the Gmail route verifies identity and durable authority before one POST and preserves Resend observation namespace", async () => {
  const gmail = gmailRoute();
  expect((await run(workerRequest())).status).toBe(200);
  expect(boundary.gmailAuthorize).toHaveBeenCalledExactlyOnceWith(gmail);
  expect(boundary.gmailReady).toHaveBeenCalledWith(gmail);
  expect(boundary.gmailBegin).toHaveBeenCalledExactlyOnceWith(
    id,
    token,
    {
      namespace: gmail.namespace,
      from: gmail.from,
      replyTo: gmail.replyTo,
      appUrl: gmail.appUrl,
    },
    "verified-subject",
    2,
  );
  expect(boundary.gmailRecord).toHaveBeenCalledExactlyOnceWith(
    attemptId,
    token,
    { outcome: "accepted", providerId: "19a8df", error: null },
  );
  expect(boundary.send).toHaveBeenCalledTimes(1);
  expect(boundary.sendRecovery).not.toHaveBeenCalled();
  expect(boundary.recoveryClaim).toHaveBeenCalledWith(config.namespace, false);
});
it("GM01 Gmail sends off still expire without authorizing Google or consuming permission", async () => {
  gmailRoute();
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "false");
  expect((await run(workerRequest())).status).toBe(200);
  expect(boundary.gmailExpire).toHaveBeenCalledOnce();
  expect(boundary.gmailAuthorize).not.toHaveBeenCalled();
  expect(boundary.claim).not.toHaveBeenCalled();
  expect(boundary.send).not.toHaveBeenCalled();
  expect(boundary.recoveryClaim).toHaveBeenCalledWith(config.namespace, false);
});
it("GM01 GM05 invalid configuration, authorization, authority or expiry fails before Gmail begin", async () => {
  for (const stage of [
    "gmailConfig",
    "gmailAuthorize",
    "gmailReady",
    "gmailExpire",
  ] as const) {
    vi.clearAllMocks();
    gmailRoute();
    boundary.claim.mockReset().mockResolvedValue({ status: "idle" });
    if (stage === "gmailAuthorize")
      boundary[stage].mockRejectedValueOnce(Error("private"));
    else boundary[stage].mockReturnValueOnce(null);
    expect((await run(workerRequest())).status).toBe(503);
    expect(boundary.gmailBegin).not.toHaveBeenCalled();
    expect(boundary.claim).not.toHaveBeenCalled();
    expect(boundary.send).not.toHaveBeenCalled();
  }
});
it("GM05 an unavailable authorized transport never claims a Gmail job", async () => {
  gmailRoute();
  boundary.gmailAuthorize.mockResolvedValue(undefined);
  expect((await run(workerRequest())).status).toBe(503);
  expect(boundary.claim).not.toHaveBeenCalled();
  expect(boundary.send).not.toHaveBeenCalled();
});
it("GM04 missing Gmail permission or recording acknowledgement never repeats the POST", async () => {
  for (const stage of ["gmailBegin", "gmailRecord"] as const) {
    vi.clearAllMocks();
    gmailRoute();
    boundary.claim
      .mockReset()
      .mockResolvedValueOnce({ jobId: id, token })
      .mockResolvedValue({ status: "idle" });
    boundary[stage].mockResolvedValueOnce(null);
    expect((await run(workerRequest())).status).toBe(503);
    expect(boundary.send).toHaveBeenCalledTimes(
      stage === "gmailRecord" ? 1 : 0,
    );
    expect(boundary[stage]).toHaveBeenCalledOnce();
  }
});

it("DR03 the real worker route uses fresh and retry reservation contracts while preserving the frozen message", async () => {
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "true");
  for (const [kind, ordinal] of [
    ["fresh", 1],
    ["retry", 2],
  ] as const) {
    vi.clearAllMocks();
    boundary.recoveryClaim.mockResolvedValueOnce({ kind, jobId: id, token });
    boundary.recoveryBegin.mockResolvedValue(permission(ordinal));
    boundary.sendRecovery.mockResolvedValue(accepted);
    boundary.recoveryRecord.mockResolvedValue({ status: "recorded" });
    expect((await run(workerRequest())).status).toBe(200);
    expect(boundary.recoveryBegin).toHaveBeenCalledExactlyOnceWith(
      id,
      token,
      {
        namespace: config.namespace,
        from: config.from,
        replyTo: config.replyTo,
        appUrl: config.appUrl,
      },
      kind,
    );
    expect(boundary.sendRecovery).toHaveBeenCalledExactlyOnceWith({
      status: "submit",
      attemptId,
      token,
      key: `reminder-email/${attemptId}`,
      payload,
    });
    expect(boundary.recoveryRecord).toHaveBeenCalledExactlyOnceWith(
      submissionId,
      token,
      accepted,
    );
    expect(boundary.begin).not.toHaveBeenCalled();
    expect(boundary.record).not.toHaveBeenCalled();
    expect(boundary.send).not.toHaveBeenCalled();
  }
});

it("DR14 sending-off route retrieves known delivery resources and ignores every POST work kind", async () => {
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "false");
  boundary.recoveryClaim
    .mockResolvedValueOnce({ kind: "fresh", jobId: id, token })
    .mockResolvedValueOnce({ kind: "retry", jobId: id, token })
    .mockResolvedValueOnce(checkClaim());
  boundary.retrieve.mockResolvedValue({
    id: providerId,
    from: config.from,
    to: payload.to,
    tags: payload.tags,
    last_event: "delivered",
  });
  boundary.recordCheck.mockResolvedValue({ status: "recorded" });
  expect((await run(workerRequest())).status).toBe(200);
  expect(boundary.recoveryClaim).toHaveBeenCalledWith(config.namespace, false);
  expect(boundary.retrieve).toHaveBeenCalledExactlyOnceWith(providerId);
  expect(boundary.recordCheck).toHaveBeenCalledExactlyOnceWith(checkId, token, {
    status: "delivered",
    bounced: false,
    matched: true,
  });
  expect(boundary.config).not.toHaveBeenCalled();
  expect(boundary.drain).not.toHaveBeenCalled();
  expect(boundary.reconcile).not.toHaveBeenCalled();
  expect(boundary.recoveryBegin).not.toHaveBeenCalled();
  expect(boundary.sendRecovery).not.toHaveBeenCalled();
  expect(boundary.send).not.toHaveBeenCalled();
});

it("DR14 incomplete lookup/send configuration permits no external operations or guessed reservations", async () => {
  for (const [sending, sendConfig, lookupConfig, status] of [
    [false, config, null, 200],
    [true, config, null, 200],
    [true, null, config, 503],
    [true, null, null, 503],
  ] as const) {
    vi.clearAllMocks();
    vi.stubEnv("EMAIL_REMINDERS_ENABLED", String(sending));
    boundary.config.mockReturnValue(sendConfig);
    boundary.webhook.mockReturnValue(lookupConfig);
    expect((await run(workerRequest())).status).toBe(status);
    expect(boundary.provider).not.toHaveBeenCalled();
    expect(boundary.recoveryClaim).not.toHaveBeenCalled();
    expect(boundary.recoveryBegin).not.toHaveBeenCalled();
    expect(boundary.retrieve).not.toHaveBeenCalled();
    expect(boundary.sendRecovery).not.toHaveBeenCalled();
    expect(boundary.send).not.toHaveBeenCalled();
  }
});

it("DR08 lost recovery claim, permission or result acknowledgements return 503 without POST replay", async () => {
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "true");
  for (const stage of [
    "recoveryClaim",
    "recoveryBegin",
    "recoveryRecord",
  ] as const) {
    vi.clearAllMocks();
    boundary.recoveryClaim.mockReset().mockResolvedValue({ status: "idle" });
    if (stage !== "recoveryClaim")
      boundary.recoveryClaim.mockResolvedValueOnce({
        kind: "fresh",
        jobId: id,
        token,
      });
    boundary.recoveryBegin.mockResolvedValue(permission());
    boundary.sendRecovery.mockResolvedValue(accepted);
    boundary.recoveryRecord.mockResolvedValue({ status: "recorded" });
    boundary[stage].mockResolvedValueOnce(null);
    expect((await run(workerRequest())).status).toBe(503);
    expect(boundary.sendRecovery).toHaveBeenCalledTimes(
      stage === "recoveryRecord" ? 1 : 0,
    );
    expect(boundary[stage]).toHaveBeenCalledTimes(1);
    expect(boundary.finish).toHaveBeenCalledWith(id, false, expect.any(Object));
    // The next scheduler run sees durable work state rather than replaying the missing reply.
    expect((await run(workerRequest())).status).toBe(200);
    expect(boundary.sendRecovery).toHaveBeenCalledTimes(
      stage === "recoveryRecord" ? 1 : 0,
    );
    expect(boundary.send).not.toHaveBeenCalled();
  }
});

it("DR08 lost GET recording returns 503 and no repeated retrieval or send", async () => {
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "false");
  boundary.recoveryClaim.mockResolvedValueOnce(checkClaim());
  boundary.retrieve.mockResolvedValue({
    id: providerId,
    from: config.from,
    to: payload.to,
    tags: payload.tags,
    last_event: "delivered",
  });
  boundary.recordCheck.mockResolvedValue(null);
  expect((await run(workerRequest())).status).toBe(503);
  expect((await run(workerRequest())).status).toBe(200);
  expect(boundary.retrieve).toHaveBeenCalledOnce();
  expect(boundary.recordCheck).toHaveBeenCalledOnce();
  expect(boundary.sendRecovery).not.toHaveBeenCalled();
});

it("DR14 both expiry protocols are bounded prerequisites and counts retain their combined evidence", async () => {
  vi.stubEnv("EMAIL_REMINDERS_ENABLED", "false");
  boundary.expire.mockResolvedValue(1);
  boundary.recoveryExpire.mockResolvedValue(2);
  const response = await run(workerRequest());
  expect(response.status).toBe(200);
  expect((await response.json()).counts.expired).toBe(3);
  boundary.recoveryExpire.mockResolvedValue(null);
  vi.clearAllMocks();
  expect((await run(workerRequest())).status).toBe(503);
  expect(boundary.provider).not.toHaveBeenCalled();
  expect(boundary.recoveryClaim).not.toHaveBeenCalled();
});
