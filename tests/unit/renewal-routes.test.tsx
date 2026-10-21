import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const b = vi.hoisted(() => ({
  requireUser: vi.fn(),
  access: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: b.requireUser }));
vi.mock("@/lib/practice/access", () => ({ getPracticeAccess: b.access }));
vi.mock("@/lib/renewals/repository", () => ({ getRenewalRegister: b.read }));
vi.mock("next/navigation", () => ({
  redirect: (s: string) => {
    throw new Error(`REDIRECT:${s}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
import Detail from "@/app/practice/register/[credentialId]/page";
import Register from "@/app/practice/register/page";
import Dashboard from "@/app/practice/dashboard/page";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
const record = {
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
    id,
    cycle_number: 1,
    date_revision: 1,
    end_date: "2000-01-01",
    action_deadline: null,
  },
  archived_at: null,
  suspected_duplicate_ids: [],
  renewal: {
    link: { url: null, version: 1 },
    workflow: {
      cycleId: id,
      status: "awaiting-approval",
      version: 2,
      acknowledgedAt: null,
    },
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  b.requireUser.mockResolvedValue({ client: {} });
  b.access.mockResolvedValue({
    status: "success",
    access: {
      role: "manager",
      practice: { id: "own", name: "Cedar", timezone: "UTC" },
    },
  });
  b.read.mockResolvedValue({
    status: "success",
    register: { clinicians: [], credentials: [record] },
  });
});
afterEach(cleanup);
it("RW08 all three record views use the authorized combined read", async () => {
  for (const route of [
    () => Detail({ params: Promise.resolve({ credentialId: id }) }),
    () => Register({}),
    () => Dashboard(),
  ]) {
    const v = render(await route());
    expect(b.read).toHaveBeenLastCalledWith({}, "own", false);
    expect(screen.getByText("Awaiting approval")).toBeTruthy();
    v.unmount();
  }
});
it("RW05 viewer detail is read only and preserves fixed dashboard and calendar return", async () => {
  b.access.mockResolvedValue({
    status: "success",
    access: {
      role: "viewer",
      practice: { id: "own", name: "Cedar", timezone: "UTC" },
    },
  });
  for (const from of ["dashboard", undefined]) {
    const v = render(
      await Detail({
        params: Promise.resolve({ credentialId: id.toUpperCase() }),
        searchParams: Promise.resolve({
          from,
          month: "2000-01",
          view: "agenda",
        }),
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Change progress" }),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", {
          name: from ? "Back to dashboard" : "Back to calendar",
        })
        .getAttribute("href"),
    ).toBe(
      from
        ? "/practice/dashboard"
        : "/practice/calendar?month=2000-01&view=agenda",
    );
    v.unmount();
  }
});
it("RW05 access and reader failures never fabricate progress", async () => {
  for (const route of [
    () => Detail({ params: Promise.resolve({ credentialId: id }) }),
    () => Register({}),
    () => Dashboard(),
  ]) {
    b.access.mockResolvedValue({ status: "unavailable" });
    await expect(route()).rejects.toThrow(
      "We could not complete this request. Try again.",
    );
    expect(b.read).not.toHaveBeenCalled();
    b.access.mockResolvedValue({ status: "success", access: null });
    await expect(route()).rejects.toThrow("REDIRECT:/onboarding/practice");
    b.access.mockResolvedValue({
      status: "success",
      access: {
        role: "manager",
        practice: { id: "own", name: "Cedar", timezone: "UTC" },
      },
    });
    b.read.mockResolvedValue({ status: "unavailable" });
    await expect(route()).rejects.toThrow(
      "We could not complete this request. Try again.",
    );
    b.read.mockClear();
  }
});
it("RW05 archived unknown and malformed detail identifiers are neutral", async () => {
  for (const credentialId of ["bad", "bbbbbbbb-0000-4000-8000-000000000002"])
    await expect(
      Detail({ params: Promise.resolve({ credentialId }) }),
    ).rejects.toThrow("NOT_FOUND");
  b.read.mockResolvedValue({
    status: "success",
    register: {
      clinicians: [],
      credentials: [{ ...record, archived_at: "2026-10-12T00:00:00Z" }],
    },
  });
  await expect(
    Detail({ params: Promise.resolve({ credentialId: id }) }),
  ).rejects.toThrow("NOT_FOUND");
});
