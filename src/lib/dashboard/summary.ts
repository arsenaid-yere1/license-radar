import type { MaintenanceRegister } from "@/lib/register/schema";
import { isCredentialDate, trackingDate } from "@/lib/register/dates";
export type DashboardEntry = {
  record: MaintenanceRegister["credentials"][number];
  tracking: { date: string; purpose: string } | null;
  days: number | null;
  urgency: "past-due" | "due-today" | "due-soon" | "later" | "undated";
};
export type DashboardSummary = Record<
  "pastDue" | "dueWithin60" | "later" | "undated" | "missingEnd",
  DashboardEntry[]
>;
function ordinal(value: string): number {
  if (!isCredentialDate(value)) throw new Error("Invalid credential date");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime() / 86400000;
}
export function calendarDayDifference(due: string, today: string): number {
  return ordinal(due) - ordinal(today);
}
function urgency(days: number): DashboardEntry["urgency"] {
  if (days < 0) return "past-due";
  if (days === 0) return "due-today";
  return days <= 60 ? "due-soon" : "later";
}
function entry(
  record: DashboardEntry["record"],
  today: string,
): DashboardEntry {
  const cycle = record.current_cycle;
  const tracking = trackingDate(
    cycle.end_date,
    cycle.action_deadline,
    record.type,
  );
  if (!tracking) return { record, tracking, days: null, urgency: "undated" };
  const days = calendarDayDifference(tracking.date, today);
  return { record, tracking, days, urgency: urgency(days) };
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function byName(a: DashboardEntry, b: DashboardEntry): number {
  return (
    compare(a.record.title, b.record.title) || compare(a.record.id, b.record.id)
  );
}
function byDate(a: DashboardEntry, b: DashboardEntry): number {
  return compare(a.tracking!.date, b.tracking!.date) || byName(a, b);
}
export function projectDashboard(
  register: MaintenanceRegister,
  today: string,
): DashboardSummary {
  ordinal(today);
  const entries = register.credentials
    .filter((r) => r.archived_at === null)
    .map((r) => entry(r, today));
  return {
    pastDue: entries.filter((e) => e.urgency === "past-due").sort(byDate),
    dueWithin60: entries
      .filter((e) => e.urgency === "due-today" || e.urgency === "due-soon")
      .sort(byDate),
    later: entries.filter((e) => e.urgency === "later").sort(byDate),
    undated: entries.filter((e) => e.urgency === "undated").sort(byName),
    missingEnd: entries
      .filter((e) => e.record.current_cycle.end_date === null)
      .sort(byName),
  };
}
