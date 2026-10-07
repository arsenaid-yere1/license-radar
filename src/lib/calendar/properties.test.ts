import fc from "fast-check";
import { expect, it, vi } from "vitest";
import type { MaintenanceRegister } from "@/lib/register/schema";
import { projectCalendar } from "./events";
import {
  isCalendarMonth,
  monthDays,
  monthLabel,
  practiceToday,
  shiftMonth,
} from "./dates";
import { calendarHref, parseCalendarQuery } from "./query";
const id = (n: number) =>
  `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const types = [
  "state_license",
  "dea_registration",
  "malpractice_policy",
] as const;
const options = { seed: 20261007, numRuns: 1500 };
it("CP01 exact independent event sets preserve cardinality, archive/filter boundaries, dates and identity", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          type: fc.constantFrom(...types),
          name: fc.constantFrom("A", "Z", "Same", "É"),
          owner: fc.boolean(),
          covered: fc.constantFrom("none", "rivera", "chen", "both"),
          archive: fc.boolean(),
          end: fc.boolean(),
          action: fc.boolean(),
          jurisdiction: fc.constantFrom(null, "CA", "unknown"),
          day: fc.integer({ min: 2, max: 29 }),
        }),
        { minLength: 0, maxLength: 12 },
      ),
      fc.constantFrom(undefined, "practice", id(90), id(91), id(92)),
      fc.constantFrom(undefined, ...types),
      fc.constantFrom(
        undefined,
        "unknown",
        "value:CA",
        "value:unknown",
        "value:NY",
      ),
      fc.boolean(),
      (inputs, clinician, type, jurisdiction, invalidFilters) => {
        const credentials: MaintenanceRegister["credentials"] = inputs.map(
          (input, index) => ({
            id: id(index + 1),
            title: input.name,
            type: input.type,
            owner_kind: input.owner ? "clinician" : "practice",
            owner_clinician_id: input.owner ? id(90) : null,
            owner_name: input.owner ? "Rivera" : "Practice",
            version: 1,
            covered_clinicians:
              !input.owner &&
              input.type === "malpractice_policy" &&
              input.covered !== "none"
                ? [
                    ...(input.covered === "rivera" || input.covered === "both"
                      ? [{ id: id(90), name: "Rivera" }]
                      : []),
                    ...(input.covered === "chen" || input.covered === "both"
                      ? [{ id: id(91), name: "Chen" }]
                      : []),
                  ]
                : [],
            issuer: null,
            jurisdiction: input.jurisdiction,
            archived_at: input.archive ? "2026-01-01T00:00:00Z" : null,
            suspected_duplicate_ids: [],
            current_cycle: {
              id: id(index + 101),
              cycle_number: 1,
              date_revision: index + 1,
              end_date: input.end
                ? `2028-02-${String(input.day).padStart(2, "0")}`
                : null,
              action_deadline: input.action ? "2028-02-01" : null,
            },
          }),
        );
        const query = {
            month: "2028-02",
            clinician,
            type,
            jurisdiction,
            invalidFilters,
            notices: [],
          },
          register = { clinicians: [], credentials },
          before = structuredClone(register);
        const accepted = credentials.filter(
          (r) =>
            !invalidFilters &&
            r.archived_at === null &&
            (type === undefined || r.type === type) &&
            (jurisdiction === undefined ||
              (jurisdiction === "unknown"
                ? r.jurisdiction === null
                : `value:${r.jurisdiction}` === jurisdiction)) &&
            (clinician === undefined ||
              (clinician === "practice"
                ? r.owner_kind === "practice"
                : [
                    r.owner_clinician_id,
                    ...r.covered_clinicians.map((c) => c.id),
                  ].includes(clinician))),
        );
        const expected = accepted
          .flatMap((r) => {
            const c = r.current_cycle;
            return [
              ...(c.end_date
                ? [
                    {
                      id: c.id + ":end",
                      record: r,
                      date: c.end_date,
                      purpose:
                        r.type === "malpractice_policy"
                          ? "coverage end"
                          : "expiration",
                      tracking: c.action_deadline === null,
                      dateRevision: c.date_revision,
                    },
                  ]
                : []),
              ...(c.action_deadline
                ? [
                    {
                      id: c.id + ":action",
                      record: r,
                      date: c.action_deadline,
                      purpose: "earlier action deadline",
                      tracking: true,
                      dateRevision: c.date_revision,
                    },
                  ]
                : []),
            ];
          })
          .sort((a, b) => {
            for (const pair of [
              [a.date, b.date],
              [a.record.title, b.record.title],
              [a.record.id, b.record.id],
              [a.purpose, b.purpose],
            ]) {
              if (pair[0] !== pair[1]) return pair[0] < pair[1] ? -1 : 1;
            }
            return 0;
          });
        const undated = accepted
          .filter(
            (r) =>
              !r.current_cycle.end_date && !r.current_cycle.action_deadline,
          )
          .sort((a, b) =>
            a.title === b.title
              ? a.id.localeCompare(b.id)
              : a.title < b.title
                ? -1
                : 1,
          );
        expect(projectCalendar(register, query)).toEqual({
          events: expected,
          undated,
        });
        expect(register).toEqual(before);
        expect(
          projectCalendar(register, { ...query, month: "2028-03" }),
        ).toEqual({ events: [], undated });
      },
    ),
    options,
  );
});
it("CP02 independent weekdays, month boundaries, labels and practice dates across the full year range", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 9999 }),
      fc.integer({ min: 1, max: 12 }),
      (year, month) => {
        const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
        const first = new Date(0);
        first.setUTCFullYear(year, month - 1, 1);
        first.setUTCHours(12, 0, 0, 0);
        const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0),
          counts = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        const count = counts[month - 1],
          leading = first.getUTCDay(),
          days = monthDays(key).flat();
        expect(isCalendarMonth(key)).toBe(true);
        expect(days).toEqual(
          Array.from(
            { length: Math.ceil((count + leading) / 7) * 7 },
            (_, index) =>
              index < leading || index >= leading + count
                ? null
                : `${key}-${String(index - leading + 1).padStart(2, "0")}`,
          ),
        );
        for (const offset of [-1, 1] as const) {
          const index = (year - 1) * 12 + month - 1 + offset;
          expect(shiftMonth(key, offset)).toBe(
            index < 0 || index >= 9999 * 12
              ? null
              : `${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`,
          );
        }
        expect(practiceToday("UTC", first)).toBe(key + "-01");
        expect(monthLabel(key)).toBe(
          [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
          ][month - 1] +
            " " +
            year,
        );
        expect(isCalendarMonth(key + "\n")).toBe(false);
      },
    ),
    options,
  );
  for (const month of ["bad", "2026-13", "0000-01", "2026-01\n"]) {
    expect(() => monthDays(month)).toThrow("Invalid calendar month");
    expect(() => shiftMonth(month, 1)).toThrow("Invalid calendar month");
    expect(() => monthLabel(month)).toThrow("Invalid calendar month");
  }
  expect(shiftMonth("9999-12", 1)).toBeNull();
  expect(shiftMonth("0001-01", -1)).toBeNull();
  expect(
    practiceToday("America/Los_Angeles", new Date("2026-01-01T07:59:00Z")),
  ).toBe("2025-12-31");
  expect(practiceToday("Asia/Tokyo", new Date("2026-01-01T07:59:00Z"))).toBe(
    "2026-01-01",
  );
  expect(() => practiceToday("bad", new Date())).toThrow();
});
it("CP02 exact query round trips and invalid scalar rejection never broaden filters", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(undefined, "month", "agenda"),
      fc.constantFrom(undefined, "practice", id(90), id(91).toUpperCase()),
      fc.constantFrom(undefined, ...types),
      fc.integer({ min: 1, max: 121 }),
      fc.constantFrom("x", "🩺", "É", "&/", "unknown"),
      (view, clinician, type, count, text) => {
        const jurisdiction = "value:" + text.repeat(count),
          raw = { month: "2028-02", view, clinician, type, jurisdiction },
          q = parseCalendarQuery(raw, "2026-10-07"),
          valid = Array.from(text.repeat(count)).length <= 120;
        expect(q).toEqual({
          month: "2028-02",
          ...(view ? { view } : {}),
          ...(clinician ? { clinician: clinician.toLowerCase() } : {}),
          ...(type ? { type } : {}),
          ...(valid ? { jurisdiction } : {}),
          invalidFilters: !valid,
          notices: [],
        });
        if (valid) {
          const href = calendarHref(q);
          expect(href.startsWith("/practice/calendar?month=2028-02")).toBe(
            true,
          );
          const values = Object.fromEntries(
            new URL(href, "http://fixture").searchParams,
          );
          expect(parseCalendarQuery(values, "2026-10-07")).toEqual(q);
          expect(
            calendarHref(q, "/practice/register/record").startsWith(
              "/practice/register/record?",
            ),
          ).toBe(true);
        } else
          expect(() => calendarHref(q)).toThrow(
            "Clear invalid filters before navigating",
          );
      },
    ),
    options,
  );
  // Bound hostile text before allocating its Unicode code-point array.
  const allocate = vi.spyOn(Array, "from");
  let invalid = false,
    calls = -1;
  try {
    invalid = parseCalendarQuery(
      { jurisdiction: "value:" + "x".repeat(241) },
      "2026-10-07",
    ).invalidFilters;
    calls = allocate.mock.calls.length;
  } finally {
    allocate.mockRestore();
  }
  expect(invalid).toBe(true);
  expect(calls).toBe(0);
  const defaults = { month: "2026-10", notices: [], invalidFilters: false };
  expect(parseCalendarQuery({}, "2026-10-07")).toEqual(defaults);
  expect(calendarHref(parseCalendarQuery({}, "2026-10-07"))).toBe(
    "/practice/calendar?month=2026-10",
  );
  expect(
    parseCalendarQuery(
      {
        month: "",
        view: "",
        clinician: "",
        type: "",
        jurisdiction: "",
        foreign: "x",
      },
      "2026-10-07",
    ),
  ).toEqual(defaults);
  expect(
    parseCalendarQuery({ month: ["x"], view: ["x"] }, "2026-10-07"),
  ).toEqual({ ...defaults, notices: ["month", "view"] });
  expect(parseCalendarQuery({ view: "bad" }, "2026-10-07")).toEqual({
    ...defaults,
    notices: ["view"],
  });
  for (const field of ["clinician", "type", "jurisdiction"])
    for (const value of [[""], "<img>", "x".repeat(247)])
      expect(parseCalendarQuery({ [field]: value }, "2026-10-07")).toEqual({
        ...defaults,
        invalidFilters: true,
      });
  for (const value of [
    "value:",
    "value: CA",
    "value:CA ",
    "value:\0",
    "value:\ud800",
    "unknownx",
  ]) {
    expect(
      parseCalendarQuery({ jurisdiction: value }, "2026-10-07").invalidFilters,
    ).toBe(true);
  }
  expect(parseCalendarQuery({ jurisdiction: "unknown" }, "2026-10-07")).toEqual(
    { ...defaults, jurisdiction: "unknown" },
  );
});
