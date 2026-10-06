import React from "react";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
const boundary = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getRecipient: vi.fn(),
  getRegister: vi.fn(),
  getTeam: vi.fn(),
  getCurrentPractice: vi.fn(),
  getPracticeAccess: vi.fn(),
}));
vi.mock("@/lib/register/repository", () => ({
  getRegister: boundary.getRegister,
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
  await expect(PracticeRegister()).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
  boundary.getPracticeAccess.mockResolvedValue({
    status: "success",
    access: null,
  });
  await expect(PracticeRegister()).rejects.toThrow(
    "REDIRECT:/onboarding/practice",
  );
  boundary.getPracticeAccess.mockResolvedValue({
    status: "success",
    access: { role: "viewer", practice: { id: "own", name: "Cedar" } },
  });
  boundary.getRegister.mockResolvedValue({ status: "unavailable" });
  await expect(PracticeRegister()).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
  for (const role of ["administrator", "manager", "viewer"]) {
    boundary.getPracticeAccess.mockResolvedValue({
      status: "success",
      access: { role, practice: { id: "own", name: "Cedar" } },
    });
    boundary.getRegister.mockResolvedValue({
      status: "success",
      register: { clinicians: [], credentials: [] },
    });
    const view = render(await PracticeRegister());
    expect(boundary.getRegister).toHaveBeenLastCalledWith({}, "own");
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
