export const unavailableMessage =
  "We could not confirm this save. Retry this save before leaving this page.";
export function renewalFormInput(
  form: FormData,
): Record<string, unknown> | null {
  const input: Record<string, unknown> = {};
  for (const [key, value] of form) {
    if (key.startsWith("$ACTION_")) continue;
    if (typeof value !== "string" || key in input) return null;
    input[key] = value;
  }
  return input;
}
function successMessage(intent: string | null) {
  return intent === "complete"
    ? "Renewal confirmed. New dates saved."
    : intent === "link"
      ? "Renewal link saved."
      : intent === "review"
        ? "Review acknowledged."
        : "Renewal progress saved.";
}
export function renewalMessage(
  status: string,
  intent: string | null = null,
): string {
  switch (status) {
    case "success":
      return successMessage(intent);
    case "invalid":
      return "Check the highlighted fields.";
    case "conflict":
      return "This record changed. Compare your draft with the saved values.";
    case "request-conflict":
      return "This save request was already used. Reload and review the saved record.";
    case "archived":
      return "This record is archived. Reload the register to review its history.";
    case "completed":
      return "This renewal cycle is completed. Reload the record.";
    case "not-found":
      return "This record is unavailable. Reload the register.";
    case "forbidden":
      return "You do not have permission to change renewal progress.";
    default:
      return unavailableMessage;
  }
}
