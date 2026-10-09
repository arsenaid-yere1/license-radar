import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const boundary = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  read: vi.fn(),
  config: vi.fn(),
  webhook: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: boundary.user }));
vi.mock("@/lib/practice/access", () => ({
  getPracticeAccess: boundary.access,
}));
vi.mock("@/lib/reminders/repository", () => ({
  getReminderSchedule: boundary.read,
}));
vi.mock("@/lib/reminders/config", () => ({
  emailConfig: boundary.config,
  emailWebhookConfig: boundary.webhook,
}));
vi.mock("@/app/practice/reminders/actions", () => ({
  emailPreferenceAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: boundary.refresh }),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import Reminders from "@/app/practice/reminders/page";
import { EmailPreferenceForm } from "@/components/reminders/preference-form";
const id = "10000000-0000-4000-8000-000000000001",
  preference = { enabled: true, version: 1, canEnable: true };
const row = {
  id,
  cycleId: id,
  title: "Renewal record",
  dueDate: "2030-03-02",
  datePurpose: "action-deadline",
  timezone: "UTC",
  target: "2030-01-01T09:00:00Z",
  nextSendAt: "2030-01-02T09:00:00Z",
  state: "queued",
  delivery: null,
  reason: "catch-up-unavailable",
};
const schedule = {
  rows: [row],
  nextCursor: id,
  emailReadiness: "ready",
  smsOptional: true,
  lastSuccessAt: null,
  oldestDueAt: null,
  preference,
};
const page = (after?: string) =>
  Reminders({ searchParams: Promise.resolve({ after }) });
beforeEach(() => {
  vi.resetAllMocks();
  boundary.user.mockResolvedValue({ client: {} });
  boundary.access.mockResolvedValue({
    status: "success",
    access: { role: "viewer", practice: { id, timezone: "UTC" } },
  });
  boundary.read.mockResolvedValue({ status: "success", schedule });
  boundary.config.mockReturnValue(null);
  boundary.webhook.mockReturnValue(null);
});
afterEach(cleanup);
it("RU01 identity, current access, cursor and storage failures stop status disclosure", async () => {
  boundary.user.mockRejectedValueOnce(new Error("REDIRECT:/login"));
  await expect(page()).rejects.toThrow("REDIRECT:/login");
  expect(boundary.read).not.toHaveBeenCalled();
  boundary.access.mockResolvedValueOnce({ status: "unavailable" });
  await expect(page()).rejects.toThrow("We could not complete this request");
  boundary.access.mockResolvedValueOnce({ status: "success", access: null });
  await expect(page()).rejects.toThrow("REDIRECT:/onboarding/practice");
  await expect(page("foreign")).rejects.toThrow("REDIRECT:/practice/reminders");
  boundary.read.mockResolvedValueOnce({ status: "unavailable" });
  await expect(page()).rejects.toThrow("We could not complete this request");
});
it("RU02 dates, catch-up, channel readiness, cursor and stale health are truthful", async () => {
  const view = render(await page(id));
  expect(boundary.read).toHaveBeenLastCalledWith({}, id, "unconfigured", id);
  expect(screen.getByText(/Email sending is off/)).toBeTruthy();
  expect(screen.getByText(/Catch-up not available yet/)).toBeTruthy();
  expect(screen.getByText("Action deadline")).toBeTruthy();
  expect(screen.getByText("Next sending window")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Next records" }).getAttribute("href"),
  ).toBe(`/practice/reminders?after=${id}`);
  expect(screen.queryByText(/worker has not reported success/)).toBeNull();
  view.unmount();
  boundary.config.mockReturnValue({ namespace: "configured" });
  boundary.webhook.mockReturnValue({ namespace: "configured" });
  boundary.read.mockResolvedValue({
    status: "success",
    schedule: {
      ...schedule,
      rows: [
        {
          ...row,
          datePurpose: "end-date",
          dueDate: null,
          target: null,
          nextSendAt: null,
          delivery: "uncertain",
          reason: "missing-date",
        },
      ],
      nextCursor: null,
      emailReadiness: "email-disabled",
    },
  });
  render(await page());
  expect(screen.getByText(/worker has not reported success/)).toBeTruthy();
  expect(screen.getByText("End date")).toBeTruthy();
  expect(screen.getByText("No date entered")).toBeTruthy();
  expect(screen.getByText(/uncertain/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Next records" })).toBeNull();
});
it("RU03 saving a personal preference creates an opaque request, focuses feedback, refreshes, and blocks ambiguous retry", async () => {
  const action = vi.fn().mockResolvedValue({
    status: "success",
    preference: { ...preference, enabled: false, version: 2 },
    message: "Saved preference.",
  });
  const view = render(
    <EmailPreferenceForm preference={preference} action={action} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Disable my reminder emails" }),
  );
  await waitFor(() =>
    expect(screen.getByText("Saved preference.")).toBe(document.activeElement),
  );
  expect(boundary.refresh).toHaveBeenCalledOnce();
  expect(action.mock.calls[0][1].get("requestId")).toMatch(/^[0-9a-f-]{36}$/);
  expect(action.mock.calls[0][1].get("enabled")).toBe("false");
  expect(
    screen.getByRole("button", { name: "Enable my reminder emails" }),
  ).toBeTruthy();
  view.unmount();
  const broken = vi.fn().mockRejectedValue(new Error("private"));
  render(<EmailPreferenceForm preference={preference} action={broken} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Disable my reminder emails" }),
  );
  await waitFor(() =>
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "We could not confirm this change. Reload before trying again.",
    ),
  );
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});
it("RU04 a viewer with disabled emails cannot enable them; empty records and fresh health remain readable", async () => {
  boundary.config.mockReturnValue({});
  boundary.read.mockResolvedValue({
    status: "success",
    schedule: {
      ...schedule,
      rows: [],
      lastSuccessAt: new Date().toISOString(),
      preference: { enabled: false, version: 2, canEnable: false },
    },
  });
  render(await page());
  expect(
    screen.queryByRole("button", { name: "Enable my reminder emails" }),
  ).toBeNull();
  expect(screen.getByText("No renewal records yet.")).toBeTruthy();
  expect(screen.queryByText(/worker has not reported success/)).toBeNull();
});
it("RU05 refreshed server versions and current viewer authority replace stale saved feedback", async () => {
  const action = vi.fn().mockResolvedValue({
    status: "success",
    preference: { ...preference, enabled: false, version: 2 },
    message: "Saved.",
  });
  const view = render(
    <EmailPreferenceForm preference={preference} action={action} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Disable my reminder emails" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Enable my reminder emails" }),
    ).toBeTruthy(),
  );
  view.rerender(
    <EmailPreferenceForm
      preference={{ enabled: true, version: 3, canEnable: true }}
      action={action}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Disable my reminder emails" }),
  ).toBeTruthy();
  view.rerender(
    <EmailPreferenceForm
      preference={{ enabled: false, version: 4, canEnable: false }}
      action={action}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Enable my reminder emails" }),
  ).toBeNull();
});
it("RU06 consumed outcomes never advertise a future sending window", async () => {
  for (const state of [
    "submitting",
    "accepted",
    "failed",
    "uncertain",
    "suppressed",
    "canceled",
    "blocked",
  ]) {
    boundary.read.mockResolvedValue({
      status: "success",
      schedule: { ...schedule, rows: [{ ...row, state }] },
    });
    const view = render(await page());
    expect(screen.queryByText("Next sending window")).toBeNull();
    view.unmount();
  }
  for (const state of ["queued", "claimed"]) {
    boundary.read.mockResolvedValue({
      status: "success",
      schedule: { ...schedule, rows: [{ ...row, state }] },
    });
    const view = render(await page());
    expect(screen.getByText("Next sending window")).toBeTruthy();
    view.unmount();
  }
});
