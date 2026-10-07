import { trackingDate } from "@/lib/register/dates";
import type { MaintenanceRegister } from "@/lib/register/schema";
import type { CalendarQuery } from "./query";
export type CalendarRecord = MaintenanceRegister["credentials"][number];
export type CalendarEvent = {
  id: string;
  record: CalendarRecord;
  date: string;
  purpose: string;
  tracking: boolean;
  dateRevision: number;
};
export function matchesCalendarFilters(
  record: CalendarRecord,
  query: CalendarQuery,
): boolean {
  if (query.invalidFilters || record.archived_at !== null) return false;
  if (query.type && record.type !== query.type) return false;
  if (
    query.jurisdiction &&
    query.jurisdiction !==
      (record.jurisdiction === null
        ? "unknown"
        : `value:${record.jurisdiction}`)
  )
    return false;
  if (!query.clinician) return true;
  return matchesClinician(record, query.clinician);
}
function matchesClinician(record: CalendarRecord, clinician: string) {
  return clinician === "practice"
    ? record.owner_kind === "practice"
    : record.owner_clinician_id === clinician ||
        record.covered_clinicians.some((person) => person.id === clinician);
}
function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function projectCalendar(
  register: MaintenanceRegister,
  query: CalendarQuery,
): { events: CalendarEvent[]; undated: CalendarRecord[] } {
  const events: CalendarEvent[] = [],
    undated: CalendarRecord[] = [];
  for (const record of register.credentials) {
    if (!matchesCalendarFilters(record, query)) continue;
    const cycle = record.current_cycle,
      tracking = trackingDate(
        cycle.end_date,
        cycle.action_deadline,
        record.type,
      );
    if (!tracking) undated.push(record);
    for (const [key, date, purpose] of [
      [
        "end",
        cycle.end_date,
        record.type === "malpractice_policy" ? "coverage end" : "expiration",
      ],
      ["action", cycle.action_deadline, "earlier action deadline"],
    ]) {
      if (date && date.slice(0, 7) === query.month)
        events.push({
          id: `${cycle.id}:${key}`,
          record,
          date,
          purpose: purpose!,
          tracking: tracking?.date === date,
          dateRevision: cycle.date_revision,
        });
    }
  }
  events.sort(
    (a, b) =>
      compare(a.date, b.date) ||
      compare(a.record.title, b.record.title) ||
      compare(a.record.id, b.record.id) ||
      compare(a.purpose, b.purpose),
  );
  undated.sort((a, b) => compare(a.title, b.title) || compare(a.id, b.id));
  return { events, undated };
}
