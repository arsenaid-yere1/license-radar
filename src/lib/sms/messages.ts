import type { SmsState } from "./schema";
export function smsInput(form: FormData) {
  const input: Record<string, unknown> = {};
  for (const [key, value] of form) {
    if (key.startsWith("$ACTION_")) continue;
    if (key in input || typeof value !== "string") return null;
    input[key] = value;
  }
  if (input.intent !== "withdraw") {
    input.expectedVersion =
      typeof input.expectedVersion === "string" &&
      /^[1-9][0-9]*$/.test(input.expectedVersion)
        ? Number(input.expectedVersion)
        : NaN;
  }
  if (input.intent === "send") {
    input.otpPermission = input.otpPermission === "on";
    input.changeConfirmed = input.changeConfirmed === "on";
  }
  if (input.intent === "consent") input.consent = input.consent === "on";
  return input;
}
const messages: Partial<Record<SmsState["status"], string>> = {
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
export function smsMessage(status: SmsState["status"]) {
  return messages[status] ?? "We could not complete this request. Try again.";
}
export function enrollmentMessage(reason: string) {
  switch (reason) {
    case "enrolled":
      return "Phone verified and consent recorded. Renewal texts are not active yet.";
    case "consent-required":
      return "Phone verified. Choose separately whether to receive renewal texts.";
    case "verification-pending":
      return "Phone verification is incomplete. Enter your requested code.";
    case "verification-uncertain":
      return "Verification could not be confirmed. Wait for this attempt to expire, then request a new code.";
    case "provider-opted-out":
      return "This phone opted out through the text provider. Same-number recovery is not available yet; use another phone.";
    case "withdrawn":
      return "Reminder consent withdrawn. Renewal texts are not active.";
    case "no-recipient":
      return "No reminder recipient is selected.";
    case "member-unavailable":
      return "The selected reminder recipient is unavailable.";
    default:
      return "Phone verification and reminder consent have not been completed.";
  }
}
