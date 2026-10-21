import React from "react";
import Link from "next/link";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { RenewalDetail } from "@/components/renewals/detail";
import { RenewalSummary } from "@/components/renewals/summary";
import { RegisterPanel } from "@/components/register/register-panel";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { projectDashboard } from "@/lib/dashboard/summary";
import { projectCalendar } from "@/lib/calendar/events";
import { parseCalendarQuery } from "@/lib/calendar/query";
import {
  renewalCredentialSchema,
  type RenewalAction,
} from "@/lib/renewals/schema";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  cycle = "bbbbbbbb-0000-4000-8000-000000000002";
const record = renewalCredentialSchema.parse({
  id,
  title: "Policy",
  type: "malpractice_policy",
  owner_kind: "practice",
  owner_clinician_id: null,
  owner_name: "Practice",
  version: 1,
  covered_clinicians: [],
  issuer: null,
  jurisdiction: null,
  current_cycle: {
    id: cycle,
    cycle_number: 1,
    date_revision: 1,
    end_date: "2000-01-01",
    action_deadline: null,
  },
  archived_at: null,
  renewal: {
    link: { url: "https://board.example.test/renew", version: 1 },
    workflow: {
      cycleId: cycle,
      status: "not-started",
      version: 1,
      acknowledgedAt: null,
    },
  },
});
function panel(
  action: RenewalAction,
  canEdit = true,
  data = record,
  readKey = "read1",
) {
  return (
    <RenewalDetail
      record={data}
      canEdit={canEdit}
      action={action}
      readKey={readKey}
      timezone="UTC"
      backLink={<Link href="/practice/dashboard">Back to dashboard</Link>}
      navigation={<Link href="/practice/reminders">Delivery history</Link>}
    />
  );
}
async function submit(label: string) {
  await act(async () => {
    fireEvent.submit(
      screen.getByRole("button", { name: label }).closest("form")!,
    );
  });
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("RW08 RW09 viewer summary keeps review progress and native external link independent", () => {
  const data = {
    ...record,
    renewal: {
      ...record.renewal,
      workflow: {
        ...record.renewal.workflow,
        status: "awaiting-approval" as const,
        acknowledgedAt: "2026-10-12T20:00:00+00:00",
      },
    },
  };
  render(panel(vi.fn(), false, data));
  expect(screen.queryByText("Awaiting approval")).not.toBeNull();
  expect(screen.getByText(/Reviewed/)).toBeTruthy();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  const link = screen.getByRole("link", { name: /Open renewal site/ });
  expect(link.getAttribute("href")).toBe(record.renewal.link.url);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(link.getAttribute("referrerpolicy")).toBe("no-referrer");
});
it("RW01 RW02 edits are explicit and cancellation makes no mutation", () => {
  const action = vi.fn();
  render(
    panel(action, true, {
      ...record,
      renewal: { ...record.renewal, link: { url: null, version: 1 } },
    }),
  );
  expect(screen.getByText(/No renewal link saved/)).toBeTruthy();
  expect(screen.getByText("Not started")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Change progress" }));
  expect(
    (screen.getByLabelText("Renewal progress") as HTMLSelectElement).value,
  ).toBe("not-started");
  expect(screen.getAllByRole("option").map((v) => v.textContent)).toEqual([
    "Not started",
    "In progress",
    "Awaiting approval",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(action).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Renewal progress")).toBeNull();
  expect(screen.getByRole("button", { name: "Change progress" })).toBe(
    document.activeElement,
  );
});
it("RW07 uncertain retries freeze exact context while newer read values beat historical receipt", async () => {
  let resolve!: (v: unknown) => void;
  const action = vi
    .fn()
    .mockRejectedValueOnce(new Error("secret"))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  const view = render(panel(action));
  fireEvent.click(screen.getByRole("button", { name: "Edit renewal link" }));
  fireEvent.change(screen.getByLabelText("Renewal link (optional)"), {
    target: { value: "https://draft.example.test" },
  });
  await submit("Save renewal link");
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Retry this save"),
  );
  expect(
    screen.getByLabelText("Renewal link (optional)").matches(":disabled"),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Cancel" }).matches(":disabled"),
  ).toBe(true);
  expect(screen.queryByRole("link", { name: "Back to dashboard" })).toBeNull();
  expect(
    screen.queryByRole("link", { name: "License Renewal Radar home" }),
  ).toBeNull();
  expect(screen.queryByRole("link", { name: /Open renewal site/ })).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Change progress" })
      .matches(":disabled"),
  ).toBe(true);
  const newer = {
    ...record,
    version: 2,
    renewal: {
      ...record.renewal,
      link: { url: "https://newer.example.test", version: 3 },
    },
  };
  view.rerender(panel(action, true, newer, "read2"));
  await submit("Retry this save");
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(Array.from(action.mock.calls[1][1])).toEqual(
    Array.from(action.mock.calls[0][1]),
  );
  expect(action.mock.calls[1][1].get("expectedVersion")).toBe("1");
  expect(action.mock.calls[1][1].get("expectedRenewalVersion")).toBe("1");
  resolve({
    status: "success",
    changed: true,
    credential: {
      ...record,
      renewal: {
        ...record.renewal,
        link: { url: "https://draft.example.test", version: 2 },
      },
    },
    message: "Renewal link saved.",
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Renewal link saved."),
  );
  expect(refresh).toHaveBeenCalledOnce();
  expect(
    screen
      .getByRole("button", { name: "Edit renewal link" })
      .matches(":disabled"),
  ).toBe(true);
  view.rerender(panel(action, true, newer, "read3"));
  expect(
    screen
      .getByRole("link", { name: /Open renewal site/ })
      .getAttribute("href"),
  ).toBe("https://newer.example.test");
  expect(
    screen
      .getByRole("button", { name: "Edit renewal link" })
      .matches(":disabled"),
  ).toBe(false);
});
it("RW07 validation preserves draft and conflict reload replaces it with fresh versions and key", async () => {
  const newer = {
    ...record,
    version: 2,
    current_cycle: { ...record.current_cycle, date_revision: 2 },
    renewal: {
      ...record.renewal,
      link: { url: "https://saved.example.test", version: 4 },
    },
  };
  const action = vi
    .fn()
    .mockResolvedValueOnce({
      status: "invalid",
      errors: {
        url: "Enter a valid HTTPS renewal link (up to 2,048 characters).",
      },
      message: "Check the highlighted fields.",
    })
    .mockResolvedValueOnce({
      status: "conflict",
      credential: newer,
      message: "This record changed. Compare your draft with the saved values.",
    })
    .mockResolvedValue({
      status: "success",
      changed: true,
      credential: newer,
      message: "Renewal link saved.",
    });
  render(panel(action));
  fireEvent.click(screen.getByRole("button", { name: "Edit renewal link" }));
  fireEvent.change(screen.getByLabelText("Renewal link (optional)"), {
    target: { value: "http://draft.example.test" },
  });
  await submit("Save renewal link");
  await waitFor(() =>
    expect(screen.getByRole("alert")).toBe(document.activeElement),
  );
  expect(
    (screen.getByLabelText("Renewal link (optional)") as HTMLInputElement)
      .value,
  ).toBe("http://draft.example.test");
  expect(
    screen
      .getByLabelText("Renewal link (optional)")
      .getAttribute("aria-invalid"),
  ).toBe("true");
  await submit("Save renewal link");
  await waitFor(() =>
    expect(screen.getByText("Saved values for comparison")).toBeTruthy(),
  );
  expect(
    screen.getByLabelText("Renewal link (optional)").matches(":disabled"),
  ).toBe(true);
  expect(
    (screen.getByLabelText("Renewal link (optional)") as HTMLInputElement)
      .value,
  ).toBe("http://draft.example.test");
  fireEvent.click(screen.getByRole("button", { name: "Reload saved values" }));
  expect(
    (screen.getByLabelText("Renewal link (optional)") as HTMLInputElement)
      .value,
  ).toBe("https://saved.example.test");
  await submit("Save renewal link");
  await waitFor(() => expect(action).toHaveBeenCalledTimes(3));
  expect(action.mock.calls[2][1].get("requestId")).not.toBe(
    action.mock.calls[1][1].get("requestId"),
  );
  expect(action.mock.calls[2][1].get("expectedVersion")).toBe("2");
  expect(action.mock.calls[2][1].get("expectedDateRevision")).toBe("2");
  expect(action.mock.calls[2][1].get("expectedRenewalVersion")).toBe("4");
});
it("RW03 review confirmation carries no progress actor or timestamp fields", async () => {
  const action = vi.fn().mockResolvedValue({
    status: "success",
    changed: true,
    credential: record,
    message: "Review acknowledged.",
  });
  render(panel(action));
  fireEvent.click(screen.getByRole("button", { name: "Acknowledge review" }));
  expect(screen.getByText(/Acknowledgement does not complete/)).toBeTruthy();
  await submit("Confirm review");
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  const f = action.mock.calls[0][1];
  expect(f.get("intent")).toBe("review");
  for (const field of ["progress", "actor", "acknowledgedAt", "url"])
    expect(f.has(field)).toBe(false);
});
it("RW05 terminal outcomes stop saves and offer a fresh document reload", async () => {
  for (const status of [
    "forbidden",
    "request-conflict",
    "archived",
    "completed",
    "not-found",
  ]) {
    const action = vi
      .fn()
      .mockResolvedValue({ status, message: "Reload to review" });
    const view = render(panel(action));
    fireEvent.click(screen.getByRole("button", { name: "Change progress" }));
    await submit("Save progress");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Reload to review"),
    );
    expect(
      screen
        .getByRole("button", { name: "Save progress" })
        .matches(":disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("link", { name: "Reload record" }).getAttribute("href"),
    ).toBe(`/practice/register/${id}`);
    view.unmount();
  }
});
it("RW07 authoritative register progress survives a maintenance receipt without renewal", async () => {
  const authoritative = {
    ...record,
    renewal: {
      ...record.renewal,
      workflow: {
        ...record.renewal.workflow,
        status: "awaiting-approval" as const,
        version: 5,
      },
    },
    suspected_duplicate_ids: [],
  };
  const { renewal: unused, ...historic } = record;
  expect(unused).toEqual(record.renewal);
  const action = vi.fn().mockResolvedValue({
    status: "success",
    changed: true,
    credential: { ...historic, version: 2, title: "Saved change" },
    message: "Changes saved.",
  });
  const make = (data = authoritative, readKey = "read1") => (
    <RegisterPanel
      register={{ clinicians: [], credentials: [data] }}
      canEdit
      action={vi.fn()}
      maintenanceAction={action}
      readKey={readKey}
      clinicianKey="c"
      credentialKey="k"
    />
  );
  const view = render(make());
  expect(screen.queryByText("Awaiting approval")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit record" }));
  await submit("Save changes");
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Changes saved."),
  );
  expect(screen.queryByText("Awaiting approval")).not.toBeNull();
  expect(screen.queryByText("Not started")).toBeNull();
  view.rerender(
    make({ ...authoritative, version: 3, title: "Latest" }, "read2"),
  );
  expect(screen.getByText("Awaiting approval")).toBeTruthy();
});
it("RW04 workload dates and counts persist in every progress and review state", () => {
  const base = { ...record, suspected_duplicate_ids: [] },
    missing = {
      ...base,
      id: cycle,
      current_cycle: { ...record.current_cycle, id, end_date: null },
      renewal: {
        ...record.renewal,
        workflow: { ...record.renewal.workflow, cycleId: id },
      },
    };
  const query = parseCalendarQuery({ month: "2000-01" }, "2026-10-12"),
    initial = projectCalendar(
      { clinicians: [], credentials: [base, missing] },
      query,
    ).events.map(({ record: r, ...e }) => ({ recordId: r.id, ...e }));
  for (const status of [
    "not-started",
    "in-progress",
    "awaiting-approval",
  ] as const) {
    const credentials = [base, missing].map((r) => ({
      ...r,
      renewal: {
        ...r.renewal,
        workflow: {
          ...r.renewal.workflow,
          status,
          acknowledgedAt: "2026-10-12T20:00:00Z",
        },
      },
    }));
    const data = { clinicians: [], credentials };
    const summary = projectDashboard(data, "2026-10-12");
    expect(summary.pastDue).toHaveLength(1);
    expect(summary.missingEnd).toHaveLength(1);
    expect(
      projectCalendar(data, query).events.map(({ record: r, ...e }) => ({
        recordId: r.id,
        ...e,
      })),
    ).toEqual(initial);
    const v = render(<DashboardPanel summary={summary} />);
    expect(
      within(screen.getByRole("region", { name: "Past due" })).getByText(
        status === "not-started"
          ? "Not started"
          : status === "in-progress"
            ? "In progress"
            : "Awaiting approval",
      ),
    ).toBeTruthy();
    v.unmount();
  }
  render(<RenewalSummary />);
  expect(screen.getByText("Refresh to see renewal progress.")).toBeTruthy();
});
it("RC08 confirmation begins blank unchecked and freezes its exact uncertain payload", async () => {
  const action = vi
    .fn()
    .mockResolvedValue({ status: "unavailable", message: "Retry this save" });
  render(panel(action));
  fireEvent.click(
    screen.getByRole("button", { name: "Record confirmed renewal" }),
  );
  expect(
    (screen.getByLabelText("New coverage end date") as HTMLInputElement).value,
  ).toBe("");
  expect(
    (screen.getByLabelText(/I have confirmed/) as HTMLInputElement).checked,
  ).toBe(false);
  fireEvent.change(screen.getByLabelText("New coverage end date"), {
    target: { value: "2090-03-02" },
  });
  fireEvent.click(screen.getByLabelText(/I have confirmed/));
  await submit("Confirm renewal and new dates");
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("Retry this save"),
  );
  expect(
    screen.getByLabelText("New coverage end date").matches(":disabled"),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Cancel" }).matches(":disabled"),
  ).toBe(true);
  await submit("Retry this save");
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(Array.from(action.mock.calls[0][1])).toEqual(
    Array.from(action.mock.calls[1][1]),
  );
  expect(action.mock.calls[1][1].get("intent")).toBe("complete");
  expect(action.mock.calls[1][1].get("endDate")).toBe("2090-03-02");
  expect(action.mock.calls[1][1].get("confirmed")).toBe("true");
});
