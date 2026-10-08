import React from "react";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
const boundary = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getRecipient: vi.fn(),
  getMaintenanceRegister: vi.fn(),
  getTeam: vi.fn(),
  getCurrentPractice: vi.fn(),
  getPracticeAccess: vi.fn(),
}));
vi.mock("@/lib/register/repository", () => ({
  getMaintenanceRegister: boundary.getMaintenanceRegister,
}));
vi.mock("@/lib/team/repository", () => ({ getTeam: boundary.getTeam }));
vi.mock("@/lib/recipients/repository", () => ({
  getRecipient: boundary.getRecipient,
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: boundary.requireUser,
}));
vi.mock("@/lib/practice/repository", () => ({
  getCurrentPractice: boundary.getCurrentPractice,
}));
vi.mock("@/lib/practice/access", () => ({
  getPracticeAccess: boundary.getPracticeAccess,
}));
vi.mock("@/components/auth/email-code-form", () => ({
  EmailCodeForm: () => <div>Code form</div>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import PracticeRegister from "@/app/practice/register/page";
import Home from "@/app/page";
import Setup from "@/app/onboarding/practice/page";
import Settings from "@/app/practice/page";
import PracticeTeam from "@/app/practice/team/page";
import Login from "@/app/login/page";
import ErrorPage from "@/app/error";
import Layout from "@/app/layout";
beforeEach(() => {
  vi.resetAllMocks();
  boundary.getRecipient.mockResolvedValue({
    status: "success",
    recipient: {
      version: 1,
      selected: null,
      readiness: "no-recipient",
      ready: false,
      canEdit: false,
    },
  });
  boundary.requireUser.mockResolvedValue({
    client: {},
    user: { email: "fixture@example.test" },
  });
  boundary.getPracticeAccess.mockImplementation(async () => {
    const current = await boundary.getCurrentPractice();
    return current.status === "success"
      ? {
          status: "success",
          access: current.practice
            ? {
                practice: current.practice,
                role: "administrator",
                membershipVersion: 1,
              }
            : null,
        }
      : current;
  });
});
afterEach(cleanup);
it("S03 root redirects based on persisted own profile", async () => {
  boundary.getCurrentPractice.mockResolvedValue({
    status: "success",
    practice: null,
  });
  await expect(Home()).rejects.toThrow("REDIRECT:/onboarding/practice");
  boundary.getCurrentPractice.mockResolvedValue({
    status: "success",
    practice: { id: "own" },
  });
  await expect(Home()).rejects.toThrow("REDIRECT:/practice");
});
it("S19 existing profile bypasses setup and absent profile returns to setup", async () => {
  boundary.getCurrentPractice.mockResolvedValue({
    status: "success",
    practice: { id: "own" },
  });
  await expect(Setup()).rejects.toThrow("REDIRECT:/practice");
  boundary.getCurrentPractice.mockResolvedValue({
    status: "success",
    practice: null,
  });
  await expect(Settings()).rejects.toThrow("REDIRECT:/onboarding/practice");
});
it("S24 read interruption cannot fabricate a profile on any route", async () => {
  boundary.getCurrentPractice.mockResolvedValue({ status: "unavailable" });
  for (const route of [Home, Setup, Settings])
    await expect(route()).rejects.toThrow(
      "We could not complete this request. Try again.",
    );
});
it("S24 retry screen uses safe text and invokes retry", () => {
  const reset = vi.fn();
  render(<ErrorPage reset={reset} />);
  expect(screen.getByRole("alert").textContent).toBe(
    "We could not complete this request. Try again.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(reset).toHaveBeenCalledTimes(1);
});
it("S01 login and semantic layout render the sign-in entry", () => {
  const layout = Layout({ children: <Login /> });
  expect(layout.props.lang).toBe("en");
  render(<Login />);
  expect(
    screen.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeTruthy();
});
it.each([
  ["manager", "Office manager"],
  ["viewer", "Viewer"],
])(
  "S47 %s sees shared profile with no administrator controls",
  async (role, label) => {
    const practice = {
      id: "own",
      name: "Cedar Clinic",
      timezone: "UTC",
      version: 1,
    };
    boundary.getCurrentPractice.mockResolvedValue({
      status: "success",
      practice,
    });
    boundary.getPracticeAccess.mockResolvedValue({
      status: "success",
      access: { practice, role, membershipVersion: 1 },
    });
    render(await Settings());
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cedar Clinic" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Manage team" })).toBeNull();
    expect(screen.getByText("UTC")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Renewal calendar" })
        .getAttribute("href"),
    ).toBe("/practice/calendar");
    expect(
      screen
        .getByRole("link", { name: "Renewal register" })
        .getAttribute("href"),
    ).toBe("/practice/register");
  },
);

it("R18 recipient read failure never fabricates an empty recipient", async () => {
  boundary.getPracticeAccess.mockResolvedValue({
    status: "success",
    access: { practice: { id: "own" }, role: "manager" },
  });
  boundary.getRecipient.mockResolvedValue({ status: "unavailable" });
  await expect(Settings()).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
});

it("R18 team route reads current recipient only for administrator and fails closed on outage", async () => {
  boundary.getPracticeAccess.mockResolvedValue({
    status: "success",
    access: { practice: { id: "own", name: "Cedar" }, role: "administrator" },
  });
  boundary.getTeam.mockResolvedValue({
    status: "success",
    team: { members: [], invitations: [] },
  });
  boundary.getRecipient.mockResolvedValue({ status: "unavailable" });
  await expect(PracticeTeam()).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
  boundary.getRecipient.mockResolvedValue({
    status: "success",
    recipient: {
      version: 1,
      selected: null,
      canEdit: true,
      candidates: [],
      readiness: "no-recipient",
      ready: false,
    },
  });
  render(await PracticeTeam());
  expect(screen.getByRole("heading", { name: "Practice team" })).toBeTruthy();
});

it("G19 register guards missing access and outages without fabricated empty state", async () => {
  boundary.getPracticeAccess.mockResolvedValue({ status: "unavailable" });
  await expect(PracticeRegister({})).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
  boundary.getPracticeAccess.mockResolvedValue({
    status: "success",
    access: null,
  });
  await expect(PracticeRegister({})).rejects.toThrow(
    "REDIRECT:/onboarding/practice",
  );
  boundary.getPracticeAccess.mockResolvedValue({
    status: "success",
    access: { role: "viewer", practice: { id: "own", name: "Cedar" } },
  });
  boundary.getMaintenanceRegister.mockResolvedValue({ status: "unavailable" });
  await expect(PracticeRegister({})).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
  for (const role of ["administrator", "manager", "viewer"]) {
    boundary.getPracticeAccess.mockResolvedValue({
      status: "success",
      access: { role, practice: { id: "own", name: "Cedar" } },
    });
    boundary.getMaintenanceRegister.mockResolvedValue({
      status: "success",
      register: { clinicians: [], credentials: [] },
    });
    const view = render(await PracticeRegister({}));
    expect(boundary.getMaintenanceRegister).toHaveBeenLastCalledWith(
      {},
      "own",
      false,
    );
    expect(
      screen.getByRole("heading", { name: "Your renewal register." }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add clinician" }) !== null,
    ).toBe(role !== "viewer");
    expect(screen.getByText("No renewal records added yet.")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Practice settings" })
        .getAttribute("href"),
    ).toBe("/practice");
    view.unmount();
  }
});

it("M14 archived view is explicit and malformed query selects active", async () => {
  boundary.getPracticeAccess.mockResolvedValue({
    status: "success",
    access: { role: "viewer", practice: { id: "own", name: "Practice" } },
  });
  boundary.getMaintenanceRegister.mockResolvedValue({
    status: "success",
    register: { clinicians: [], credentials: [] },
  });
  for (const view of [
    "archived",
    "active",
    ["archived", "active"],
    undefined,
  ]) {
    const v = render(
      await PracticeRegister({ searchParams: Promise.resolve({ view }) }),
    );
    expect(boundary.getMaintenanceRegister).toHaveBeenLastCalledWith(
      {},
      "own",
      view === "archived",
    );
    expect(
      screen.getByText(
        view === "archived"
          ? "No archived records."
          : "No renewal records added yet.",
      ),
    ).toBeTruthy();
    v.unmount();
  }
});

const calendarId = "aaaaaaaa-0000-4000-8000-000000000001";
const calendarRecord = {
  id: calendarId,
  title: "Shared policy",
  type: "malpractice_policy",
  owner_kind: "practice",
  owner_clinician_id: null,
  owner_name: "Cedar",
  version: 1,
  covered_clinicians: [
    { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Rivera" },
  ],
  issuer: "Insurer",
  jurisdiction: "CA",
  archived_at: null,
  suspected_duplicate_ids: [],
  current_cycle: {
    id: calendarId,
    cycle_number: 1,
    date_revision: 1,
    end_date: "2028-02-29",
    action_deadline: "2028-02-01",
  },
};
function calendarAccess(role = "manager") {
  boundary.getPracticeAccess.mockResolvedValue({
    status: "success",
    access: {
      practice: { id: "own", name: "Cedar", timezone: "America/Los_Angeles" },
      role,
    },
  });
  boundary.getMaintenanceRegister.mockResolvedValue({
    status: "success",
    register: { clinicians: [], credentials: [calendarRecord] },
  });
}
it("C08 calendar and detail check authentication, access and read errors before showing data", async () => {
  const { default: Calendar } = await import("@/app/practice/calendar/page"),
    { default: Detail } =
      await import("@/app/practice/register/[credentialId]/page");
  const routes = [
    () => Calendar({}),
    () => Detail({ params: Promise.resolve({ credentialId: calendarId }) }),
  ];
  for (const route of routes) {
    calendarAccess();
    boundary.requireUser.mockRejectedValueOnce(new Error("REDIRECT:/login"));
    await expect(route()).rejects.toThrow("REDIRECT:/login");
    expect(boundary.getMaintenanceRegister).not.toHaveBeenCalled();
    boundary.getPracticeAccess.mockResolvedValue({ status: "unavailable" });
    await expect(route()).rejects.toThrow(
      "We could not complete this request. Try again.",
    );
    boundary.getPracticeAccess.mockResolvedValue({
      status: "success",
      access: null,
    });
    await expect(route()).rejects.toThrow("REDIRECT:/onboarding/practice");
    calendarAccess();
    boundary.getMaintenanceRegister.mockResolvedValue({
      status: "unavailable",
    });
    await expect(route()).rejects.toThrow(
      "We could not complete this request. Try again.",
    );
    boundary.getMaintenanceRegister.mockClear();
  }
});
it("C07 C08 all active roles see authorized detail and fresh active calendar data", async () => {
  const { default: Calendar } = await import("@/app/practice/calendar/page"),
    { default: Detail } =
      await import("@/app/practice/register/[credentialId]/page");
  for (const role of ["administrator", "manager", "viewer"]) {
    calendarAccess(role);
    const c = render(
      await Calendar({
        searchParams: Promise.resolve({
          month: "2028-02",
          practiceId: "foreign",
        }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Your renewal calendar." }),
    ).toBeTruthy();
    expect(boundary.getMaintenanceRegister).toHaveBeenLastCalledWith(
      {},
      "own",
      false,
    );
    c.unmount();
    const d = render(
      await Detail({
        params: Promise.resolve({ credentialId: calendarId.toUpperCase() }),
        searchParams: Promise.resolve({ month: "2028-02", view: "agenda" }),
      }),
    );
    expect(screen.getByRole("heading", { name: "Shared policy" })).toBeTruthy();
    expect(screen.getByText("Covers: Rivera")).toBeTruthy();
    expect(
      screen
        .getByRole("link", {
          name: role === "viewer" ? "View in register" : "Edit in register",
        })
        .getAttribute("href"),
    ).toBe(`/practice/register#record-${calendarId}`);
    expect(
      screen
        .getByRole("link", { name: "Back to calendar" })
        .getAttribute("href"),
    ).toBe("/practice/calendar?month=2028-02&view=agenda");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    d.unmount();
  }
});
it("C07 malformed, foreign, missing and archived detail IDs share neutral not-found", async () => {
  const { default: Detail } =
    await import("@/app/practice/register/[credentialId]/page");
  calendarAccess();
  for (const credentialId of ["bad", "bbbbbbbb-0000-4000-8000-000000000002"]) {
    await expect(
      Detail({ params: Promise.resolve({ credentialId }) }),
    ).rejects.toThrow("NOT_FOUND");
  }
  boundary.getMaintenanceRegister.mockResolvedValue({
    status: "success",
    register: { clinicians: [], credentials: [] },
  });
  await expect(
    Detail({ params: Promise.resolve({ credentialId: calendarId }) }),
  ).rejects.toThrow("NOT_FOUND");
  boundary.getMaintenanceRegister.mockResolvedValue({
    status: "success",
    register: {
      clinicians: [],
      credentials: [{ ...calendarRecord, archived_at: "2026-01-01T00:00:00Z" }],
    },
  });
  await expect(
    Detail({ params: Promise.resolve({ credentialId: calendarId }) }),
  ).rejects.toThrow("NOT_FOUND");
});
it("C07 not-found page offers neutral fixed navigation", async () => {
  const { default: NotFound } =
    await import("@/app/practice/register/[credentialId]/not-found");
  render(<NotFound />);
  expect(
    screen.getByRole("heading", { name: "Record unavailable." }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Return to calendar" })
      .getAttribute("href"),
  ).toBe("/practice/calendar");
});

it("Q07 dashboard authentication/access/read guards fail visibly before any counts", async () => {
  const { default: Dashboard } = await import("@/app/practice/dashboard/page");
  calendarAccess();
  boundary.requireUser.mockRejectedValueOnce(new Error("REDIRECT:/login"));
  await expect(Dashboard()).rejects.toThrow("REDIRECT:/login");
  expect(boundary.getMaintenanceRegister).not.toHaveBeenCalled();
  boundary.getPracticeAccess.mockResolvedValue({ status: "unavailable" });
  await expect(Dashboard()).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
  boundary.getPracticeAccess.mockResolvedValue({
    status: "success",
    access: null,
  });
  await expect(Dashboard()).rejects.toThrow("REDIRECT:/onboarding/practice");
  for (const status of ["forbidden", "unavailable"]) {
    calendarAccess();
    boundary.getMaintenanceRegister.mockResolvedValue({ status });
    await expect(Dashboard()).rejects.toThrow(
      "We could not complete this request. Try again.",
    );
  }
});
it("Q06 Q07 all active roles see one practice-local snapshot and fixed refresh/navigation", async () => {
  const { default: Dashboard } = await import("@/app/practice/dashboard/page");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T07:59:00Z"));
  try {
    for (const role of ["administrator", "manager", "viewer"]) {
      calendarAccess(role);
      const view = render(await Dashboard());
      expect(boundary.getMaintenanceRegister).toHaveBeenLastCalledWith(
        {},
        "own",
        false,
      );
      expect(
        screen.getByRole("heading", { name: "Your renewal dashboard." }),
      ).toBeTruthy();
      expect(
        view.container.querySelector('time[datetime="2025-12-31"]'),
      ).toBeTruthy();
      expect(screen.getByText(/America\/Los_Angeles/)).toBeTruthy();
      expect(
        screen
          .getByRole("link", { name: "Refresh records" })
          .getAttribute("href"),
      ).toBe("/practice/dashboard");
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
      view.unmount();
    }
    calendarAccess();
    boundary.getPracticeAccess.mockResolvedValue({
      status: "success",
      access: {
        practice: { id: "own", name: "Cedar", timezone: "Asia/Tokyo" },
        role: "manager",
      },
    });
    const view = render(await Dashboard());
    expect(
      view.container.querySelector('time[datetime="2026-01-01"]'),
    ).toBeTruthy();
    view.unmount();
    boundary.getPracticeAccess.mockResolvedValue({
      status: "success",
      access: {
        practice: { id: "own", name: "Cedar", timezone: "invalid" },
        role: "manager",
      },
    });
    await expect(Dashboard()).rejects.toThrow();
  } finally {
    vi.useRealTimers();
  }
});
it("Q09 detail dashboard origin is exact, fixed and preserves invalid-origin calendar context", async () => {
  const { default: Detail } =
    await import("@/app/practice/register/[credentialId]/page");
  calendarAccess();
  for (const from of [
    "dashboard",
    ["dashboard", "dashboard"],
    "https://evil.example",
    undefined,
    "other",
  ]) {
    const view = render(
      await Detail({
        params: Promise.resolve({ credentialId: calendarId }),
        searchParams: Promise.resolve({
          from,
          month: "2028-02",
          view: "agenda",
          type: "malpractice_policy",
          returnUrl: "https://evil.example",
        }),
      }),
    );
    const dashboard = from === "dashboard";
    expect(
      screen
        .getByRole("link", {
          name: dashboard ? "Back to dashboard" : "Back to calendar",
        })
        .getAttribute("href"),
    ).toBe(
      dashboard
        ? "/practice/dashboard"
        : "/practice/calendar?month=2028-02&view=agenda&type=malpractice_policy",
    );
    view.unmount();
  }
  const { default: NotFound } =
    await import("@/app/practice/register/[credentialId]/not-found");
  render(<NotFound />);
  expect(
    screen
      .getByRole("link", { name: "Return to dashboard" })
      .getAttribute("href"),
  ).toBe("/practice/dashboard");
});
it("Q13 settings and invalid-filter calendar retain fixed dashboard entry", async () => {
  calendarAccess();
  boundary.getCurrentPractice.mockResolvedValue({
    status: "success",
    practice: { id: "own", name: "Cedar", timezone: "UTC", version: 1 },
  });
  const settings = render(await Settings());
  expect(
    screen
      .getByRole("link", { name: "Renewal dashboard" })
      .getAttribute("href"),
  ).toBe("/practice/dashboard");
  settings.unmount();
  const { default: Calendar } = await import("@/app/practice/calendar/page");
  render(await Calendar({ searchParams: Promise.resolve({ type: "bad" }) }));
  expect(
    screen
      .getByRole("link", { name: "Renewal dashboard" })
      .getAttribute("href"),
  ).toBe("/practice/dashboard");
});
