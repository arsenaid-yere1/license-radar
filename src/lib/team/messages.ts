export const unavailableMessage =
  "We could not complete this request. Try again.";
const messages: Record<string, string> = {
  invalid: "Check the highlighted fields.",
  forbidden: "You do not have permission to do that.",
  conflict: "This access record changed. Reload before trying again.",
  "other-practice":
    "You already belong to a practice. Your access was not changed.",
  "invalid-invitation":
    "This invitation is unavailable. Ask an administrator for a new link.",
  "last-administrator":
    "Add another administrator before removing this access.",
  "invite-exists":
    "A pending invitation already exists for this email. Cancel or reissue it.",
  "already-member": "You already belong to this practice.",
};
export function accessMessage(status: string) {
  return messages[status] ?? unavailableMessage;
}
export function formInput(form: FormData) {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of form)
    if (key !== "intent" && !key.startsWith("$ACTION_")) raw[key] = value;
  if ("expectedVersion" in raw)
    raw.expectedVersion =
      typeof raw.expectedVersion === "string" &&
      /^[1-9]\d*$/.test(raw.expectedVersion)
        ? Number(raw.expectedVersion)
        : NaN;
  return raw;
}
