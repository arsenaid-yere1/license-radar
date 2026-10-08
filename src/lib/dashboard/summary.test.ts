import { expect, it } from "vitest";
import { calendarDayDifference, projectDashboard } from "./summary";
import {
  dashboardRecord as record,
  dashboardId as id,
} from "../../../tests/helpers/dashboard-fixtures";
const today = "2026-10-08";
it("Q01 exact -1/0/1/59/60/61 tracking boundaries", () => {
  const dates = [
    "2026-10-07",
    today,
    "2026-10-09",
    "2026-12-06",
    "2026-12-07",
    "2026-12-08",
  ];
  const r = projectDashboard(
    {
      clinicians: [],
      credentials: dates.map((date, n) => record(n + 1, date)),
    },
    today,
  );
  expect(r.pastDue.map((e) => [e.record.id, e.days, e.urgency])).toEqual([
    [id(1), -1, "past-due"],
  ]);
  expect(r.dueWithin60.map((e) => [e.record.id, e.days, e.urgency])).toEqual([
    [id(2), 0, "due-today"],
    [id(3), 1, "due-soon"],
    [id(4), 59, "due-soon"],
    [id(5), 60, "due-soon"],
  ]);
  expect(r.later.map((e) => [e.record.id, e.days, e.urgency])).toEqual([
    [id(6), 61, "later"],
  ]);
  expect(r.undated).toEqual([]);
  expect(r.missingEnd).toEqual([]);
});
it("Q02 Q03 precedence, shared policy cardinality and exact missing-end overlap", () => {
  const policy = record(1, "2026-12-08", "2026-10-07", {
    type: "malpractice_policy",
    covered_clinicians: [
      { id: id(90), name: "A" },
      { id: id(91), name: "B" },
    ],
  });
  const r = projectDashboard(
    {
      clinicians: [],
      credentials: [
        policy,
        { ...policy, id: id(2) },
        record(3, null),
        record(4, null, today),
        record(5, today, null, {
          type: "dea_registration",
          owner_kind: "clinician",
          owner_clinician_id: id(90),
        }),
      ],
    },
    today,
  );
  expect(r.pastDue.map((e) => [e.record.id, e.tracking])).toEqual(
    [1, 2].map((n) => [
      id(n),
      { date: "2026-10-07", purpose: "earlier action deadline" },
    ]),
  );
  expect(r.dueWithin60.map((e) => e.record.id)).toEqual([id(4), id(5)]);
  expect(
    r.undated.map((e) => [e.record.id, e.days, e.tracking, e.urgency]),
  ).toEqual([[id(3), null, null, "undated"]]);
  expect(r.missingEnd.map((e) => e.record.id)).toEqual([id(3), id(4)]);
  expect(
    projectDashboard(
      {
        clinicians: [],
        credentials: [record(6, today, null, { type: "malpractice_policy" })],
      },
      today,
    ).dueWithin60[0].tracking,
  ).toEqual({ date: today, purpose: "coverage end" });
});
it("Q04 deterministic ordering, archive exclusion and immutable inputs", () => {
  const credentials = [
    record(2, today, null, { title: "A" }),
    record(1, today, null, { title: "A" }),
    record(3, today, null, { title: "Z" }),
    record(4, null, null, { title: "Z" }),
    record(5, null, null, { title: "A" }),
    record(6, today, null, { archived_at: "2026-10-08T00:00:00Z" }),
  ];
  const register = { clinicians: [], credentials },
    before = structuredClone(register);
  const r = projectDashboard(register, today);
  expect(r.dueWithin60.map((e) => e.record.id)).toEqual([id(1), id(2), id(3)]);
  expect(r.undated.map((e) => e.record.id)).toEqual([id(5), id(4)]);
  expect(r.missingEnd.map((e) => e.record.id)).toEqual([id(5), id(4)]);
  expect(register).toEqual(before);
  expect(
    projectDashboard(
      { clinicians: [], credentials: [...credentials].reverse() },
      today,
    ),
  ).toEqual(r);
});
it("Q05 Gregorian leap centuries, low years, supported extremes and invalid inputs", () => {
  for (const [due, from, days] of [
    ["1900-03-01", "1900-02-28", 1],
    ["2000-03-01", "2000-02-28", 2],
    ["0100-01-01", "0099-12-31", 1],
    ["0001-01-02", "0001-01-01", 1],
    ["9999-12-31", "9999-12-30", 1],
    ["2026-03-09", "2026-03-07", 2],
  ] as const) {
    expect(calendarDayDifference(due, from)).toBe(days);
    expect(calendarDayDifference(from, due)).toBe(-days);
  }
  expect(
    projectDashboard(
      { clinicians: [], credentials: [record(1, "9999-12-31")] },
      "9999-12-31",
    ).dueWithin60[0].days,
  ).toBe(0);
  for (const invalid of [
    "bad",
    "0000-01-01",
    "10000-01-01",
    "1900-02-29",
    "2026-10-08\n",
    "2026-01-00",
  ]) {
    expect(() => calendarDayDifference(invalid, today)).toThrow(
      "Invalid credential date",
    );
    expect(() => calendarDayDifference(today, invalid)).toThrow(
      "Invalid credential date",
    );
    expect(() =>
      projectDashboard({ clinicians: [], credentials: [] }, invalid),
    ).toThrow("Invalid credential date");
  }
  expect(projectDashboard({ clinicians: [], credentials: [] }, today)).toEqual({
    pastDue: [],
    dueWithin60: [],
    later: [],
    undated: [],
    missingEnd: [],
  });
});
