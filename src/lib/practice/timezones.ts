export function getSupportedTimezones(): string[] {
  return ["UTC", ...Intl.supportedValuesOf("timeZone")];
}
export function suggestedTimezone(
  candidate: string,
  supported: string[],
): string {
  return supported.includes(candidate) ? candidate : "UTC";
}
export function previewReminder(timezone: string): string {
  return `Example only · December 2, 2026 due date → October 3, 2026 at 09:00 (${timezone}).`;
}
