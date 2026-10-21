import { expect, it, vi } from "vitest";
import type { EmailConfig } from "./config";
import {
  dispatchRecovery,
  type RecoveryWorkerServices,
} from "./recovery-worker";

const attemptId = "10000000-0000-4000-8000-000000000001";
const token = "10000000-0000-4000-8000-000000000002";
const submissionId = "10000000-0000-4000-8000-000000000003";
const providerId = "10000000-0000-4000-8000-000000000004";
const checkId = "10000000-0000-4000-8000-000000000005";
const wall = Date.parse("2030-01-01T10:00:00Z");
const config: EmailConfig = {
  mode: "fixture",
  namespace: "fixture-reminders",
  from: "reminders@example.test",
  replyTo: "support@example.test",
  appUrl: "http://127.0.0.1:3000",
  baseUrl: "http://127.0.0.1:55326",
  apiKey: "fixture",
  webhookSecret: "fixture",
};
const payload = {
  from: config.from,
  to: ["fixture-worker@example.test"],
  reply_to: config.replyTo,
  subject: "Credential renewal reminder: 60 days",
  text: "Frozen reminder",
  html: "<p>Frozen reminder</p>",
  tags: [{ name: "reminder_attempt", value: attemptId }],
};
const permission = {
  status: "submit",
  attemptId,
  token,
  submissionId,
  ordinal: 1,
  key: `reminder-email/${attemptId}`,
  payload,
  deadline: new Date(wall + 30000).toISOString(),
  expiresAt: new Date(wall + 23 * 3600000).toISOString(),
};
const fresh = { kind: "fresh", jobId: attemptId, token };
const check = {
  kind: "check",
  attemptId,
  checkId,
  token,
  providerId,
  from: config.from,
  to: payload.to[0],
  deadline: permission.deadline,
};
const accepted = {
  kind: "accepted",
  providerId,
  errorCode: null,
  retryAfterSeconds: null,
};
function services() {
  const sendRecovery = vi.fn().mockResolvedValue(accepted);
  const retrieve = vi.fn().mockResolvedValue({
    id: providerId,
    from: config.from,
    to: payload.to,
    tags: payload.tags,
    last_event: "delivered",
  });
  const s = {
    sendingEnabled: true as boolean,
    provider: vi.fn(() => ({ sendRecovery, retrieve })),
    claim: vi.fn().mockResolvedValue({ status: "idle" }),
    begin: vi.fn().mockResolvedValue(permission),
    record: vi.fn().mockResolvedValue({ status: "recorded" }),
    recordCheck: vi.fn().mockResolvedValue({ status: "recorded" }),
    now: () => 0,
    wallNow: () => wall,
  } satisfies RecoveryWorkerServices;
  return { s, sendRecovery, retrieve };
}
it.each([0, 1, 3, 4])(
  "GM03 retained recovery uses exactly the remaining %i operation slots",
  async (limit) => {
    const { s, sendRecovery, retrieve } = services();
    s.sendingEnabled = false;
    let ordinal = 0;
    s.claim.mockImplementation(async () => ({
      ...check,
      checkId: `10000000-0000-4000-8000-${String(++ordinal + 20).padStart(12, "0")}`,
    }));
    expect((await dispatchRecovery(s, config, undefined, limit)).checked).toBe(
      limit,
    );
    expect(s.claim).toHaveBeenCalledTimes(limit);
    expect(retrieve).toHaveBeenCalledTimes(limit);
    expect(sendRecovery).not.toHaveBeenCalled();
  },
);
it("GM03 invalid recovery slot allowances fail before reservation or provider access", async () => {
  for (const limit of [-1, 4.1, 5, NaN]) {
    const { s } = services();
    await expect(
      dispatchRecovery(s, config, undefined, limit),
    ).rejects.toThrow();
    expect(s.claim).not.toHaveBeenCalled();
    expect(s.provider).not.toHaveBeenCalled();
  }
});
it("GM03 exhausted operation capacity does not construct or call a recovery provider", async () => {
  const { s, sendRecovery, retrieve } = services();
  await expect(dispatchRecovery(s, config, undefined, 0)).resolves.toEqual({
    submitted: 0,
    accepted: 0,
    failed: 0,
    uncertain: 0,
    checked: 0,
  });
  expect(s.provider).not.toHaveBeenCalled();
  expect(s.claim).not.toHaveBeenCalled();
  expect(sendRecovery).not.toHaveBeenCalled();
  expect(retrieve).not.toHaveBeenCalled();
});
it("DR14 fresh, retry and checks share four serial external slots", async () => {
  const { s, sendRecovery, retrieve } = services();
  s.claim
    .mockResolvedValueOnce(fresh)
    .mockResolvedValueOnce(check)
    .mockResolvedValueOnce({ ...fresh, kind: "retry" })
    .mockResolvedValueOnce({ ...check, checkId: submissionId })
    .mockResolvedValue(fresh);
  s.begin.mockResolvedValueOnce(permission).mockResolvedValueOnce({
    ...permission,
    submissionId: checkId,
    ordinal: 2,
  });
  const order: string[] = [];
  sendRecovery.mockImplementation(async () => {
    order.push("post");
    return accepted;
  });
  retrieve.mockImplementation(async () => {
    order.push("get");
    return {
      id: providerId,
      from: config.from,
      to: payload.to,
      tags: payload.tags,
      last_event: "delivered",
    };
  });
  s.record.mockImplementation(async () => {
    order.push("record-post");
    return { status: "recorded" };
  });
  s.recordCheck.mockImplementation(async () => {
    order.push("record-get");
    return { status: "recorded" };
  });
  expect(await dispatchRecovery(s, config)).toEqual({
    submitted: 2,
    accepted: 2,
    failed: 0,
    uncertain: 0,
    checked: 2,
  });
  expect(order).toEqual([
    "post",
    "record-post",
    "get",
    "record-get",
    "post",
    "record-post",
    "get",
    "record-get",
  ]);
  expect(s.claim).toHaveBeenCalledTimes(4);
  expect(s.claim).toHaveBeenCalledWith(config.namespace, true);
  expect(s.begin).toHaveBeenLastCalledWith(
    attemptId,
    token,
    {
      namespace: config.namespace,
      from: config.from,
      replyTo: config.replyTo,
      appUrl: config.appUrl,
    },
    "retry",
  );
});
it("DR14 sending off permits GET but skips every POST claim", async () => {
  const { s, sendRecovery, retrieve } = services();
  s.sendingEnabled = false;
  s.claim
    .mockResolvedValueOnce(fresh)
    .mockResolvedValueOnce({ ...fresh, kind: "retry" })
    .mockResolvedValueOnce(check)
    .mockResolvedValue({ status: "idle" });
  expect((await dispatchRecovery(s, config)).checked).toBe(1);
  expect(retrieve).toHaveBeenCalledTimes(1);
  expect(sendRecovery).not.toHaveBeenCalled();
  expect(s.begin).not.toHaveBeenCalled();
  expect(s.claim).toHaveBeenCalledWith(config.namespace, false);
});
it("DR14 absent configuration yields no provider or reservation calls", async () => {
  const { s, sendRecovery, retrieve } = services();
  await dispatchRecovery(s, null);
  expect(s.provider).not.toHaveBeenCalled();
  expect(s.claim).not.toHaveBeenCalled();
  expect(sendRecovery).not.toHaveBeenCalled();
  expect(retrieve).not.toHaveBeenCalled();
});
it("DR08 lost claim, begin and record acknowledgements throw without replay", async () => {
  for (const stage of ["claim", "begin", "record"] as const) {
    const { s, sendRecovery } = services();
    s.claim.mockResolvedValue(fresh);
    s[stage].mockResolvedValue(null);
    await expect(dispatchRecovery(s, config)).rejects.toThrow();
    expect(sendRecovery).toHaveBeenCalledTimes(stage === "record" ? 1 : 0);
    expect(s[stage]).toHaveBeenCalledTimes(1);
  }
});
it("DR08 malformed claims or permissions never authorize a POST", async () => {
  for (const raw of [
    { ...fresh, jobId: "bad" },
    { ...fresh, injected: true },
    { ...check, providerId: "bad" },
  ]) {
    const { s, sendRecovery, retrieve } = services();
    s.claim.mockResolvedValue(raw);
    await expect(dispatchRecovery(s, config)).rejects.toThrow();
    expect(sendRecovery).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  }
  for (const raw of [
    { ...permission, key: "replacement" },
    { ...permission, ordinal: 4 },
    { ...permission, deadline: "bad" },
    { ...permission, expiresAt: "bad" },
    { ...permission, submissionId: "bad" },
    { ...permission, extra: true },
    { ...permission, payload: { ...payload, tags: [] } },
    {
      ...permission,
      payload: {
        ...payload,
        tags: [{ name: "reminder_attempt", value: checkId }],
      },
    },
  ]) {
    const { s, sendRecovery } = services();
    s.claim.mockResolvedValue(fresh);
    s.begin.mockResolvedValue(raw);
    await expect(dispatchRecovery(s, config)).rejects.toThrow();
    expect(sendRecovery).not.toHaveBeenCalled();
  }
});
it("DR05 exact monotonic thresholds bound claims, begins, POSTs and GETs", async () => {
  for (const [phase, elapsed, claims, begins, posts, gets] of [
    ["start", 14000, 1, 1, 1, 0],
    ["start", 14001, 0, 0, 0, 0],
    ["claim", 19000, 1, 1, 1, 0],
    ["claim", 19001, 1, 0, 0, 0],
    ["begin", 24000, 1, 1, 1, 0],
    ["begin", 24001, 1, 1, 0, 0],
    ["get", 29000, 1, 0, 0, 1],
    ["get", 29001, 1, 0, 0, 0],
  ] as const) {
    const { s, sendRecovery, retrieve } = services();
    let mono = phase === "start" ? elapsed : 0;
    s.now = () => mono;
    s.claim.mockImplementationOnce(async () => {
      if (phase === "claim" || phase === "get") mono = elapsed;
      return phase === "get" ? check : fresh;
    });
    s.begin.mockImplementation(async () => {
      if (phase === "begin") mono = elapsed;
      return permission;
    });
    sendRecovery.mockImplementation(async () => {
      mono = 45000;
      return accepted;
    });
    retrieve.mockImplementation(async () => {
      mono = 45000;
      return {
        id: providerId,
        from: config.from,
        to: payload.to,
        tags: payload.tags,
        last_event: "delivered",
      };
    });
    await dispatchRecovery(s, config, 45000);
    expect(s.claim).toHaveBeenCalledTimes(claims);
    expect(s.begin).toHaveBeenCalledTimes(begins);
    expect(sendRecovery).toHaveBeenCalledTimes(posts);
    expect(retrieve).toHaveBeenCalledTimes(gets);
  }
});
it("DR05 exact provider deadlines and recovery expiry preserve fifteen seconds to submit and record", async () => {
  for (const field of ["deadline", "expiresAt"] as const) {
    for (const remaining of [0, 14999, 15000, 15001]) {
      const { s, sendRecovery } = services();
      s.claim.mockResolvedValueOnce(fresh);
      s.begin.mockResolvedValue({
        ...permission,
        [field]: new Date(wall + remaining).toISOString(),
      });
      const allowed = remaining >= 15000;
      expect(await dispatchRecovery(s, config)).toEqual({
        submitted: allowed ? 1 : 0,
        accepted: allowed ? 1 : 0,
        failed: 0,
        uncertain: allowed ? 0 : 1,
        checked: 0,
      });
      expect(sendRecovery).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(s.record).toHaveBeenCalledWith(
        submissionId,
        token,
        allowed
          ? accepted
          : {
              kind: "uncertain",
              providerId: null,
              errorCode: "interrupted",
              retryAfterSeconds: null,
            },
      );
    }
  }
});
it("DR05 database timestamps with explicit offsets authorize the same future instants", async () => {
  const { s, sendRecovery, retrieve } = services();
  const deadline = "2030-01-01T15:30:30+05:30";
  const expiresAt = "2030-01-02T14:30:00+05:30";
  s.claim
    .mockResolvedValueOnce(fresh)
    .mockResolvedValueOnce({ ...check, deadline });
  s.begin.mockResolvedValue({ ...permission, deadline, expiresAt });
  expect(await dispatchRecovery(s, config)).toEqual({
    submitted: 1,
    accepted: 1,
    failed: 0,
    uncertain: 0,
    checked: 1,
  });
  expect(sendRecovery).toHaveBeenCalledTimes(1);
  expect(retrieve).toHaveBeenCalledTimes(1);
});
it("DR06 sender and reply changes cancel POST without rewriting frozen payload", async () => {
  for (const field of ["from", "reply_to"]) {
    const { s, sendRecovery } = services();
    s.claim.mockResolvedValueOnce(fresh);
    s.begin.mockResolvedValue({
      ...permission,
      payload: { ...payload, [field]: "changed@example.test" },
    });
    await dispatchRecovery(s, config);
    expect(sendRecovery).not.toHaveBeenCalled();
    expect(s.record).toHaveBeenCalledWith(
      submissionId,
      token,
      expect.objectContaining({ kind: "uncertain", errorCode: "interrupted" }),
    );
  }
});
it("DR04 provider throws become recorded uncertainty without retry", async () => {
  const { s, sendRecovery } = services();
  s.claim.mockResolvedValueOnce(fresh);
  sendRecovery.mockRejectedValue(new Error("timeout"));
  expect(await dispatchRecovery(s, config)).toEqual({
    submitted: 1,
    accepted: 0,
    failed: 0,
    uncertain: 1,
    checked: 0,
  });
  expect(sendRecovery).toHaveBeenCalledTimes(1);
  expect(s.record).toHaveBeenCalledWith(submissionId, token, {
    kind: "uncertain",
    providerId: null,
    errorCode: "provider-unavailable",
    retryAfterSeconds: null,
  });
});
it("DR03 valid rejection outcomes are durably recorded on their reservation", async () => {
  for (const kind of ["rate-limited", "permanent", "uncertain"] as const) {
    const { s, sendRecovery } = services();
    s.claim.mockResolvedValueOnce(fresh);
    const outcome = {
      kind,
      providerId: null,
      errorCode:
        kind === "rate-limited"
          ? "rate_limit_exceeded"
          : "provider-unavailable",
      retryAfterSeconds: kind === "rate-limited" ? 60 : null,
    };
    sendRecovery.mockResolvedValue(outcome);
    expect(await dispatchRecovery(s, config)).toEqual({
      submitted: 1,
      accepted: 0,
      failed: kind === "uncertain" ? 0 : 1,
      uncertain: kind === "uncertain" ? 1 : 0,
      checked: 0,
    });
    expect(s.record).toHaveBeenCalledWith(submissionId, token, outcome);
    expect(sendRecovery).toHaveBeenCalledTimes(1);
  }
});
it("DR10 exact GET identity binds; foreign resources, unknown events and errors never resend", async () => {
  for (const raw of [
    null,
    {},
    {
      id: providerId,
      from: config.from,
      to: payload.to,
      tags: [],
      last_event: "delivered",
    },
    {
      id: providerId,
      from: config.from,
      to: payload.to,
      tags: payload.tags,
      last_event: "unknown",
    },
  ]) {
    const { s, sendRecovery, retrieve } = services();
    s.claim.mockResolvedValueOnce(check);
    retrieve.mockResolvedValue(raw);
    await dispatchRecovery(s, config);
    expect(s.recordCheck).toHaveBeenCalledWith(checkId, token, {
      status: null,
      bounced: false,
      matched:
        raw !== null &&
        typeof raw === "object" &&
        "last_event" in raw &&
        raw.last_event === "unknown",
    });
    expect(sendRecovery).not.toHaveBeenCalled();
  }
  const { s, retrieve } = services();
  s.claim.mockResolvedValueOnce(check);
  retrieve.mockRejectedValue(new Error("404"));
  await dispatchRecovery(s, config);
  expect(s.recordCheck).toHaveBeenCalledWith(checkId, token, {
    status: null,
    bounced: false,
    matched: false,
  });
});
it("DR10 GET bounced is failed evidence with an explicit unverified-bounce flag", async () => {
  const { s, retrieve } = services();
  s.claim.mockResolvedValueOnce(check);
  retrieve.mockResolvedValue({
    id: providerId,
    from: config.from,
    to: payload.to,
    tags: payload.tags,
    last_event: "bounced",
  });
  await dispatchRecovery(s, config);
  expect(s.recordCheck).toHaveBeenCalledWith(checkId, token, {
    status: "failed",
    bounced: true,
    matched: true,
  });
});
it("DR08 GET acknowledgement loss throws and cannot replay the reserved check", async () => {
  const { s, retrieve } = services();
  s.claim.mockResolvedValueOnce(check);
  s.recordCheck.mockResolvedValue(null);
  await expect(dispatchRecovery(s, config)).rejects.toThrow();
  expect(retrieve).toHaveBeenCalledTimes(1);
  expect(s.recordCheck).toHaveBeenCalledTimes(1);
});
it("DR08 duplicate permission replies cannot repeat POST or GET within a run", async () => {
  for (const claimed of [fresh, check]) {
    const { s, sendRecovery, retrieve } = services();
    s.claim.mockResolvedValue(claimed);
    await expect(dispatchRecovery(s, config)).rejects.toThrow(
      "Repeated recovery reservation",
    );
    expect(
      claimed.kind === "fresh" ? sendRecovery : retrieve,
    ).toHaveBeenCalledTimes(1);
  }
});
it("DR14 denied begin responses skip external work and result writes", async () => {
  for (const status of [
    "stale",
    "busy",
    "unavailable",
    "consumed",
    "window-closed",
  ]) {
    const { s, sendRecovery } = services();
    s.claim.mockResolvedValueOnce(fresh);
    s.begin.mockResolvedValue({ status });
    await dispatchRecovery(s, config);
    expect(sendRecovery).not.toHaveBeenCalled();
    expect(s.record).not.toHaveBeenCalled();
  }
});
it("DR05 GET requires exactly fifteen seconds of reservation permission", async () => {
  for (const remaining of [0, 14999, 15000, 15001]) {
    const { s, retrieve } = services();
    s.claim.mockResolvedValueOnce({
      ...check,
      deadline: new Date(wall + remaining).toISOString(),
    });
    const allowed = remaining >= 15000;
    expect(await dispatchRecovery(s, config)).toEqual({
      submitted: 0,
      accepted: 0,
      failed: 0,
      uncertain: 0,
      checked: allowed ? 1 : 0,
    });
    expect(retrieve).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(s.recordCheck).toHaveBeenCalledTimes(allowed ? 1 : 0);
  }
});
it("DR08 fresh/retry ordinals cannot cross their reservation contracts", async () => {
  for (const [kind, ordinal] of [
    ["fresh", 2],
    ["retry", 1],
  ]) {
    const { s, sendRecovery } = services();
    s.claim.mockResolvedValueOnce({ ...fresh, kind });
    s.begin.mockResolvedValue({ ...permission, ordinal });
    await expect(dispatchRecovery(s, config)).rejects.toThrow(
      "Invalid recovery reservation ordinal",
    );
    expect(sendRecovery).not.toHaveBeenCalled();
  }
});
it("DR04 malformed provider outcomes cannot establish acceptance or retry permission", async () => {
  for (const outcome of [
    null,
    { ...accepted, providerId: null },
    { ...accepted, errorCode: "provider-unavailable" },
    { ...accepted, retryAfterSeconds: 60 },
    { ...accepted, extra: true },
    {
      kind: "rate-limited",
      providerId: null,
      errorCode: "daily_quota_exceeded",
      retryAfterSeconds: 1,
    },
    {
      kind: "rate-limited",
      providerId,
      errorCode: "rate_limit_exceeded",
      retryAfterSeconds: 60,
    },
    ...["permanent", "uncertain"].map((kind) => ({
      kind,
      providerId: null,
      errorCode: "provider-unavailable",
      retryAfterSeconds: 60,
    })),
    ...["!invalid", "invalid!", "invalid\n", "x".repeat(65)].map(
      (errorCode) => ({
        kind: "permanent",
        providerId: null,
        errorCode,
        retryAfterSeconds: null,
      }),
    ),
  ]) {
    const { s, sendRecovery } = services();
    s.claim.mockResolvedValueOnce(fresh);
    sendRecovery.mockResolvedValue(outcome);
    expect(await dispatchRecovery(s, config)).toEqual({
      submitted: 1,
      accepted: 0,
      failed: 0,
      uncertain: 1,
      checked: 0,
    });
    expect(s.record).toHaveBeenCalledWith(submissionId, token, {
      kind: "uncertain",
      providerId: null,
      errorCode: "invalid-response",
      retryAfterSeconds: null,
    });
    expect(sendRecovery).toHaveBeenCalledTimes(1);
  }
});
it("DR14 default clocks can run an idle configured worker", async () => {
  const { s } = services();
  await expect(
    dispatchRecovery({ ...s, now: undefined, wallNow: undefined }, config),
  ).resolves.toEqual({
    submitted: 0,
    accepted: 0,
    failed: 0,
    uncertain: 0,
    checked: 0,
  });
  expect(s.claim).toHaveBeenCalledTimes(1);
});
