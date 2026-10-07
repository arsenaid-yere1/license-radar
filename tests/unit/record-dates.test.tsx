import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RecordDates } from "@/components/register/record-dates";
afterEach(cleanup);
it("C02 shared date markup preserves both purposes, tracking, optional metadata and explicit unknowns", () => {
  const record = {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    title: "License",
    type: "state_license" as const,
    owner_kind: "practice" as const,
    owner_clinician_id: null,
    owner_name: "Practice",
    version: 1,
    covered_clinicians: [],
    issuer: "Board",
    jurisdiction: "CA",
    current_cycle: {
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      cycle_number: 1 as const,
      date_revision: 1,
      end_date: "2028-02-29",
      action_deadline: "2028-02-01",
    },
  };
  const view = render(<RecordDates record={record} />);
  expect(screen.getByText("Licensing board: Board")).toBeTruthy();
  expect(screen.getByText("State or territory: CA")).toBeTruthy();
  expect(
    view.container.querySelectorAll('time[datetime="2028-02-01"]'),
  ).toHaveLength(2);
  expect(view.container.textContent).toContain(
    "Tracking date: Feb 1, 2028 (earlier action deadline)",
  );
  view.rerender(
    <RecordDates
      record={{
        ...record,
        issuer: null,
        jurisdiction: null,
        current_cycle: {
          ...record.current_cycle,
          end_date: null,
          action_deadline: null,
        },
      }}
    />,
  );
  expect(screen.getByText("Expiration date unknown")).toBeTruthy();
  expect(screen.getByText("Dates not entered")).toBeTruthy();
});
