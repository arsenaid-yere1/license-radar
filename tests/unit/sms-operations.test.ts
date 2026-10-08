import { beforeEach, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const boundary = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("@/lib/practice/access", () => ({
  getPracticeAccess: boundary.access,
}));
import { changeEnrollment, type SmsServices } from "@/lib/sms/operations";
const actor = "11111111-1111-4111-8111-111111111111",
  practiceId = "22222222-2222-4222-8222-222222222222",
  requestId = "33333333-3333-4333-8333-333333333333";
const enrollment = {
  version: 2,
  phoneRevision: 1,
  phoneSuffix: "0123",
  verified: false,
  consented: false,
  canEdit: true,
  reason: "verification-pending",
  challengeId: requestId,
  expiresAt: "2026-10-08T20:00:00Z",
  retryAfter: null,
  deliveryActive: false,
};
const saved = { status: "success", enrollment };
const claim = {
  status: "claimed",
  claimToken: requestId,
  phone: "+12025550123",
  accountSid: `AC${"1".repeat(32)}`,
  messagingServiceSid: `MG${"2".repeat(32)}`,
  verifyServiceSid: `VA${"3".repeat(32)}`,
  verificationSid: `VE${"4".repeat(32)}`,
  challengeId: requestId,
};
const response = {
  accountSid: claim.accountSid,
  serviceSid: claim.verifyServiceSid,
  sid: claim.verificationSid,
  to: claim.phone,
  channel: "sms",
  status: "pending",
};
const send = {
  intent: "send",
  requestId,
  phone: claim.phone,
  expectedVersion: 1,
  otpPermission: true,
  changeConfirmed: false,
};
const check = {
  intent: "check",
  requestId,
  code: "123456",
  expectedVersion: 2,
  challengeId: requestId,
};
let auth: ReturnType<typeof vi.fn>,
  rpc: ReturnType<typeof vi.fn>,
  client: SupabaseClient,
  services: SmsServices;
beforeEach(() => {
  vi.resetAllMocks();
  boundary.access.mockResolvedValue({
    status: "success",
    access: { practice: { id: practiceId }, role: "manager" },
  });
  auth = vi
    .fn()
    .mockResolvedValue({ data: { user: { id: actor } }, error: null });
  rpc = vi.fn().mockResolvedValue({ data: saved, error: null });
  client = { auth: { getUser: auth }, rpc } as unknown as SupabaseClient;
  services = {
    config: {
      mode: "fixture",
      accountSid: claim.accountSid,
      messagingServiceSid: claim.messagingServiceSid,
      verifyServiceSid: claim.verifyServiceSid,
      supportEmail: "help@example.test",
      fixtureURL: "http://127.0.0.1:55325",
      fixtureToken: "local-fixture-only-e4-s1",
    },
    provider: {
      send: vi.fn().mockResolvedValue(response),
      check: vi.fn().mockResolvedValue({ ...response, status: "approved" }),
    },
    claimSend: vi.fn().mockResolvedValue(claim),
    claimCheck: vi.fn().mockResolvedValue(claim),
    recordSend: vi.fn().mockResolvedValue(saved),
    recordCheck: vi.fn().mockResolvedValue(saved),
  };
});
test("Only the active owner can prepare verification", async () => {
  for (const reply of [
    { data: { user: null }, error: null },
    { data: { user: null }, error: { status: 401 } },
    { data: { user: null }, error: { status: 500 } },
  ]) {
    auth.mockResolvedValue(reply);
    expect((await changeEnrollment(client, send, services)).status).toBe(
      reply.error?.status === 500 ? "unavailable" : "auth-required",
    );
  }
  auth.mockRejectedValue(new Error("private"));
  expect((await changeEnrollment(client, send, services)).status).toBe(
    "unavailable",
  );
  auth.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  boundary.access.mockResolvedValue({ status: "unavailable" });
  expect((await changeEnrollment(client, send, services)).status).toBe(
    "unavailable",
  );
  boundary.access.mockResolvedValue({ status: "success", access: null });
  expect((await changeEnrollment(client, send, services)).status).toBe(
    "forbidden",
  );
  boundary.access.mockResolvedValue({
    status: "success",
    access: { practice: { id: practiceId }, role: "viewer" },
  });
  expect((await changeEnrollment(client, send, services)).status).toBe(
    "forbidden",
  );
  expect(
    (await changeEnrollment(client, { ...send, actorId: actor }, services))
      .status,
  ).toBe("invalid");
  expect(rpc).not.toHaveBeenCalled();
});
test("Missing setup disables collection and sending", async () => {
  expect(
    await changeEnrollment(client, send, { ...services, config: null }),
  ).toEqual({ status: "setup-unavailable" });
  expect(rpc).not.toHaveBeenCalled();
  expect(
    await changeEnrollment(client, check, { ...services, provider: null }),
  ).toEqual({ status: "setup-unavailable" });
  boundary.access.mockResolvedValue({
    status: "success",
    access: { practice: { id: practiceId }, role: "viewer" },
  });
  expect(
    await changeEnrollment(
      client,
      { intent: "withdraw", requestId },
      { ...services, config: null, provider: null },
    ),
  ).toEqual(saved);
  expect(rpc).toHaveBeenCalledWith("withdraw_my_practice_sms", {
    p_practice_id: practiceId,
    p_request_id: requestId,
  });
});
test("OTP permission never grants reminder consent", async () => {
  expect(await changeEnrollment(client, send, services)).toEqual(saved);
  expect(rpc).toHaveBeenCalledWith("prepare_my_sms_verification", {
    p_practice_id: practiceId,
    p_request_id: requestId,
    p_phone: claim.phone,
    p_expected_version: 1,
    p_change_confirmed: false,
    p_otp_permission: true,
    p_account_sid: claim.accountSid,
    p_messaging_service_sid: claim.messagingServiceSid,
    p_verify_service_sid: claim.verifyServiceSid,
  });
  expect(services.provider!.send).toHaveBeenCalledExactlyOnceWith(claim);
  expect(services.recordSend).toHaveBeenCalledExactlyOnceWith(
    practiceId,
    actor,
    requestId,
    claim.claimToken,
    response,
  );
  expect(services.claimCheck).not.toHaveBeenCalled();
  expect(
    JSON.stringify(await changeEnrollment(client, send, services)),
  ).not.toContain("123456");
});
test("Verification needs separate reminder consent", async () => {
  await changeEnrollment(client, check, services);
  expect(services.claimCheck).toHaveBeenCalledWith(
    practiceId,
    actor,
    requestId,
    requestId,
    2,
  );
  expect(services.provider!.check).toHaveBeenCalledWith(claim, "123456");
  expect(rpc).not.toHaveBeenCalled();
  expect(
    await changeEnrollment(
      client,
      { intent: "consent", requestId, expectedVersion: 2, consent: true },
      services,
    ),
  ).toEqual(saved);
  expect(rpc).toHaveBeenCalledWith("consent_my_practice_sms", {
    p_practice_id: practiceId,
    p_request_id: requestId,
    p_expected_version: 2,
    p_consent: true,
  });
});
test("Requests are immutable and claimed once", async () => {
  rpc.mockResolvedValue({
    data: { status: "conflict", enrollment },
    error: null,
  });
  expect((await changeEnrollment(client, send, services)).status).toBe(
    "conflict",
  );
  expect(services.claimSend).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: saved, error: null });
  vi.mocked(services.claimSend).mockResolvedValue(saved);
  expect(await changeEnrollment(client, send, services)).toEqual(saved);
  expect(services.provider!.send).not.toHaveBeenCalled();
  vi.mocked(services.claimCheck).mockResolvedValue(null);
  expect(await changeEnrollment(client, check, services)).toEqual({
    status: "unavailable",
  });
  expect(services.provider!.check).not.toHaveBeenCalled();
});
test("Same-phone no-op never calls the provider or invalidates existing proof", async () => {
  const current = {
    status: "success",
    enrollment: {
      ...enrollment,
      verified: true,
      reason: "consent-required",
      challengeId: null,
      expiresAt: null,
    },
  };
  rpc.mockResolvedValue({ data: current, error: null });
  expect(await changeEnrollment(client, send, services)).toEqual(current);
  expect(services.claimSend).not.toHaveBeenCalled();
  expect(services.provider!.send).not.toHaveBeenCalled();
});
test("Only trusted matching approval records proof", async () => {
  for (const patch of [
    { accountSid: "bad" },
    { messagingServiceSid: "bad" },
    { verifyServiceSid: "bad" },
  ]) {
    vi.mocked(services.claimCheck).mockResolvedValue({ ...claim, ...patch });
    await changeEnrollment(client, check, services);
    expect(services.recordCheck).toHaveBeenLastCalledWith(
      practiceId,
      actor,
      requestId,
      claim.claimToken,
      { status: "uncertain" },
    );
  }
  expect(services.provider!.check).not.toHaveBeenCalled();
});
test("Unknown acceptance fails closed", async () => {
  vi.mocked(services.provider!.send).mockRejectedValue(
    new Error("accepted then lost"),
  );
  await changeEnrollment(client, send, services);
  expect(services.provider!.send).toHaveBeenCalledTimes(1);
  expect(services.recordSend).toHaveBeenCalledWith(
    practiceId,
    actor,
    requestId,
    claim.claimToken,
    { status: "uncertain" },
  );
  vi.mocked(services.recordCheck)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ status: "uncertain", enrollment });
  vi.mocked(services.claimCheck)
    .mockResolvedValueOnce(claim)
    .mockResolvedValueOnce({ status: "uncertain", enrollment });
  expect((await changeEnrollment(client, check, services)).status).toBe(
    "uncertain",
  );
  expect(services.provider!.check).toHaveBeenCalledTimes(1);
  expect(services.recordCheck).toHaveBeenLastCalledWith(
    practiceId,
    actor,
    requestId,
    claim.claimToken,
    { status: "uncertain" },
  );
  for (const status of ["success", "wrong-code"]) {
    vi.mocked(services.recordCheck).mockClear();
    vi.mocked(services.recordCheck).mockResolvedValueOnce(null);
    vi.mocked(services.claimCheck)
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce({ status, enrollment });
    expect((await changeEnrollment(client, check, services)).status).toBe(
      status,
    );
    expect(services.recordCheck).toHaveBeenCalledTimes(1);
  }
});
