import { afterEach, expect, test, vi } from "vitest";
const boundary = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: boundary.create }));
import {
  claimSend,
  claimCheck,
  recordSend,
  recordCheck,
  applyOptOut,
  smsStorageConfigured,
} from "@/lib/sms/privileged-repository";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
test("Only trusted matching approval records proof", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "fixture-only-credential");
  boundary.create.mockReturnValue({ rpc: boundary.rpc });
  boundary.rpc.mockResolvedValue({ data: { status: "success" }, error: null });
  expect(smsStorageConfigured()).toBe(true);
  const calls = [
    () => claimSend("p", "a", "r"),
    () => claimCheck("p", "a", "r", "c", 2),
    () => recordSend("p", "a", "r", "t", { status: "pending" }),
    () => recordCheck("p", "a", "r", "t", { status: "approved" }),
    () => applyOptOut("ac", "mg", "fixture", "sm", "STOP"),
  ];
  for (const call of calls) expect(await call()).toEqual({ status: "success" });
  expect(boundary.create).toHaveBeenCalledWith(
    "http://127.0.0.1:55321",
    "fixture-only-credential",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  expect(boundary.rpc.mock.calls.map(([name]) => name)).toEqual([
    "claim_sms_verification_send",
    "claim_sms_verification_check",
    "record_sms_verification_send",
    "record_sms_verification_check",
    "apply_sms_provider_opt_out",
  ]);
  expect(boundary.rpc.mock.calls[0][1]).toEqual({
    p_practice_id: "p",
    p_actor_id: "a",
    p_request_id: "r",
  });
  expect(boundary.rpc.mock.calls[1][1]).toEqual({
    p_practice_id: "p",
    p_actor_id: "a",
    p_request_id: "r",
    p_challenge_id: "c",
    p_expected_version: 2,
  });
  expect(boundary.rpc.mock.calls[2][1]).toEqual({
    p_practice_id: "p",
    p_actor_id: "a",
    p_request_id: "r",
    p_claim_token: "t",
    p_outcome: { status: "pending" },
  });
  expect(boundary.rpc.mock.calls[3][1]).toEqual({
    p_practice_id: "p",
    p_actor_id: "a",
    p_request_id: "r",
    p_claim_token: "t",
    p_outcome: { status: "approved" },
  });
  expect(boundary.rpc.mock.calls[4][1]).toEqual({
    p_account_sid: "ac",
    p_messaging_service_sid: "mg",
    p_phone: "fixture",
    p_message_sid: "sm",
    p_opt_out_type: "STOP",
  });
});
test("Callback storage failure is retryable", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  expect(smsStorageConfigured()).toBe(false);
  expect(await claimSend("p", "a", "r")).toBeNull();
  expect(boundary.create).not.toHaveBeenCalled();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  expect(smsStorageConfigured()).toBe(false);
  expect(await claimSend("p", "a", "r")).toBeNull();
  vi.stubEnv("SUPABASE_SECRET_KEY", "fixture-only-credential");
  boundary.create.mockReturnValue({ rpc: boundary.rpc });
  boundary.rpc.mockResolvedValue({ data: null, error: { message: "private" } });
  expect(await claimSend("p", "a", "r")).toBeNull();
  boundary.rpc.mockRejectedValue(new Error("private"));
  expect(await claimSend("p", "a", "r")).toBeNull();
});
