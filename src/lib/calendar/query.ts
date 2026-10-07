import { z } from "zod";
import { typeLabels, type Credential } from "@/lib/register/schema";
import { isCalendarMonth } from "./dates";
export type SearchQuery = Record<string, string | string[] | undefined>;
export type CalendarQuery = {
  month: string;
  view?: "month" | "agenda";
  clinician?: string;
  type?: Credential["type"];
  jurisdiction?: string;
  invalidFilters: boolean;
  notices: ("month" | "view")[];
};
function field(
  raw: string | string[] | undefined,
  valid: (value: string) => boolean,
) {
  if (raw === undefined || raw === "")
    return { value: undefined, invalid: false };
  if (typeof raw !== "string" || raw.length > 246 || !valid(raw))
    return { value: undefined, invalid: true };
  return { value: raw, invalid: false };
}
function validJurisdiction(value: string) {
  if (value === "unknown") return true;
  if (!value.startsWith("value:")) return false;
  const text = value.slice(6);
  return (
    text.length > 0 &&
    text.trim() === text &&
    Array.from(text).length <= 120 &&
    !/[\uD800-\uDFFF\u0000]/u.test(text)
  );
}
export function parseCalendarQuery(
  raw: SearchQuery,
  today: string,
): CalendarQuery {
  const month = field(raw.month, isCalendarMonth);
  const view = field(
    raw.view,
    (value) => value === "month" || value === "agenda",
  );
  const clinician = field(
    raw.clinician,
    (value) => value === "practice" || z.uuid().safeParse(value).success,
  );
  const type = field(raw.type, (value) => Object.hasOwn(typeLabels, value));
  const jurisdiction = field(raw.jurisdiction, validJurisdiction);
  const notices: CalendarQuery["notices"] = [];
  if (month.invalid) notices.push("month");
  if (view.invalid) notices.push("view");
  return {
    month: month.value ?? today.slice(0, 7),
    ...(view.value ? { view: view.value as CalendarQuery["view"] } : {}),
    ...(clinician.value ? { clinician: clinician.value.toLowerCase() } : {}),
    ...(type.value ? { type: type.value as Credential["type"] } : {}),
    ...(jurisdiction.value ? { jurisdiction: jurisdiction.value } : {}),
    invalidFilters: clinician.invalid || type.invalid || jurisdiction.invalid,
    notices,
  };
}
export function calendarHref(
  query: CalendarQuery,
  path = "/practice/calendar",
): string {
  if (query.invalidFilters)
    throw new Error("Clear invalid filters before navigating");
  const params = new URLSearchParams({ month: query.month });
  for (const key of ["view", "clinician", "type", "jurisdiction"] as const) {
    const value = query[key];
    if (value !== undefined) params.set(key, value);
  }
  return `${path}?${params}`;
}
