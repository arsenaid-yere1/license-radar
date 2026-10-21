import type { EvidenceResult } from "./schema";
const messages = new Map<string, string>([
  ["available", "Evidence uploaded. Renewal dates are unchanged."],
  ["deleting", "Removed from this cycle; file cleanup pending."],
  ["deleted", "Evidence removed and file cleanup confirmed."],
  [
    "abandoned",
    "This upload was closed. Refresh evidence before starting again.",
  ],
  ["invalid", "Choose a valid PDF, JPEG or PNG file up to 3 MiB."],
  [
    "quota",
    "Evidence storage is full. Remove an attachment or wait for file cleanup.",
  ],
  ["forbidden", "Your current access does not allow this request."],
  ["not-found", "This evidence is unavailable."],
  ["archived", "Archived records cannot receive new evidence."],
  [
    "request-conflict",
    "This retry differs from the original request. Refresh evidence.",
  ],
  ["conflict", "Evidence changed. Refresh saved evidence before trying again."],
]);
export function evidenceMessage(status: string) {
  return (
    messages.get(status) ??
    "We could not confirm this request. Retry with the same file and request."
  );
}
export function evidenceStatus(result: EvidenceResult) {
  if (result.status === "success") return 200;
  if (result.status === "forbidden") return 403;
  if (result.status === "not-found") return 404;
  if (result.status === "invalid") return 400;
  if (result.status === "unavailable") return 503;
  return 409;
}
