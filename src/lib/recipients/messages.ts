import type { RecipientState } from "./schema";
export function recipientInput(form: FormData) {
  const input: Record<string, unknown> = {};
  for (const [key, value] of form) {
    if (key.startsWith("$ACTION_")) continue;
    if (key in input || typeof value !== "string") return null;
    input[key] = value;
  }
  const raw = input.expectedVersion;
  input.expectedVersion =
    typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
  return input;
}
export function recipientMessage(status: RecipientState["status"]) {
  switch (status) {
    case "success":
      return "Reminder recipient saved. SMS setup is still pending.";
    case "invalid":
      return "Choose a valid recipient or explicitly clear the selection.";
    case "forbidden":
      return "You do not have permission to change the reminder recipient.";
    case "conflict":
      return "The reminder recipient changed. Reload before saving.";
    case "invalid-recipient":
      return "This person is no longer eligible. Reload and choose another recipient.";
    default:
      return "We could not complete this request. Try again.";
  }
}
