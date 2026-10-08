import { beforeEach, expect, test, vi } from "vitest";
const boundary = vi.hoisted(() => ({
  createClient: vi.fn(),
  change: vi.fn(),
  config: vi.fn(),
  provider: vi.fn(),
  storage: vi.fn(),
  claimSend: vi.fn(),
  claimCheck: vi.fn(),
  recordSend: vi.fn(),
  recordCheck: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: boundary.createClient,
}));
vi.mock("@/lib/sms/operations", () => ({ changeEnrollment: boundary.change }));
vi.mock("@/lib/sms/config", () => ({ smsConfig: boundary.config }));
vi.mock("@/lib/sms/provider", () => ({ createProvider: boundary.provider }));
vi.mock("@/lib/sms/privileged-repository", () => ({
  smsStorageConfigured: boundary.storage,
  claimSend: boundary.claimSend,
  claimCheck: boundary.claimCheck,
  recordSend: boundary.recordSend,
  recordCheck: boundary.recordCheck,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { smsAction } from "@/app/practice/sms/actions";
import { smsInput, smsMessage, enrollmentMessage } from "@/lib/sms/messages";
function form(
  values: Record<string, string> = { intent: "withdraw", requestId: "request" },
) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  boundary.createClient.mockResolvedValue("client");
  boundary.storage.mockReturnValue(true);
  boundary.config.mockReturnValue("config");
  boundary.provider.mockReturnValue("provider");
});
test("Only the active owner can prepare verification", async () => {
  for (const status of [
    "success",
    "invalid",
    "forbidden",
    "unavailable",
    "setup-unavailable",
    "conflict",
    "confirmation-required",
    "blocked",
    "rate-limited",
    "wrong-code",
    "verification-required",
    "uncertain",
    "busy",
  ] as const) {
    boundary.change.mockResolvedValue({ status });
    expect(await smsAction({ status: "idle" }, form())).toEqual({
      status,
      message: smsMessage(status),
    });
  }
  expect(boundary.change).toHaveBeenLastCalledWith(
    "client",
    { intent: "withdraw", requestId: "request" },
    {
      config: "config",
      provider: "provider",
      claimSend: boundary.claimSend,
      claimCheck: boundary.claimCheck,
      recordSend: boundary.recordSend,
      recordCheck: boundary.recordCheck,
    },
  );
  boundary.change.mockResolvedValue({ status: "auth-required" });
  await expect(smsAction({ status: "idle" }, form())).rejects.toThrow(
    "REDIRECT:/login",
  );
  boundary.change.mockRejectedValue(new Error("private"));
  expect(await smsAction({ status: "idle" }, form())).toEqual({
    status: "unavailable",
    message: "We could not complete this request. Try again.",
  });
  boundary.createClient.mockRejectedValue(new Error("private"));
  expect((await smsAction({ status: "idle" }, form())).status).toBe(
    "unavailable",
  );
});
test("Missing setup disables collection and sending", async () => {
  boundary.storage.mockReturnValue(false);
  boundary.change.mockResolvedValue({ status: "success" });
  await smsAction({ status: "idle" }, form());
  expect(boundary.config).not.toHaveBeenCalled();
  expect(boundary.provider).not.toHaveBeenCalled();
  expect(boundary.change.mock.calls[0][2].config).toBeNull();
});
test("Requests are immutable and claimed once", () => {
  expect(
    smsInput(
      form({
        intent: "send",
        requestId: "r",
        phone: "+12025550123",
        expectedVersion: "2",
        otpPermission: "on",
        changeConfirmed: "on",
        $ACTION_ID: "ignored",
      }),
    ),
  ).toEqual({
    intent: "send",
    requestId: "r",
    phone: "+12025550123",
    expectedVersion: 2,
    otpPermission: true,
    changeConfirmed: true,
  });
  expect(smsInput(form({ intent: "send", expectedVersion: "1" }))).toEqual({
    intent: "send",
    expectedVersion: 1,
    otpPermission: false,
    changeConfirmed: false,
  });
  expect(
    smsInput(form({ intent: "consent", expectedVersion: "1", consent: "on" })),
  ).toEqual({ intent: "consent", expectedVersion: 1, consent: true });
  expect(smsInput(form({ intent: "consent", expectedVersion: "1" }))).toEqual({
    intent: "consent",
    expectedVersion: 1,
    consent: false,
  });
  for (const version of ["0", "01", "-1", "1.5", "1e3", "", "1\n"]) {
    expect(
      smsInput(form({ intent: "check", expectedVersion: version }))
        ?.expectedVersion,
    ).toBeNaN();
  }
  expect(smsInput(new FormData())?.expectedVersion).toBeNaN();
  const duplicate = form();
  duplicate.append("intent", "consent");
  expect(smsInput(duplicate)).toBeNull();
  const file = form();
  file.set("code", new File(["private"], "fixture.txt"));
  expect(smsInput(file)).toBeNull();
});
test("Verification needs separate reminder consent", () => {
  const expected = {
    enrolled:
      "Phone verified and consent recorded. Renewal texts are not active yet.",
    "consent-required":
      "Phone verified. Choose separately whether to receive renewal texts.",
    "verification-pending":
      "Phone verification is incomplete. Enter your requested code.",
    "verification-uncertain":
      "Verification could not be confirmed. Wait for this attempt to expire, then request a new code.",
    "provider-opted-out":
      "This phone opted out through the text provider. Same-number recovery is not available yet; use another phone.",
    withdrawn: "Reminder consent withdrawn. Renewal texts are not active.",
    "no-recipient": "No reminder recipient is selected.",
    "member-unavailable": "The selected reminder recipient is unavailable.",
  };
  for (const [reason, message] of Object.entries(expected))
    expect(enrollmentMessage(reason)).toBe(message);
  expect(enrollmentMessage("not-started")).toBe(
    "Phone verification and reminder consent have not been completed.",
  );
  expect(smsMessage("idle")).toBe(
    "We could not complete this request. Try again.",
  );
});

test("Every operation status has an exact safe and actionable message", () => {
  const expected = {
    success:
      "Your reminder text settings are saved. Renewal texts are not active yet.",
    invalid:
      "Check your international phone number, six-digit code or consent choice.",
    forbidden: "You do not have permission to enroll in reminder texts.",
    "setup-unavailable":
      "Text enrollment is not configured yet. You can still withdraw existing consent.",
    conflict: "Your enrollment changed. Reload before continuing.",
    "confirmation-required":
      "Confirm that changing your phone ends its previous verification and consent.",
    blocked:
      "This phone opted out through the text provider. Use another phone; same-number recovery is not available yet.",
    "rate-limited":
      "Too many verification requests. Wait before requesting another code.",
    "wrong-code": "That code was not approved. Check the code and try again.",
    "verification-required":
      "Verification is no longer valid. Reload and request a new code.",
    uncertain:
      "We could not confirm verification. Reload; wait for this attempt to expire before starting again.",
    busy: "A verification request is already in progress. Reload before continuing.",
  };
  for (const [status, message] of Object.entries(expected))
    expect(smsMessage(status as Parameters<typeof smsMessage>[0])).toBe(
      message,
    );
});
