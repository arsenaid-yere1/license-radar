import { expect, it } from "vitest";
import {
  isCalendarMonth,
  monthDays,
  monthLabel,
  practiceToday,
  shiftMonth,
} from "./dates";
it("C05 exact bounded months and Gregorian Sunday-first grids", () => {
  for (const value of ["0001-01", "0099-12", "1900-02", "2000-02", "9999-12"])
    expect(isCalendarMonth(value)).toBe(true);
  for (const value of [
    "0000-01",
    "10000-01",
    "2026-00",
    "2026-13",
    "2026-1",
    "2026-01\n",
    "2026-01-01",
    "",
    "bad",
  ])
    expect(isCalendarMonth(value)).toBe(false);
  expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  expect(shiftMonth("0001-01", -1)).toBeNull();
  expect(shiftMonth("9999-12", 1)).toBeNull();
  expect(monthDays("2028-02").flat().filter(Boolean)).toHaveLength(29);
  expect(monthDays("1900-02").flat().filter(Boolean)).toHaveLength(28);
  expect(monthDays("2000-02").flat().filter(Boolean)).toHaveLength(29);
  expect(monthDays("0001-01")[0]).toEqual([
    null,
    "0001-01-01",
    "0001-01-02",
    "0001-01-03",
    "0001-01-04",
    "0001-01-05",
    "0001-01-06",
  ]);
  expect(monthDays("2026-02")[0][0]).toBe("2026-02-01");
  expect(monthDays("2028-02").at(-1)).toEqual([
    "2028-02-27",
    "2028-02-28",
    "2028-02-29",
    null,
    null,
    null,
    null,
  ]);
  expect(monthLabel("0099-12")).toBe("December 99");
  for (const invalid of ["bad", "0000-01"]) {
    expect(() => monthDays(invalid)).toThrow("Invalid calendar month");
    expect(() => shiftMonth(invalid, 1)).toThrow("Invalid calendar month");
    expect(() => monthLabel(invalid)).toThrow("Invalid calendar month");
  }
});
it("C06 today uses the practice zone at midnight and DST, never a guessed fallback", () => {
  const instant = new Date("2026-01-01T07:59:00Z");
  expect(practiceToday("America/Los_Angeles", instant)).toBe("2025-12-31");
  expect(practiceToday("Asia/Tokyo", instant)).toBe("2026-01-01");
  expect(practiceToday("UTC", new Date("2028-02-29T12:00:00Z"))).toBe(
    "2028-02-29",
  );
  expect(
    practiceToday("America/Los_Angeles", new Date("2026-03-08T10:00:00Z")),
  ).toBe("2026-03-08");
  expect(() => practiceToday("bad", instant)).toThrow();
  expect(() => practiceToday("UTC", new Date(NaN))).toThrow();
});
