import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/components/auth/email-code-form", () => ({
  EmailCodeForm: ({ destination }: { destination: string }) => (
    <div>Sign in to {destination}</div>
  ),
}));
import { JoinForm } from "@/components/auth/join-form";
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  replace.mockReset();
});
it("S44 fragment is captured and cleared while signed out without accepting", async () => {
  const fixtureLocation = new URL("/join", window.location.href);
  fixtureLocation.hash = new URLSearchParams({
    token: "A".repeat(43),
  }).toString();
  window.history.replaceState(null, "", fixtureLocation);
  const action = vi.fn();
  render(<JoinForm signedIn={false} action={action} />);
  await waitFor(() => expect(window.location.hash).toBe(""));
  expect(sessionStorage.getItem("practice-invitation")).toHaveLength(43);
  expect(action).not.toHaveBeenCalled();
  expect(screen.getByText("Sign in to /join")).toBeTruthy();
});
it("S18 explicit preview precedes acceptance and successful join clears tab context", async () => {
  sessionStorage.setItem("practice-invitation", "A".repeat(43));
  const action = vi
    .fn()
    .mockResolvedValueOnce({
      status: "success",
      name: "Cedar Clinic",
      role: "manager",
      expires_at: "2026-10-12T00:00:00Z",
    })
    .mockResolvedValueOnce({
      status: "success",
      practiceId: "practice",
      role: "manager",
    });
  render(<JoinForm signedIn email="staff@example.test" action={action} />);
  fireEvent.submit(
    screen.getByRole("button", { name: "Review invitation" }).closest("form")!,
  );
  await waitFor(() => expect(screen.getByText("Cedar Clinic")).toBeTruthy());
  expect(action.mock.calls[0][1].get("intent")).toBe("preview");
  expect(screen.getByText("Office manager")).toBeTruthy();
  fireEvent.submit(
    screen.getByRole("button", { name: "Accept invitation" }).closest("form")!,
  );
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/practice"));
  expect(action.mock.calls[1][1].get("intent")).toBe("accept");
  expect(sessionStorage.getItem("practice-invitation")).toBeNull();
});
it("S21 missing tab capability remains unavailable and cannot post", () => {
  const action = vi.fn();
  render(<JoinForm signedIn action={action} />);
  expect(
    screen.getByText(
      "This invitation is unavailable. Ask an administrator for a new link.",
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Accept invitation" }),
  ).toBeNull();
});
