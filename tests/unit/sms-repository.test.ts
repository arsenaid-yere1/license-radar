import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getMyEnrollment,
  getRecipientEnrollment,
  prepareVerification,
  saveConsent,
  withdrawConsent,
  parseSmsResult,
} from "@/lib/sms/repository";
const enrollment = {
  version: 1,
  phoneRevision: 0,
  phoneSuffix: null,
  verified: false,
  consented: false,
  canEdit: true,
  reason: "not-started",
  challengeId: null,
  expiresAt: null,
  retryAfter: null,
  deliveryActive: false,
};
const result = { status: "success", enrollment };
const recipient = {
  version: 1,
  canEdit: false,
  selected: null,
  readiness: "no-recipient",
  ready: false,
};
test("Empty enrollment is owner-safe", async () => {
  const rpc = vi.fn().mockResolvedValue({
      data: { ...enrollment, phone: "private", code: "private" },
      error: null,
    }),
    client = { rpc } as unknown as SupabaseClient;
  expect(await getMyEnrollment(client, "practice")).toEqual(result);
  expect(rpc).toHaveBeenCalledWith("get_my_practice_sms_enrollment", {
    p_practice_id: "practice",
  });
  const detailed = {
    recipient,
    enrollment: {
      reason: "no-recipient",
      enrollmentReady: false,
      deliveryActive: false,
    },
  };
  rpc.mockResolvedValue({ data: detailed, error: null });
  expect(await getRecipientEnrollment(client, "practice")).toEqual({
    status: "success",
    ...detailed,
  });
  expect(rpc).toHaveBeenCalledWith(
    "get_practice_reminder_recipient_with_enrollment",
    { p_practice_id: "practice" },
  );
});
test("Verification needs separate reminder consent", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: result, error: null }),
    client = { rpc } as unknown as SupabaseClient;
  expect(await prepareVerification(client, { p_phone: "fixture" })).toEqual(
    result,
  );
  expect(rpc).toHaveBeenLastCalledWith("prepare_my_sms_verification", {
    p_phone: "fixture",
  });
  expect(await saveConsent(client, "practice", "request", 7)).toEqual(result);
  expect(rpc).toHaveBeenLastCalledWith("consent_my_practice_sms", {
    p_practice_id: "practice",
    p_request_id: "request",
    p_expected_version: 7,
    p_consent: true,
  });
  expect(await withdrawConsent(client, "practice", "request")).toEqual(result);
  expect(rpc).toHaveBeenLastCalledWith("withdraw_my_practice_sms", {
    p_practice_id: "practice",
    p_request_id: "request",
  });
});
test("Only the active owner can prepare verification", async () => {
  const rpc = vi.fn(),
    client = { rpc } as unknown as SupabaseClient;
  const calls = [
    () => getMyEnrollment(client, "p"),
    () => getRecipientEnrollment(client, "p"),
    () => prepareVerification(client, {}),
    () => saveConsent(client, "p", "r", 1),
    () => withdrawConsent(client, "p", "r"),
  ];
  for (const call of calls) {
    for (const code of ["42501", "XX000"]) {
      rpc.mockResolvedValue({
        data: null,
        error: { code, message: "private" },
      });
      expect(await call()).toEqual({
        status: code === "42501" ? "forbidden" : "unavailable",
      });
    }
    rpc.mockRejectedValue(new Error("private"));
    expect(await call()).toEqual({ status: "unavailable" });
    rpc.mockResolvedValue({ data: { malformed: true }, error: null });
    expect(await call()).toEqual({ status: "unavailable" });
  }
  expect(parseSmsResult({ ...result, code: "private" })).toEqual(result);
  expect(parseSmsResult(null)).toEqual({ status: "unavailable" });
});
