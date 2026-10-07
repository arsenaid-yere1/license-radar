import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { CalendarPanel } from "@/components/calendar/calendar-panel";
import { parseCalendarQuery } from "@/lib/calendar/query";
import type { MaintenanceRegister } from "@/lib/register/schema";
afterEach(cleanup);
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  person = {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    name: "Rivera",
    version: 1,
  };
const record = {
  id,
  title: "<img src=x> Shared policy",
  type: "malpractice_policy" as const,
  owner_kind: "practice" as const,
  owner_clinician_id: null,
  owner_name: "Cedar",
  version: 1,
  covered_clinicians: [person],
  issuer: null,
  jurisdiction: "CA & É",
  archived_at: null,
  suspected_duplicate_ids: [],
  current_cycle: {
    id,
    cycle_number: 1 as const,
    date_revision: 1,
    end_date: "2028-02-29",
    action_deadline: "2028-02-01",
  },
};
const register: MaintenanceRegister = {
    clinicians: [person],
    credentials: [record],
  },
  today = "2028-02-01";
function show(raw: Record<string, string | string[]> = {}, data = register) {
  return render(
    <CalendarPanel
      register={data}
      query={parseCalendarQuery({ month: "2028-02", ...raw }, today)}
      today={today}
    />,
  );
}
it("C01 C10 C11 month and agenda show every purpose with fresh encoded detail links and semantic dates", () => {
  const v = show({
    view: "agenda",
    clinician: person.id,
    type: "malpractice_policy",
    jurisdiction: "value:CA & É",
  });
  expect(screen.getByRole("heading", { name: "February 2028" })).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "February 2028 renewal dates" }),
  ).toBeTruthy();
  const month = screen.getByRole("table"),
    agenda = screen.getByRole("region", { name: "February 2028 agenda" });
  for (const view of [month, agenda]) {
    const links = within(view).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toContain("earlier action deadline");
    expect(links[1].textContent).toContain("coverage end");
    for (const link of links) {
      expect(link.getAttribute("href")).toContain(
        `/practice/register/${id}?month=2028-02&view=agenda`,
      );
      expect(link.getAttribute("href")).toContain(
        "jurisdiction=value%3ACA+%26+%C3%89",
      );
      expect(link.textContent).toContain("Cedar");
      expect(link.textContent).toContain("Malpractice policy");
    }
  }
  expect(month.querySelector(".calendar-weekday")?.textContent).toBe("Tue");
  expect(
    month.querySelector('[aria-current="date"]')?.getAttribute("datetime"),
  ).toBe(today);
  expect(v.container.querySelector("img")).toBeNull();
  expect(v.container.querySelector('[data-view="agenda"]')).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Previous month" }).getAttribute("href"),
  ).toContain("month=2028-01&view=agenda");
  expect(
    screen.getByLabelText("Clinician or practice").getAttribute("name"),
  ).toBe("clinician");
  expect(
    screen.getByRole("link", { name: "Clear filters" }).getAttribute("href"),
  ).toBe("/practice/calendar?month=2028-02&view=agenda");
  expect(
    screen.getByRole("link", { name: "Refresh records" }).getAttribute("href"),
  ).toContain("month=2028-02");
});
it("C02 C08 C10 invalid/empty/undated/stale filters are explicit and never invent dates", () => {
  const invalid = show({ type: ["state_license", "malpractice_policy"] });
  expect(screen.getByRole("alert").textContent).toContain(
    "Choose valid filters",
  );
  expect(screen.queryByRole("link", { name: "Next month" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Agenda view" })).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  invalid.unmount();
  const empty = show({}, { clinicians: [], credentials: [] });
  expect(screen.getByText("No active renewal records yet.")).toBeTruthy();
  empty.unmount();
  const unknown = {
    ...record,
    title: "Unknown policy",
    id: person.id,
    current_cycle: {
      ...record.current_cycle,
      end_date: null,
      action_deadline: null,
    },
  };
  const undated = show(
    { month: "2030-01" },
    { ...register, credentials: [unknown] },
  );
  expect(screen.getByText("No matching dates this month.")).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Dates not entered" }).textContent,
  ).toContain("Unknown policy");
  undated.unmount();
  const stale = show({ clinician: "cccccccc-0000-4000-8000-000000000003" });
  expect(screen.getByText("Clinician unavailable")).toBeTruthy();
  expect(screen.getByText("No matching dates this month.")).toBeTruthy();
  stale.unmount();
  const staleJurisdiction = show({ jurisdiction: "value:NY" });
  expect(screen.getByText("Jurisdiction unavailable")).toBeTruthy();
  staleJurisdiction.unmount();
  const notices = show({ month: "bad", view: "bad" });
  expect(screen.getByText(/Month selection was invalid/)).toBeTruthy();
  expect(screen.getByText(/View selection was invalid/)).toBeTruthy();
  expect(notices.container.querySelector('[data-view="auto"]')).toBeTruthy();
});
it("C05 month bounds suppress impossible navigation and action-only unknown end remains visible", () => {
  const first = show({ month: "0001-01" });
  expect(screen.queryByRole("link", { name: "Previous month" })).toBeNull();
  first.unmount();
  const last = show({ month: "9999-12" });
  expect(screen.queryByRole("link", { name: "Next month" })).toBeNull();
  last.unmount();
  show(
    { view: "month" },
    {
      ...register,
      credentials: [
        {
          ...record,
          current_cycle: { ...record.current_cycle, end_date: null },
        },
      ],
    },
  );
  expect(screen.getAllByText("Coverage end date unknown")).toHaveLength(2);
  expect(
    screen.getByRole("region", { name: "Dates not entered" }).textContent,
  ).toContain("No matching records with missing dates.");
});
