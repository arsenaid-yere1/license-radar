import { it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  requestCode,
  verifyCode,
  endSession,
  authenticationRequired,
} from "@/lib/auth/operations";
function client(method: string, result: unknown) {
  return {
    auth: { [method]: vi.fn().mockResolvedValue(result) },
  } as unknown as SupabaseClient;
}
it("S02 requests code without implying verified session", async () =>
  expect(
    await requestCode(
      client("signInWithOtp", { error: null }),
      "fixture@example.test",
    ),
  ).toEqual({ status: "sent" }));
it("S03 verifies valid code", async () =>
  expect(
    await verifyCode(
      client("verifyOtp", { error: null }),
      "fixture@example.test",
      "123456",
    ),
  ).toEqual({ status: "verified" }));
it.each(["000000", "111111"])("S04 invalid/expired code %s", async (token) =>
  expect(
    await verifyCode(
      client("verifyOtp", { error: { code: "otp_expired" } }),
      "fixture@example.test",
      token,
    ),
  ).toEqual({ status: "invalid" }),
);
it("S04 malformed email/code rejected before network", async () => {
  const c = client("verifyOtp", { error: null });
  expect(await verifyCode(c, "bad", "123456")).toEqual({ status: "invalid" });
  expect(await verifyCode(c, "fixture@example.test", "x")).toEqual({
    status: "invalid",
  });
  expect(c.auth.verifyOtp).not.toHaveBeenCalled();
});
it("S05 provider resend limit offers retry", async () =>
  expect(
    await requestCode(
      client("signInWithOtp", {
        error: { code: "over_email_send_rate_limit" },
      }),
      "fixture@example.test",
    ),
  ).toEqual({ status: "retry" }));
it("S06 signout clears session", async () =>
  expect(await endSession(client("signOut", { error: null }))).toEqual({
    status: "signed-out",
  }));
it("S24 safe auth failure", async () => {
  for (const fn of [requestCode, verifyCode])
    expect(
      await fn(
        client(fn === requestCode ? "signInWithOtp" : "verifyOtp", {
          error: { code: "unexpected" },
        }),
        "fixture@example.test",
        "123456",
      ),
    ).toEqual({ status: "unavailable" });
  expect(
    await endSession(
      client("signOut", { error: { message: "private failure" } }),
    ),
  ).toEqual({ status: "unavailable" });
});
it("S24 thrown transport error is unavailable", async () => {
  const c = {
    auth: {
      signInWithOtp: vi.fn().mockRejectedValue(new Error("network")),
      verifyOtp: vi.fn().mockRejectedValue(new Error("network")),
      signOut: vi.fn().mockRejectedValue(new Error("network")),
    },
  } as unknown as SupabaseClient;
  expect(await requestCode(c, "fixture@example.test")).toEqual({
    status: "unavailable",
  });
  expect(await verifyCode(c, "fixture@example.test", "123456")).toEqual({
    status: "unavailable",
  });
  expect(await endSession(c)).toEqual({ status: "unavailable" });
});
it("S02 malformed request email is rejected", async () =>
  expect(
    await requestCode(client("signInWithOtp", { error: null }), "not an email"),
  ).toEqual({ status: "invalid" }));

it.each(["1234567", "x123456", "123456x"])(
  "S04 rejects non-six-digit token %s before API",
  async (token) => {
    const c = client("verifyOtp", { error: null });
    expect(await verifyCode(c, "fixture@example.test", token)).toEqual({
      status: "invalid",
    });
    expect(c.auth.verifyOtp).not.toHaveBeenCalled();
  },
);

it("S24 S26 distinguishes credential errors from transport/provider failures", () => {
  for (const status of [400, 401, 403])
    expect(authenticationRequired(status)).toBe(true);
  for (const status of [undefined, 0, 404, 429, 500, 503])
    expect(authenticationRequired(status)).toBe(false);
});
