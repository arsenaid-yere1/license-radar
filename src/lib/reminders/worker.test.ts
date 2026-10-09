import { expect, it, vi } from "vitest";
import { handleReminderRun, type ReminderServices } from "./worker";
import type { EmailConfig } from "./config";
const id = "f9cbb616-4856-4787-b4f2-734e731059cb",
  token = "10000000-0000-4000-8000-000000000002";
const config: EmailConfig = {
  mode: "fixture",
  namespace: "fixture-reminders",
  from: "reminders@example.test",
  replyTo: "support@example.test",
  appUrl: "http://127.0.0.1:3000",
  baseUrl: "http://127.0.0.1:55326",
  apiKey: "fixture-key",
  webhookSecret: "fixture-key",
};
const submission = {
  status: "submit",
  attemptId: id,
  token,
  key: `reminder-email/${id}`,
  payload: {
    from: config.from,
    to: ["fixture@example.test"],
    reply_to: config.replyTo,
    subject: "Credential renewal reminder: 60 days",
    text: "Sign in",
    html: "<p>Sign in</p>",
    tags: [{ name: "reminder_attempt", value: id }],
  },
};
function services() {
  const send = vi
    .fn()
    .mockResolvedValue({ outcome: "accepted", providerId: id, error: null });
  const s = {
    secret: "fixture-worker-secret",
    sendingEnabled: true as boolean,
    config: vi.fn(() => config),
    storageConfigured: vi.fn(() => true),
    provider: vi.fn(() => ({ send, retrieve: vi.fn() })),
    start: vi.fn().mockResolvedValue(id),
    expire: vi.fn().mockResolvedValue(1),
    drain: vi.fn().mockResolvedValue(2),
    reconcile: vi.fn().mockResolvedValue({ scanned: 3, accounts: 0 }),
    claim: vi.fn().mockResolvedValue({ jobId: id, token }),
    begin: vi.fn().mockResolvedValue(submission),
    record: vi.fn().mockResolvedValue({ status: "recorded" }),
    finish: vi.fn().mockResolvedValue(true),
    now: () => 0,
  } satisfies ReminderServices;
  return { s, send };
}
function request(
  body = "",
  authorization = "Bearer fixture-worker-secret",
  method = "POST",
) {
  return new Request("http://127.0.0.1:3000/api/reminders/run", {
    method,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    ...(method === "POST" ? { body } : {}),
  });
}
it("EW01 bearer and method failures happen before configuration, storage and provider calls", async () => {
  for (const [auth, method, status] of [
    ["wrong", "POST", 401],
    ["Bearer fixture-worker-secret", "GET", 405],
  ] as const) {
    const { s, send } = services();
    expect((await handleReminderRun(request("", auth, method), s)).status).toBe(
      status,
    );
    expect(s.config).not.toHaveBeenCalled();
    expect(s.start).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  }
});
it("EW02 callers cannot supply job, tenant, time, sender or destination overrides", async () => {
  for (const body of [
    '{"jobId":"foreign"}',
    '{"now":"2030-01-01"}',
    "[]",
    "null",
    "bad-json",
    "x".repeat(1025),
  ]) {
    const { s, send } = services();
    expect((await handleReminderRun(request(body), s)).status).toBe(
      body.length > 1024 ? 413 : 400,
    );
    expect(s.start).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  }
});
it("EW03 disabled sending still sweeps expired attempts without accessing provider configuration", async () => {
  const { s, send } = services();
  s.sendingEnabled = false;
  const response = await handleReminderRun(request(), s);
  expect(response.status).toBe(200);
  expect(s.expire).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
  expect(s.config).not.toHaveBeenCalled();
  expect(s.finish).toHaveBeenCalledWith(
    id,
    true,
    expect.objectContaining({ expired: 1, submitted: 0 }),
  );
});
it("EW04 each observed first-submit authorizes one POST, at most four sequential sends", async () => {
  const { s, send } = services();
  const response = await handleReminderRun(request("{}"), s);
  expect(response.status).toBe(200);
  expect(send).toHaveBeenCalledTimes(4);
  expect(s.record).toHaveBeenCalledTimes(4);
  expect(s.begin).toHaveBeenCalledWith(id, token, {
    namespace: config.namespace,
    from: config.from,
    replyTo: config.replyTo,
    appUrl: config.appUrl,
  });
  expect(await response.json()).toMatchObject({
    status: "complete",
    counts: { expired: 1, accounts: 2, scanned: 3, submitted: 4, accepted: 4 },
  });
});
it("EW05 lost begin-submit reply never sends or repeats the transition", async () => {
  const { s, send } = services();
  s.begin.mockResolvedValue(null);
  expect((await handleReminderRun(request(), s)).status).toBe(503);
  expect(s.begin).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
  expect(s.record).not.toHaveBeenCalled();
  expect(s.finish).toHaveBeenCalledWith(id, false, expect.any(Object));
});
it("EW06 a missing claim reply is a storage failure, while explicit idle is successful", async () => {
  const { s, send } = services();
  s.claim.mockResolvedValue(null);
  expect((await handleReminderRun(request(), s)).status).toBe(503);
  expect(send).not.toHaveBeenCalled();
  s.claim.mockResolvedValue({ status: "idle" });
  expect((await handleReminderRun(request(), s)).status).toBe(200);
  expect(send).not.toHaveBeenCalled();
});
it("EW07 provider and result-save failures retain uncertainty and never repeat POST", async () => {
  const { s, send } = services();
  send.mockRejectedValue(new Error("timeout"));
  s.claim
    .mockResolvedValueOnce({ jobId: id, token })
    .mockResolvedValue({ status: "idle" });
  expect((await handleReminderRun(request(), s)).status).toBe(200);
  expect(send).toHaveBeenCalledTimes(1);
  expect(s.record).toHaveBeenCalledWith(id, token, {
    outcome: "uncertain",
    providerId: null,
    error: "provider-unavailable",
  });
  const lost = services();
  lost.s.record.mockResolvedValue(null);
  expect((await handleReminderRun(request(), lost.s)).status).toBe(503);
  expect(lost.send).toHaveBeenCalledTimes(1);
  expect(lost.s.record).toHaveBeenCalledTimes(1);
});
it("EW08 remaining budget reserves provider, storage and shutdown time before claiming another job", async () => {
  const { s, send } = services();
  let clock = 0;
  s.now = () => clock;
  s.reconcile.mockImplementation(async () => {
    clock = 15000;
    return { scanned: 3, accounts: 0 };
  });
  expect((await handleReminderRun(request(), s)).status).toBe(200);
  expect(s.claim).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it("EW09 missing config, database and failed heartbeat are explicit unavailable results", async () => {
  const { s, send } = services();
  s.config.mockReturnValue(null as never);
  expect((await handleReminderRun(request(), s)).status).toBe(503);
  expect(send).not.toHaveBeenCalled();
  const db = services();
  db.s.storageConfigured.mockReturnValue(false);
  expect((await handleReminderRun(request(), db.s)).status).toBe(503);
  expect(db.s.start).not.toHaveBeenCalled();
  const heartbeat = services();
  heartbeat.s.claim.mockResolvedValue({ status: "idle" });
  heartbeat.s.finish.mockResolvedValue(false);
  expect((await handleReminderRun(request(), heartbeat.s)).status).toBe(503);
});

it("EW10 every denied submit permission skips provider and result writes", async () => {
  for (const status of [
    "stale",
    "busy",
    "unavailable",
    "consumed",
    "window-closed",
  ]) {
    const { s, send } = services();
    s.begin.mockResolvedValue({ status });
    s.claim
      .mockResolvedValueOnce({ jobId: id, token })
      .mockResolvedValue({ status: "idle" });
    const response = await handleReminderRun(request(), s);
    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(s.record).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      status: "complete",
      counts: { submitted: 0, uncertain: 0 },
    });
  }
});
it("EW11 exact phase budgets permit work, while one millisecond less preserves the consumed guard", async () => {
  for (const [phase, time, claims, begins, sends, records] of [
    ["reconcile", 14000, 2, 1, 1, 1],
    ["reconcile", 14001, 0, 0, 0, 0],
    ["claim", 19000, 1, 1, 1, 1],
    ["claim", 19001, 1, 0, 0, 0],
    ["begin", 24000, 1, 1, 1, 1],
    ["begin", 24001, 1, 1, 0, 1],
  ] as const) {
    const { s, send } = services();
    let clock = 0;
    s.now = () => clock;
    s.reconcile.mockImplementation(async () => {
      if (phase === "reconcile") clock = time;
      return { scanned: 3, accounts: 0 };
    });
    s.claim
      .mockImplementationOnce(async () => {
        if (phase === "claim") clock = time;
        return { jobId: id, token };
      })
      .mockResolvedValue({ status: "idle" });
    s.begin.mockImplementation(async () => {
      if (phase === "begin") clock = time;
      return submission;
    });
    const response = await handleReminderRun(request(), s);
    expect(response.status).toBe(200);
    expect(s.claim).toHaveBeenCalledTimes(claims);
    expect(s.begin).toHaveBeenCalledTimes(begins);
    expect(send).toHaveBeenCalledTimes(sends);
    expect(s.record).toHaveBeenCalledTimes(records);
    expect(await response.json()).toMatchObject({
      counts: { submitted: sends, uncertain: records - sends },
    });
    if (phase === "begin" && time === 24001)
      expect(s.record).toHaveBeenCalledWith(id, token, {
        outcome: "uncertain",
        providerId: null,
        error: "interrupted",
      });
  }
});
it("EW12 a mismatched frozen sender or reply address is uncertain without any POST", async () => {
  for (const field of ["from", "reply_to"]) {
    const { s, send } = services();
    s.claim
      .mockResolvedValueOnce({ jobId: id, token })
      .mockResolvedValue({ status: "idle" });
    s.begin.mockResolvedValue({
      ...submission,
      payload: { ...submission.payload, [field]: "other@example.test" },
    });
    const response = await handleReminderRun(request(), s);
    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(s.record).toHaveBeenCalledWith(id, token, {
      outcome: "uncertain",
      providerId: null,
      error: "interrupted",
    });
    expect(await response.json()).toMatchObject({
      counts: { submitted: 0, uncertain: 1 },
    });
  }
});
it("EW13 missing authorization and wrong content type fail before storage, with canonical JSON accepted", async () => {
  for (const secret of [null, ""]) {
    const { s } = services();
    const response = await handleReminderRun(request("", `Bearer ${secret}`), {
      ...s,
      secret,
    });
    expect(response.status).toBe(401);
    expect(s.start).not.toHaveBeenCalled();
  }
  const missing = services();
  expect(
    (
      await handleReminderRun(
        new Request("http://localhost", { method: "POST" }),
        missing.s,
      )
    ).status,
  ).toBe(401);
  expect(missing.s.start).not.toHaveBeenCalled();
  for (const [type, status] of [
    ["text/plain", 415],
    ["Application/JSON ; charset=utf-8", 200],
  ] as const) {
    const { s } = services();
    s.claim.mockResolvedValue({ status: "idle" });
    const r = request("{}");
    r.headers.set("content-type", type);
    expect((await handleReminderRun(r, s)).status).toBe(status);
    if (status === 415) expect(s.start).not.toHaveBeenCalled();
  }
});
it("EW14 storage, count and heartbeat faults return unavailable, including the default clock", async () => {
  for (const stage of [
    "start",
    "expire",
    "drain",
    "reconcile",
    "finish",
  ] as const) {
    const { s, send } = services();
    s.claim.mockResolvedValue({ status: "idle" });
    s[stage].mockRejectedValue(new Error("storage unavailable"));
    const response = await handleReminderRun(request(), s);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "unavailable" });
    expect(send).not.toHaveBeenCalled();
    if (stage === "start") expect(s.finish).not.toHaveBeenCalled();
  }
  for (const value of [null, -1, 1.5, 1000000]) {
    const { s } = services();
    s.expire.mockResolvedValue(value);
    const response = await handleReminderRun(request(), s);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "unavailable" });
  }
  const { s } = services();
  s.expire.mockResolvedValue(0);
  s.drain.mockResolvedValue(999999);
  s.reconcile.mockResolvedValue({ scanned: 0 });
  s.claim.mockResolvedValue({ status: "idle" });
  const response = await handleReminderRun(request(), { ...s, now: undefined });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "complete",
    counts: { expired: 0, accounts: 999999, scanned: 0 },
  });
});
