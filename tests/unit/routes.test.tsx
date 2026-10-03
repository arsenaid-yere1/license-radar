import React from "react";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
const boundary = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getCurrentPractice: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: boundary.requireUser,
}));
vi.mock("@/lib/practice/repository", () => ({
  getCurrentPractice: boundary.getCurrentPractice,
}));
vi.mock("@/components/auth/email-code-form", () => ({
  EmailCodeForm: () => <div>Code form</div>,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import Home from "@/app/page";
import Setup from "@/app/onboarding/practice/page";
import Settings from "@/app/practice/page";
import Login from "@/app/login/page";
import ErrorPage from "@/app/error";
import Layout from "@/app/layout";
beforeEach(() => {
  vi.resetAllMocks();
  boundary.requireUser.mockResolvedValue({
    client: {},
    user: { email: "fixture@example.test" },
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
