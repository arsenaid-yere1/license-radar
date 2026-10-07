import { expect, it } from "vitest";
import { calendarHref, parseCalendarQuery } from "./query";
const today = "2026-10-07",
  id = "AAAAAAAA-0000-4000-8000-000000000001";
it("C04 defaults, notices and invalid filters stay distinct", () => {
  const defaults = { month: "2026-10", invalidFilters: false, notices: [] };
  expect(parseCalendarQuery({}, today)).toEqual(defaults);
  expect(
    parseCalendarQuery(
      {
        month: "",
        view: "",
        type: "",
        clinician: "",
        jurisdiction: "",
        practiceId: "foreign",
      },
      today,
    ),
  ).toEqual(defaults);
  for (const raw of [
    { month: ["2026-10", "2026-11"], view: ["month", "agenda"] },
    { month: "0000-01", view: "bad" },
  ])
    expect(parseCalendarQuery(raw, today)).toEqual({
      ...defaults,
      notices: ["month", "view"],
    });
  for (const raw of [
    { type: "toString" },
    { type: "bad" },
    { clinician: "bad" },
    { jurisdiction: "".padEnd(247, "x") },
    { jurisdiction: "value:" },
    { jurisdiction: "value: CA" },
    { jurisdiction: "value:\0" },
    { jurisdiction: "value:\ud800" },
    { jurisdiction: `value:${"🩺".repeat(121)}` },
  ])
    expect(parseCalendarQuery(raw, today).invalidFilters).toBe(true);
  for (const field of ["clinician", "type", "jurisdiction"])
    expect(
      parseCalendarQuery({ [field]: ["", "bad"] }, today).invalidFilters,
    ).toBe(true);
  expect(parseCalendarQuery({ clinician: id }, today).clinician).toBe(
    id.toLowerCase(),
  );
  expect(
    parseCalendarQuery(
      { clinician: "practice", view: "month", type: "state_license" },
      today,
    ),
  ).toMatchObject({
    clinician: "practice",
    view: "month",
    type: "state_license",
    invalidFilters: false,
  });
  expect(
    parseCalendarQuery({ jurisdiction: "unknown" }, today).jurisdiction,
  ).toBe("unknown");
  expect(
    parseCalendarQuery({ jurisdiction: "value:unknown" }, today).jurisdiction,
  ).toBe("value:unknown");
  expect(
    parseCalendarQuery({ jurisdiction: `value:${"🩺".repeat(120)}` }, today)
      .invalidFilters,
  ).toBe(false);
});
it("C04 C10 URL serialization keeps valid context and cannot drop invalid filters", () => {
  const query = parseCalendarQuery(
    {
      month: "0001-01",
      view: "agenda",
      clinician: id,
      type: "dea_registration",
      jurisdiction: "value:CA & É/🩺",
    },
    today,
  );
  const href = calendarHref(query);
  expect(href.startsWith("/practice/calendar?")).toBe(true);
  expect(
    parseCalendarQuery(
      Object.fromEntries(new URL(href, "http://fixture").searchParams),
      today,
    ),
  ).toEqual(query);
  expect(
    calendarHref(query, "/practice/register/record").startsWith(
      "/practice/register/record?",
    ),
  ).toBe(true);
  expect(calendarHref(parseCalendarQuery({}, today))).toBe(
    "/practice/calendar?month=2026-10",
  );
  expect(() =>
    calendarHref(parseCalendarQuery({ type: "bad" }, today)),
  ).toThrow("Clear invalid filters before navigating");
});
