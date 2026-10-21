import { expect, it, vi } from "vitest";
import { handleReminderRun } from "./worker";
const id = "10000000-0000-4000-8000-000000000001";
function fixture() {
  const heartbeat = vi.fn().mockResolvedValue(true);
  const services = {
    secret: "secret",
    sendingEnabled: true,
    heartbeat,
    config: () => ({
      namespace: "live",
      from: "pilot@example.com",
      replyTo: "pilot@example.com",
      appUrl: "https://example.com",
      mode: "live" as const,
      baseUrl: "https://api.resend.com",
      apiKey: "fixture",
      webhookSecret: "fixture",
    }),
    storageConfigured: () => true,
    provider: () => ({ send: vi.fn() }),
    start: vi.fn().mockResolvedValue(id),
    expire: vi.fn().mockResolvedValue(0),
    drain: vi.fn().mockResolvedValue(0),
    reconcile: vi.fn().mockResolvedValue({ scanned: 0 }),
    claim: vi.fn().mockResolvedValue({ status: "idle" }),
    begin: vi.fn(),
    record: vi.fn(),
    finish: vi.fn().mockResolvedValue(true),
    now: () => 0,
  };
  const request = (method = "POST", auth = "Bearer secret", body?: string) =>
    new Request("https://example.com/api/reminders/run", {
      method,
      headers: { authorization: auth, "content-type": "application/json" },
      body,
    });
  return { services, heartbeat, request };
}
it("SA01 awaits strict finish acknowledgment before exactly one no-argument heartbeat, including idle runs", async () => {
  const { services, heartbeat, request } = fixture();
  let finish!: (value: unknown) => void, ping!: (value: boolean) => void;
  services.finish.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  heartbeat.mockImplementation(
    () =>
      new Promise((r) => {
        ping = r;
      }),
  );
  let settled = false;
  const result = handleReminderRun(request(), services).then((r) => {
    settled = true;
    return r;
  });
  await vi.waitFor(() => expect(services.finish).toHaveBeenCalledTimes(1));
  expect(heartbeat).not.toHaveBeenCalled();
  finish(true);
  await vi.waitFor(() => expect(heartbeat).toHaveBeenCalledExactlyOnceWith());
  expect(settled).toBe(false);
  ping(true);
  expect((await result).status).toBe(200);
});
it("SA02 false, missing, nonboolean and rejected final acknowledgments never refresh health", async () => {
  for (const value of [
    false,
    null,
    undefined,
    1,
    "true",
    {},
    Error("private"),
  ]) {
    const { services, heartbeat, request } = fixture();
    if (value instanceof Error) services.finish.mockRejectedValue(value);
    else services.finish.mockResolvedValue(value);
    expect((await handleReminderRun(request(), services)).status).toBe(503);
    expect(heartbeat).not.toHaveBeenCalled();
  }
});
it("SA02 failed storage processing never refreshes health", async () => {
  for (const stage of [
    "start",
    "expire",
    "drain",
    "reconcile",
    "claim",
  ] as const) {
    const { services, heartbeat, request } = fixture();
    services[stage].mockRejectedValue(Error("private"));
    expect((await handleReminderRun(request(), services)).status).toBe(503);
    expect(heartbeat).not.toHaveBeenCalled();
  }
});
it("SA02 preflight rejection, missing configuration and disabled sends never ping", async () => {
  for (const mode of [
    "auth",
    "body",
    "method",
    "storage",
    "config",
    "disabled",
  ]) {
    const { services, heartbeat, request } = fixture();
    if (mode === "storage") services.storageConfigured = () => false;
    if (mode === "config") Object.assign(services, { config: () => null });
    if (mode === "disabled") services.sendingEnabled = false;
    const response = await handleReminderRun(
      request(
        mode === "method" ? "GET" : "POST",
        mode === "auth" ? "wrong" : "Bearer secret",
        mode === "body" ? "{" : undefined,
      ),
      services,
    );
    expect(response.status).toBe(
      mode === "disabled"
        ? 200
        : mode === "auth"
          ? 401
          : mode === "body"
            ? 400
            : mode === "method"
              ? 405
              : 503,
    );
    expect(heartbeat).not.toHaveBeenCalled();
  }
});
it("SA05 monitor failure cannot change committed response or repeat any operation", async () => {
  const baseline = fixture();
  const expected = await (
    await handleReminderRun(baseline.request(), baseline.services)
  ).json();
  for (const rejects of [false, true]) {
    const { services, heartbeat, request } = fixture();
    if (rejects) heartbeat.mockRejectedValue(Error("secret"));
    else heartbeat.mockResolvedValue(false);
    const response = await handleReminderRun(request(), services);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(heartbeat).toHaveBeenCalledExactlyOnceWith();
    for (const fn of [
      services.start,
      services.expire,
      services.drain,
      services.reconcile,
      services.claim,
      services.finish,
    ])
      expect(fn).toHaveBeenCalledTimes(1);
    expect(services.begin).not.toHaveBeenCalled();
    expect(services.record).not.toHaveBeenCalled();
  }
});

it("SA02 SA05 recorded delivery failures remain completion; begin or record failures never ping or replay", async () => {
  for (const stage of ["accepted", "failed", "uncertain", "begin", "record"]) {
    const { services, heartbeat, request } = fixture();
    const token = "10000000-0000-4000-8000-000000000002";
    const send = vi.fn().mockResolvedValue({
      outcome:
        stage === "failed"
          ? "failed"
          : stage === "uncertain"
            ? "uncertain"
            : "accepted",
      providerId: stage === "accepted" ? id : null,
      error: stage === "accepted" ? null : "provider-unavailable",
    });
    services.provider = () => ({ send });
    services.claim.mockResolvedValueOnce({ jobId: id, token });
    services.begin.mockResolvedValue({
      status: "submit",
      attemptId: id,
      token,
      key: `reminder-email/${id}`,
      payload: {
        from: "pilot@example.com",
        to: ["pilot@example.com"],
        reply_to: "pilot@example.com",
        subject: "Credential renewal reminder: 60 days",
        text: "Review",
        html: "<p>Review</p>",
        tags: [{ name: "reminder_attempt", value: id }],
      },
    });
    services.record.mockResolvedValue({ status: "recorded" });
    if (stage === "begin") services.begin.mockRejectedValue(Error("private"));
    if (stage === "record") services.record.mockRejectedValue(Error("private"));
    heartbeat.mockRejectedValue(Error("monitor"));
    const response = await handleReminderRun(request(), services);
    const failure = stage === "begin" || stage === "record";
    expect(response.status).toBe(failure ? 503 : 200);
    expect(heartbeat).toHaveBeenCalledTimes(failure ? 0 : 1);
    expect(send).toHaveBeenCalledTimes(stage === "begin" ? 0 : 1);
    expect(services.begin).toHaveBeenCalledTimes(1);
    expect(services.record).toHaveBeenCalledTimes(stage === "begin" ? 0 : 1);
    expect(services.finish).toHaveBeenCalledTimes(1);
  }
});
