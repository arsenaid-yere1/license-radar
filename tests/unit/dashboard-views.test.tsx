import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { projectDashboard } from "@/lib/dashboard/summary";
import { dashboardRecord as record } from "../helpers/dashboard-fixtures";
afterEach(cleanup);
const today = "2026-10-08";
it("Q03 Q12 complete urgent/missing lists agree with cards, semantic purposes, escaped titles and unique IDs", () => {
  const credentials = [
    record(1, "2026-10-07", "2026-10-06", {
      title: "Past",
      type: "malpractice_policy",
      covered_clinicians: [
        { id: "bbbbbbbb-0000-4000-8000-000000000090", name: "陈 & Rivera" },
      ],
    }),
    record(2, today),
    record(3, "2026-12-07"),
    record(4, null, today, { title: "<img src=x> & É" }),
    record(5, null),
    record(6, "2026-12-08"),
  ];
  const view = render(
    <DashboardPanel
      summary={projectDashboard({ clinicians: [], credentials }, today)}
    />,
  );
  const past = screen.getByRole("region", { name: "Past due" }),
    due = screen.getByRole("region", { name: "Due within 60 days" }),
    missing = screen.getByRole("region", {
      name: "Missing expiration / coverage end",
    });
  for (const [name, count] of [
    ["Past due", 1],
    ["Due within 60 days", 3],
    ["Missing expiration / coverage end", 2],
  ] as const) {
    expect(screen.getByRole("link", { name: `${count} ${name}` })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name })).getAllByRole("listitem"),
    ).toHaveLength(count);
  }
  expect(past.textContent).toContain("Covers: 陈 & Rivera");
  expect(past.textContent).toContain(
    "Tracking date: Oct 6, 2026 (earlier action deadline)",
  );
  expect(past.textContent).toContain("2 days past due");
  expect(due.textContent).toContain("Due in 60 days");
  expect(within(due).getAllByText("Due today")).toHaveLength(2);
  expect(missing.textContent).toContain("Dates not entered");
  expect(missing.textContent).toContain("Expiration date unknown");
  expect(missing.textContent).toContain(
    "may also appear in the dated lists above",
  );
  expect(view.container.querySelectorAll("img")).toHaveLength(0);
  expect(
    within(due)
      .getByRole("link", { name: "<img src=x> & É" })
      .getAttribute("href"),
  ).toBe(
    "/practice/register/aaaaaaaa-0000-4000-8000-000000000004?from=dashboard",
  );
  expect(
    view.container.querySelector('time[datetime="2026-12-07"]'),
  ).toBeTruthy();
  const ids = [...view.container.querySelectorAll("[id]")].map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    screen.getByText("1 record with a tracking date more than 60 days away."),
  ).toBeTruthy();
});
it("Q14 empty and later-only states are honest and retain full-register links", () => {
  const view = render(
    <DashboardPanel
      summary={projectDashboard({ clinicians: [], credentials: [] }, today)}
    />,
  );
  expect(screen.getByText("No active renewal records yet.")).toBeTruthy();
  expect(screen.getByText("No past-due tracking dates.")).toBeTruthy();
  expect(
    screen.getByText("No tracking dates due within 60 days."),
  ).toBeTruthy();
  expect(
    screen.getByText("No records with missing expiration or coverage end."),
  ).toBeTruthy();
  view.rerender(
    <DashboardPanel
      summary={projectDashboard(
        {
          clinicians: [],
          credentials: [record(1, "2026-12-08"), record(2, "2026-12-09")],
        },
        today,
      )}
    />,
  );
  expect(screen.queryByText("No active renewal records yet.")).toBeNull();
  expect(
    screen.getByText("2 records with a tracking date more than 60 days away."),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Review all records" })
      .getAttribute("href"),
  ).toBe("/practice/register");
  expect(
    screen
      .getByRole("link", { name: "Plan ahead in calendar" })
      .getAttribute("href"),
  ).toBe("/practice/calendar");
  expect(screen.queryByText(/all clear/i)).toBeNull();
});
