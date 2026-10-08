import type { MaintenanceRegister } from "@/lib/register/schema";
export const dashboardId = (n: number) =>
  `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function dashboardRecord(
  n: number,
  end: string | null = "2026-10-08",
  action: string | null = null,
  patch: Partial<MaintenanceRegister["credentials"][number]> = {},
): MaintenanceRegister["credentials"][number] {
  return {
    id: dashboardId(n),
    title: `Record ${n}`,
    type: "state_license",
    owner_kind: "practice",
    owner_clinician_id: null,
    owner_name: "Cedar",
    version: 1,
    covered_clinicians: [],
    issuer: null,
    jurisdiction: null,
    archived_at: null,
    suspected_duplicate_ids: [],
    current_cycle: {
      id: dashboardId(n + 10000),
      cycle_number: 1,
      date_revision: 1,
      end_date: end,
      action_deadline: action,
    },
    ...patch,
  };
}
// Independent Gregorian oracle: elapsed days before year plus month/day offsets.
export function gregorianOrdinal(value: string) {
  const [year, month, day] = value.split("-").map(Number),
    prior = year - 1;
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const starts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return (
    365 * prior +
    Math.floor(prior / 4) -
    Math.floor(prior / 100) +
    Math.floor(prior / 400) +
    starts[month - 1] +
    (leap && month > 2 ? 1 : 0) +
    day
  );
}
