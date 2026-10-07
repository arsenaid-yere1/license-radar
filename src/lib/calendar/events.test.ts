import { expect, it } from "vitest";
import type { MaintenanceRegister } from "@/lib/register/schema";
import { matchesCalendarFilters, projectCalendar } from "./events";
import { parseCalendarQuery } from "./query";
const id = (n: number) =>
  `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
function record(
  n: number,
  patch: Partial<MaintenanceRegister["credentials"][number]> = {},
) {
  return {
    id: id(n),
    title: "Record",
    type: "state_license" as const,
    owner_kind: "practice" as const,
    owner_clinician_id: null,
    owner_name: "Practice",
    version: 1,
    covered_clinicians: [],
    issuer: null,
    jurisdiction: "CA",
    archived_at: null,
    suspected_duplicate_ids: [],
    current_cycle: {
      id: id(n + 100),
      cycle_number: 1 as const,
      date_revision: 3,
      end_date: "2028-02-29",
      action_deadline: "2028-02-01",
    },
    ...patch,
  };
}
it("C01 C02 exact purposes, dates, tracking and stable identities exclude archive without mutation", () => {
  const credentials = [
    record(1),
    record(2, { type: "dea_registration" }),
    record(3, { type: "malpractice_policy" }),
    record(4, { archived_at: "2026-10-07T00:00:00Z" }),
    record(5, {
      current_cycle: {
        id: id(105),
        cycle_number: 1,
        date_revision: 1,
        end_date: null,
        action_deadline: null,
      },
    }),
  ];
  const register = { clinicians: [], credentials },
    before = structuredClone(register),
    q = parseCalendarQuery({ month: "2028-02" }, "2026-10-07");
  const result = projectCalendar(register, q);
  expect(
    result.events.map((e) => [
      e.id,
      e.date,
      e.purpose,
      e.tracking,
      e.dateRevision,
    ]),
  ).toEqual([
    [id(101) + ":action", "2028-02-01", "earlier action deadline", true, 3],
    [id(102) + ":action", "2028-02-01", "earlier action deadline", true, 3],
    [id(103) + ":action", "2028-02-01", "earlier action deadline", true, 3],
    [id(101) + ":end", "2028-02-29", "expiration", false, 3],
    [id(102) + ":end", "2028-02-29", "expiration", false, 3],
    [id(103) + ":end", "2028-02-29", "coverage end", false, 3],
  ]);
  expect(result.undated.map((r) => r.id)).toEqual([id(5)]);
  expect(register).toEqual(before);
  expect(projectCalendar(register, { ...q, month: "2028-01" })).toEqual({
    events: [],
    undated: [credentials[4]],
  });
  const endOnly = record(6, {
    current_cycle: {
      id: id(106),
      cycle_number: 1,
      date_revision: 1,
      end_date: "2028-02-29",
      action_deadline: null,
    },
  });
  const actionOnly = record(7, {
    current_cycle: {
      ...endOnly.current_cycle,
      id: id(107),
      end_date: null,
      action_deadline: "2028-02-01",
    },
  });
  expect(
    projectCalendar(
      { clinicians: [], credentials: [endOnly, actionOnly] },
      q,
    ).events.map((e) => [e.date, e.tracking]),
  ).toEqual([
    ["2028-02-01", true],
    ["2028-02-29", true],
  ]);
});
it("C03 combined filters match direct ownership or shared coverage without multiplying policy dates", () => {
  const policy = record(1, {
      type: "malpractice_policy",
      covered_clinicians: [
        { id: id(10), name: "Rivera" },
        { id: id(11), name: "Chen" },
      ],
    }),
    owned = record(2, { owner_kind: "clinician", owner_clinician_id: id(10) });
  const register = { clinicians: [], credentials: [policy, owned] },
    query = parseCalendarQuery(
      { month: "2028-02", clinician: id(10) },
      "2026-10-07",
    );
  expect(projectCalendar(register, query).events).toHaveLength(4);
  expect(
    projectCalendar(register, {
      ...query,
      type: "malpractice_policy",
      jurisdiction: "value:CA",
    }).events,
  ).toHaveLength(2);
  expect(matchesCalendarFilters(policy, { ...query, clinician: id(12) })).toBe(
    false,
  );
  expect(
    matchesCalendarFilters(policy, { ...query, clinician: "practice" }),
  ).toBe(true);
  expect(
    matchesCalendarFilters(owned, { ...query, clinician: "practice" }),
  ).toBe(false);
  expect(
    projectCalendar(register, { ...query, jurisdiction: "unknown" }).events,
  ).toEqual([]);
  expect(
    matchesCalendarFilters(record(4, { jurisdiction: null }), {
      ...query,
      clinician: undefined,
      jurisdiction: "unknown",
    }),
  ).toBe(true);
  expect(
    matchesCalendarFilters(record(4, { jurisdiction: "unknown" }), {
      ...query,
      clinician: undefined,
      jurisdiction: "value:unknown",
    }),
  ).toBe(true);
  expect(
    matchesCalendarFilters(policy, { ...query, jurisdiction: "value:NY" }),
  ).toBe(false);
  expect(projectCalendar(register, { ...query, invalidFilters: true })).toEqual(
    { events: [], undated: [] },
  );
});
it("C01 C09 deterministic tie order and corrections retain identity rather than merging similar records", () => {
  const a = record(1, { title: "Z" }),
    b = record(2, { title: "A" }),
    q = parseCalendarQuery({ month: "2028-02" }, "2026-10-07");
  expect(
    projectCalendar({ clinicians: [], credentials: [a, b] }, q).events.map(
      (e) => e.record.id,
    ),
  ).toEqual([b.id, a.id, b.id, a.id]);
  const corrected = {
    ...b,
    current_cycle: {
      ...b.current_cycle,
      end_date: "2028-03-01",
      date_revision: 4,
    },
  };
  expect(
    projectCalendar({ clinicians: [], credentials: [corrected] }, q).events.map(
      (e) => [e.id, e.dateRevision],
    ),
  ).toEqual([[id(102) + ":action", 4]]);
});
