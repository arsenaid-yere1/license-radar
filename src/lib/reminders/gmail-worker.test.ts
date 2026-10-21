import { expect, it, vi, afterEach } from "vitest";
import { handleReminderRun } from "./worker";
const id = "f9cbb616-4856-4787-b4f2-734e731059cb",
  token = "10000000-0000-4000-8000-000000000002",
  wall = Date.parse("2030-01-01T10:00:00Z");
afterEach(() => vi.useRealTimers());
function fixture() {
  const send = vi.fn().mockResolvedValue({
    outcome: "accepted",
    providerId: "19a8df",
    error: null,
  });
  const config = {
    namespace: "gmail-pilot",
    from: "pilot@gmail.com",
    replyTo: "pilot@gmail.com",
    appUrl: "https://example.com",
  };
  const permission = {
    status: "submit",
    attemptId: id,
    token,
    key: `reminder-email/${id}`,
    deadline: new Date(wall + 30000).toISOString(),
    payload: {
      from: config.from,
      to: [config.from],
      reply_to: config.from,
      subject: "Credential renewal reminder: 60 days",
      text: "Review",
      html: "<p>Review</p>",
      tags: [{ name: "reminder_attempt", value: id }],
    },
  };
  const s = {
    secret: "worker-secret",
    sendingEnabled: true,
    config: () => config,
    storageConfigured: () => true,
    provider: () => ({ send }),
    prepare: vi.fn().mockResolvedValue({ send }),
    directDispatch: true,
    submissionDeadline: true,
    wallNow: () => wall,
    now: () => 0,
    start: vi.fn().mockResolvedValue(id),
    expire: vi.fn().mockResolvedValue(0),
    drain: vi.fn().mockResolvedValue(0),
    reconcile: vi.fn().mockResolvedValue({ scanned: 1 }),
    claim: vi
      .fn()
      .mockResolvedValueOnce({ jobId: id, token })
      .mockResolvedValue({ status: "idle" }),
    begin: vi.fn().mockResolvedValue(permission),
    record: vi.fn().mockResolvedValue({ status: "recorded" }),
    finish: vi.fn().mockResolvedValue(true),
  };
  const request = () =>
    new Request("https://example.com/api/reminders/run", {
      method: "POST",
      headers: { Authorization: "Bearer worker-secret" },
    });
  return { s, send, permission, request };
}
it("GM03 Gmail prepares identity before claiming then submits exactly one reserved permission", async () => {
  const { s, send, request } = fixture();
  expect((await handleReminderRun(request(), s)).status).toBe(200);
  expect(s.prepare).toHaveBeenCalledTimes(1);
  expect(s.prepare.mock.invocationCallOrder[0]).toBeLessThan(
    s.claim.mock.invocationCallOrder[0],
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect(s.record).toHaveBeenCalledWith(id, token, {
    outcome: "accepted",
    providerId: "19a8df",
    error: null,
  });
});
it("GM05 revoked preauthorization or lost begin acknowledgement makes zero POSTs", async () => {
  for (const stage of ["prepare", "begin"] as const) {
    const { s, send, request } = fixture();
    s[stage].mockRejectedValue(Error("private-detail"));
    expect((await handleReminderRun(request(), s)).status).toBe(503);
    expect(send).not.toHaveBeenCalled();
    if (stage === "prepare") expect(s.claim).not.toHaveBeenCalled();
  }
});
it("GM04 expired or near-expiry permission is uncertain without POST; exact 15-second margin can send", async () => {
  for (const [remaining, count] of [
    [-1, 0],
    [14999, 0],
    [15000, 1],
  ] as const) {
    const { s, send, permission, request } = fixture();
    s.begin.mockResolvedValue({
      ...permission,
      deadline: new Date(wall + remaining).toISOString(),
    });
    expect((await handleReminderRun(request(), s)).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(count);
    if (count === 0)
      expect(s.record).toHaveBeenCalledWith(id, token, {
        outcome: "uncertain",
        providerId: null,
        error: "interrupted",
      });
  }
});
it("GM04 Gmail accepts database deadlines with explicit timezone offsets", async () => {
  const { s, send, permission, request } = fixture();
  s.begin.mockResolvedValue({
    ...permission,
    deadline: "2030-01-01T15:30:30+05:30",
  });
  expect((await handleReminderRun(request(), s)).status).toBe(200);
  expect(send).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ attemptId: id, token }),
  );
  expect(s.record).toHaveBeenCalledExactlyOnceWith(id, token, {
    outcome: "accepted",
    providerId: "19a8df",
    error: null,
  });
});
it("GM04 repeated Gmail reservations and missing deadlines never authorize another POST", async () => {
  const { s, send, request } = fixture();
  s.claim.mockReset().mockResolvedValue({ jobId: id, token });
  expect((await handleReminderRun(request(), s)).status).toBe(503);
  expect(send).toHaveBeenCalledTimes(1);
  const missing = fixture();
  const permission = Object.fromEntries(
    Object.entries(missing.permission).filter(([key]) => key !== "deadline"),
  );
  missing.s.begin.mockResolvedValue(permission as typeof missing.permission);
  expect((await handleReminderRun(missing.request(), missing.s)).status).toBe(
    503,
  );
  expect(missing.send).not.toHaveBeenCalled();
});
it("GM01 Gmail direct dispatch coexists with retained Resend observations using its own namespace and sending=false", async () => {
  const { s, send, request } = fixture();
  const claim = vi.fn().mockResolvedValue({ status: "idle" });
  const recovery = {
    sendingEnabled: false,
    provider: () => ({ retrieve: vi.fn(), sendRecovery: vi.fn() }),
    claim,
    begin: vi.fn(),
    record: vi.fn(),
    recordCheck: vi.fn(),
    now: () => 0,
  };
  const resend = {
    mode: "live" as const,
    namespace: "retained-resend",
    from: "reminders@example.com",
    replyTo: "support@example.com",
    appUrl: "https://example.com",
    baseUrl: "https://api.resend.com",
    apiKey: "fixture",
    webhookSecret: "fixture",
  };
  expect(
    (
      await handleReminderRun(request(), {
        ...s,
        recovery,
        recoveryConfig: () => resend,
      })
    ).status,
  ).toBe(200);
  expect(send).toHaveBeenCalledTimes(1);
  expect(claim).toHaveBeenCalledWith("retained-resend", false);
});
it("GM03 four Gmail submissions leave no additional Resend observation slots", async () => {
  const { s, send, permission, request } = fixture(),
    ids = Array.from(
      { length: 4 },
      (_, i) => `10000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
    );
  s.claim.mockReset().mockResolvedValue({ status: "idle" });
  for (const jobId of ids) s.claim.mockResolvedValueOnce({ jobId, token });
  s.begin.mockImplementation(async (jobId: string) => ({
    ...permission,
    attemptId: jobId,
    key: `reminder-email/${jobId}`,
    payload: {
      ...permission.payload,
      tags: [{ name: "reminder_attempt", value: jobId }],
    },
  }));
  send.mockImplementation(async (p: { attemptId: string }) => ({
    outcome: "accepted",
    providerId: `gmail-${p.attemptId}`,
    error: null,
  }));
  const claim = vi.fn().mockResolvedValue({ status: "idle" }),
    recovery = {
      sendingEnabled: false,
      provider: () => ({ retrieve: vi.fn(), sendRecovery: vi.fn() }),
      claim,
      begin: vi.fn(),
      record: vi.fn(),
      recordCheck: vi.fn(),
      now: () => 0,
    };
  const config = {
    mode: "live" as const,
    namespace: "retained-resend",
    from: "reminders@example.com",
    replyTo: "support@example.com",
    appUrl: "https://example.com",
    baseUrl: "https://api.resend.com",
    apiKey: "fixture",
    webhookSecret: "fixture",
  };
  expect(
    (
      await handleReminderRun(request(), {
        ...s,
        recovery,
        recoveryConfig: () => config,
      })
    ).status,
  ).toBe(200);
  expect(send).toHaveBeenCalledTimes(4);
  expect(claim).not.toHaveBeenCalled();
});
it("GM04 delayed preparation preserves the shared shutdown budget without more storage work", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(wall);
  const { s, send, request } = fixture();
  s.now = () => Date.now() - wall;
  s.prepare.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40000));
    return { send };
  });
  const pending = handleReminderRun(request(), s);
  await vi.advanceTimersByTimeAsync(45000);
  expect((await pending).status).toBe(200);
  expect(s.drain).not.toHaveBeenCalled();
  expect(s.reconcile).not.toHaveBeenCalled();
  expect(s.claim).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it("GM04 a genuinely delayed begin reply past its durable margin records uncertainty without POST", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(wall);
  const { s, send, permission, request } = fixture();
  s.now = () => Date.now() - wall;
  s.wallNow = () => Date.now();
  s.begin.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 24001));
    return permission;
  });
  const pending = handleReminderRun(request(), s);
  await vi.advanceTimersByTimeAsync(45000);
  expect((await pending).status).toBe(200);
  expect(send).not.toHaveBeenCalled();
  expect(s.record).toHaveBeenCalledExactlyOnceWith(id, token, {
    outcome: "uncertain",
    providerId: null,
    error: "interrupted",
  });
});
it.each([
  [34000, 5000, 1, 1],
  [34001, 0, 0, 0],
  [34000, 5001, 1, 0],
])(
  "GM04 storage budget boundaries after %i ms preparation and %i ms drain",
  async (preparation, draining, drains, reconciles) => {
    vi.useFakeTimers();
    vi.setSystemTime(wall);
    const { s, send, request } = fixture();
    s.now = () => Date.now() - wall;
    s.prepare.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, preparation));
      return { send };
    });
    s.drain.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, draining));
      return 0;
    });
    const pending = handleReminderRun(request(), s);
    await vi.advanceTimersByTimeAsync(45000);
    expect((await pending).status).toBe(200);
    expect(s.drain).toHaveBeenCalledTimes(drains);
    expect(s.reconcile).toHaveBeenCalledTimes(reconciles);
    expect(s.claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  },
);
