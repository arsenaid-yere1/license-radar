import { isCredentialDate } from "@/lib/register/dates";

export function practiceToday(timezone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year.padStart(4, "0")}-${values.month}-${values.day}`;
}
export function isCalendarMonth(value: string): boolean {
  return isCredentialDate(`${value}-01`);
}
function monthStart(month: string): Date {
  if (!isCalendarMonth(month)) throw new Error("Invalid calendar month");
  const [year, number] = month.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, number - 1, 1);
  return date;
}
export function shiftMonth(month: string, offset: -1 | 1): string | null {
  const date = monthStart(month);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const year = date.getUTCFullYear();
  return year < 1 || year > 9999
    ? null
    : `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function monthDays(month: string): (string | null)[][] {
  const first = monthStart(month),
    weekday = first.getUTCDay();
  first.setUTCMonth(first.getUTCMonth() + 1, 0);
  const count = first.getUTCDate(),
    weeks = [];
  for (let start = 0; start < weekday + count; start += 7) {
    weeks.push(
      Array.from({ length: 7 }, (_, column) => {
        const day = start + column - weekday + 1;
        return day < 1 || day > count
          ? null
          : `${month}-${String(day).padStart(2, "0")}`;
      }),
    );
  }
  return weeks;
}
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthStart(month));
}
