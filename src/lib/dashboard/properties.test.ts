import fc from "fast-check";
import { expect, it } from "vitest";
import {
  dashboardRecord as record,
  gregorianOrdinal,
} from "../../../tests/helpers/dashboard-fixtures";
import { calendarDayDifference, projectDashboard } from "./summary";
const options = { seed: 20261008, numRuns: 1500 };
const day = fc
  .tuple(
    fc.integer({ min: 1, max: 9999 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([y, m, d]) =>
      `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  );
it("QP02 independent Gregorian ordinals and invalid date rejection", () => {
  fc.assert(
    fc.property(day, day, (a, b) => {
      const expected = gregorianOrdinal(a) - gregorianOrdinal(b);
      expect(calendarDayDifference(a, b)).toBe(expected);
      expect(calendarDayDifference(b, a)).toBe(-expected);
      expect(calendarDayDifference(a, a)).toBe(0);
    }),
    options,
  );
  for (const value of ["bad", "0000-01-01", "2026-02-30", "2026-10-08\n"]) {
    expect(() => calendarDayDifference(value, "2026-10-08")).toThrow(
      "Invalid credential date",
    );
    expect(() => calendarDayDifference("2026-10-08", value)).toThrow(
      "Invalid credential date",
    );
    expect(() =>
      projectDashboard({ clinicians: [], credentials: [] }, value),
    ).toThrow("Invalid credential date");
  }
});
it("QP01 exact independent partitions, overlap, order, immutability and progress independence", () => {
  fc.assert(
    fc.property(
      day,
      fc.array(
        fc.record({
          a: day,
          b: day,
          end: fc.boolean(),
          action: fc.boolean(),
          archive: fc.boolean(),
          title: fc.constantFrom("A", "Z", "Same", "É"),
          type: fc.constantFrom(
            "state_license",
            "dea_registration",
            "malpractice_policy",
          ),
          owner: fc.boolean(),
        }),
        { maxLength: 20 },
      ),
      (today, inputs) => {
        const credentials = inputs.map((v, n) =>
          record(
            n + 1,
            v.end ? (v.a > v.b ? v.a : v.b) : null,
            v.action ? (v.a < v.b ? v.a : v.b) : null,
            {
              title: v.title,
              type: v.type,
              archived_at: v.archive ? "2026-10-08T00:00:00Z" : null,
              owner_kind: v.owner ? "clinician" : "practice",
              owner_clinician_id: v.owner
                ? "bbbbbbbb-0000-4000-8000-000000000090"
                : null,
              covered_clinicians:
                v.type === "malpractice_policy" && !v.owner
                  ? [
                      {
                        id: "bbbbbbbb-0000-4000-8000-000000000091",
                        name: "Rivera",
                      },
                    ]
                  : [],
            },
          ),
        );
        const active = credentials.filter((r) => r.archived_at === null),
          before = structuredClone(credentials);
        const expected = active.map((r) => {
          const c = r.current_cycle,
            date = c.action_deadline ?? c.end_date;
          const days =
            date === null
              ? null
              : gregorianOrdinal(date) - gregorianOrdinal(today);
          const urgency =
            days === null
              ? "undated"
              : days < 0
                ? "past-due"
                : days === 0
                  ? "due-today"
                  : days <= 60
                    ? "due-soon"
                    : "later";
          return {
            record: r,
            tracking:
              date === null
                ? null
                : {
                    date,
                    purpose:
                      c.action_deadline !== null
                        ? "earlier action deadline"
                        : r.type === "malpractice_policy"
                          ? "coverage end"
                          : "expiration",
                  },
            days,
            urgency,
          };
        });
        const namedSort = (
          a: (typeof expected)[number],
          b: (typeof expected)[number],
        ) =>
          a.record.title === b.record.title
            ? a.record.id < b.record.id
              ? -1
              : a.record.id > b.record.id
                ? 1
                : 0
            : a.record.title < b.record.title
              ? -1
              : 1;
        const datedSort = (
          a: (typeof expected)[number],
          b: (typeof expected)[number],
        ) =>
          a.tracking!.date === b.tracking!.date
            ? namedSort(a, b)
            : a.tracking!.date < b.tracking!.date
              ? -1
              : 1;
        const oracle = {
          pastDue: expected
            .filter((e) => e.days !== null && e.days < 0)
            .sort(datedSort),
          dueWithin60: expected
            .filter((e) => e.days !== null && e.days >= 0 && e.days <= 60)
            .sort(datedSort),
          later: expected
            .filter((e) => e.days !== null && e.days > 60)
            .sort(datedSort),
          undated: expected.filter((e) => e.days === null).sort(namedSort),
          missingEnd: expected
            .filter((e) => e.record.current_cycle.end_date === null)
            .sort(namedSort),
        };
        const r = projectDashboard({ clinicians: [], credentials }, today);
        expect(r).toEqual(oracle);
        expect(credentials).toEqual(before);
        expect(
          projectDashboard(
            { clinicians: [], credentials: [...credentials].reverse() },
            today,
          ),
        ).toEqual(oracle);
        const annotated = credentials.map((r) => ({
          ...r,
          workflowStatus: "in-progress",
        }));
        const p = projectDashboard(
          { clinicians: [], credentials: annotated },
          today,
        );
        for (const key of [
          "pastDue",
          "dueWithin60",
          "later",
          "undated",
          "missingEnd",
        ] as const)
          expect(p[key].map((e) => [e.record.id, e.days, e.urgency])).toEqual(
            oracle[key].map((e) => [e.record.id, e.days, e.urgency]),
          );
      },
    ),
    options,
  );
});
it("QP03 independently classified inclusive horizon boundaries across supported years", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 9998 }),
      fc.constantFrom(-1, 0, 1, 59, 60, 61),
      (year, distance) => {
        const today = `${String(year).padStart(4, "0")}-06-01`;
        const instant = new Date(0);
        instant.setUTCFullYear(year, 5, 1 + distance);
        const due = instant.toISOString().slice(0, 10);
        const expected = gregorianOrdinal(due) - gregorianOrdinal(today);
        const result = projectDashboard(
          { clinicians: [], credentials: [record(1, due)] },
          today,
        );
        const bucket =
          expected < 0 ? "pastDue" : expected <= 60 ? "dueWithin60" : "later";
        expect(result[bucket]).toHaveLength(1);
        expect(result[bucket][0].days).toBe(expected);
        expect(result[bucket][0].urgency).toBe(
          expected < 0
            ? "past-due"
            : expected === 0
              ? "due-today"
              : expected <= 60
                ? "due-soon"
                : "later",
        );
        expect(
          Object.entries(result)
            .filter(([name]) => name !== bucket)
            .flatMap(([, rows]) => rows),
        ).toEqual([]);
      },
    ),
    options,
  );
});
it("QP04 exact due-list order for nearby dates and title ties", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          distance: fc.integer({ min: 0, max: 60 }),
          title: fc.constantFrom("A", "Same", "Z", "É"),
        }),
        { minLength: 2, maxLength: 20 },
      ),
      (inputs) => {
        const today = "2026-06-01";
        const credentials = inputs.map((v, n) => {
          const d = new Date(0);
          d.setUTCFullYear(2026, 5, 1 + v.distance);
          return record(n + 1, d.toISOString().slice(0, 10), null, {
            title: v.title,
          });
        });
        const expected = [...credentials].sort((a, b) => {
          const da = gregorianOrdinal(a.current_cycle.end_date!),
            db = gregorianOrdinal(b.current_cycle.end_date!);
          return (
            da - db ||
            (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
          );
        });
        expect(
          projectDashboard(
            { clinicians: [], credentials },
            today,
          ).dueWithin60.map((e) => e.record.id),
        ).toEqual(expected.map((r) => r.id));
        expect(
          projectDashboard(
            { clinicians: [], credentials: [...credentials].reverse() },
            today,
          ).dueWithin60.map((e) => e.record.id),
        ).toEqual(expected.map((r) => r.id));
      },
    ),
    options,
  );
});
