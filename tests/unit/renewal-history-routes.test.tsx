import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const b = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: b.user }));
vi.mock("@/lib/practice/access", () => ({ getPracticeAccess: b.access }));
vi.mock("@/lib/renewals/repository", () => ({ getRenewalHistory: b.read }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (s: string) => {
    throw new Error(`REDIRECT:${s}`);
  },
}));
import Page from "@/app/practice/register/[credentialId]/history/page";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  next = "bbbbbbbb-0000-4000-8000-000000000002";
const row = {
  id,
  cycleNumber: 1,
  dateRevision: 1,
  type: "malpractice_policy",
  endDate: "2030-03-02",
  actionDeadline: null,
  completedAt: null,
  successorId: null,
  progress: "not-started",
  acknowledgedAt: null,
};
const data = {
  status: "success",
  credentialId: id,
  title: "Policy",
  archivedAt: null,
  currentCycleId: id,
  cycles: [row],
  nextBeforeCycleNumber: null,
};
const load = (credentialId = id, before?: string | string[]) =>
  Page({
    params: Promise.resolve({ credentialId }),
    searchParams: Promise.resolve({ before }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  b.user.mockResolvedValue({ client: "client" });
  b.access.mockResolvedValue({
    status: "success",
    access: { role: "viewer", practice: { id: "own", timezone: "UTC" } },
  });
  b.read.mockResolvedValue(data);
});
afterEach(cleanup);
it("RC07 active history viewer is read only and query binds normalized identity", async () => {
  render(await load(id.toUpperCase()));
  expect(b.read).toHaveBeenCalledWith("client", "own", id, null);
  expect(
    screen.getByRole("heading", { name: "Cycle 1 · Current cycle" }),
  ).toBeTruthy();
  expect(screen.getByText("Mar 2, 2030")).toBeTruthy();
  expect(screen.getByText("Not acknowledged")).toBeTruthy();
  expect(screen.getByText("None entered")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Record confirmed renewal" }),
  ).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Open current record" })
      .getAttribute("href"),
  ).toBe(`/practice/register/${id}`);
  expect(
    screen
      .getByRole("link", { name: "Evidence for cycle 1" })
      .getAttribute("href"),
  ).toBe(`/practice/register/${id}/evidence/${row.id}`);
});
it("RC07 archived retained snapshots dates and keyset links", async () => {
  b.read.mockResolvedValue({
    ...data,
    archivedAt: "2030-01-01T00:00:00Z",
    currentCycleId: next,
    cycles: [
      {
        ...row,
        type: "state_license",
        completedAt: "2030-01-01T00:00:00Z",
        successorId: next,
        acknowledgedAt: "2029-01-01T00:00:00Z",
        actionDeadline: "2030-02-01",
        progress: "awaiting-approval",
      },
    ],
    nextBeforeCycleNumber: 1,
  });
  render(await load(id, "20"));
  expect(
    screen.getByRole("heading", { name: "Cycle 1 · Confirmed renewal" }),
  ).toBeTruthy();
  expect(screen.getByText("Feb 1, 2030")).toBeTruthy();
  expect(screen.getByText("Awaiting approval")).toBeTruthy();
  expect(
    screen.queryByRole("link", { name: "Open current record" }),
  ).toBeNull();
  expect(
    screen.getByRole("link", { name: "Back to register" }).getAttribute("href"),
  ).toBe("/practice/register?view=archived");
  expect(
    screen
      .getByRole("link", { name: "Older renewal cycles" })
      .getAttribute("href"),
  ).toBe(`/practice/register/${id}/history?before=1`);
  expect(b.read).toHaveBeenCalledWith("client", "own", id, 20);
});
it("RC07 closed undated empty and historical defensive states are explicit", async () => {
  for (const [patch, label] of [
    [{ completedAt: "2030-01-01T00:00:00Z" }, "Cycle closed"],
    [{}, "Historical cycle"],
  ] as const) {
    b.read.mockResolvedValue({
      ...data,
      currentCycleId: next,
      cycles: [{ ...row, endDate: null, ...patch }],
    });
    const v = render(await load());
    expect(
      screen.getByRole("heading", { name: `Cycle 1 · ${label}` }),
    ).toBeTruthy();
    expect(screen.getByText("Not entered")).toBeTruthy();
    v.unmount();
  }
  b.read.mockResolvedValue({ ...data, cycles: [] });
  render(await load());
  expect(screen.getByText("No cycles on this page.")).toBeTruthy();
});
it("RC07 invalid cursors do not read and foreign unavailable identifiers are neutral", async () => {
  for (const before of ["0", ["1", "2"]]) {
    const v = render(await load(id, before));
    expect(
      screen.getByRole("heading", { name: "History page unavailable" }),
    ).toBeTruthy();
    expect(b.read).not.toHaveBeenCalled();
    v.unmount();
  }
  await expect(load("bad")).rejects.toThrow("NOT_FOUND");
  b.read.mockResolvedValue({ status: "not-found" });
  await expect(load()).rejects.toThrow("NOT_FOUND");
});
it("RC07 access transport and no-practice failures stop history reading", async () => {
  b.access.mockResolvedValue({ status: "unavailable" });
  await expect(load()).rejects.toThrow(
    "We could not load renewal history. Try again.",
  );
  expect(b.read).not.toHaveBeenCalled();
  b.access.mockResolvedValue({ status: "success", access: null });
  await expect(load()).rejects.toThrow("REDIRECT:/onboarding/practice");
  expect(b.read).not.toHaveBeenCalled();
  b.access.mockResolvedValue({
    status: "success",
    access: { role: "manager", practice: { id: "own", timezone: "UTC" } },
  });
  b.read.mockResolvedValue({ status: "unavailable" });
  await expect(load()).rejects.toThrow(
    "We could not load renewal history. Try again.",
  );
});
