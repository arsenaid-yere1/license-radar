import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EnrollmentPanel } from "@/components/sms/enrollment-panel";
import type { Enrollment } from "@/lib/sms/schema";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const empty: Enrollment = {
  version: 1,
  phoneRevision: 0,
  phoneSuffix: null,
  verified: false,
  consented: false,
  canEdit: true,
  reason: "not-started",
  challengeId: null,
  expiresAt: null,
  retryAfter: null,
  deliveryActive: false,
};
const pending: Enrollment = {
  ...empty,
  version: 2,
  phoneRevision: 1,
  phoneSuffix: "0123",
  reason: "verification-pending",
  challengeId: "11111111-1111-4111-8111-111111111111",
  expiresAt: "2026-10-08T20:00:00Z",
  retryAfter: "2026-10-08T19:51:00Z",
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test("Missing setup disables collection and sending", () => {
  render(
    <EnrollmentPanel
      enrollment={pending}
      configured={false}
      practiceName="Cedar"
      action={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("International phone number")).toBeNull();
  expect(screen.getByText(/not configured yet/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Withdraw reminder consent" }),
  ).toBeTruthy();
});
test("Verification needs separate reminder consent", () => {
  render(
    <EnrollmentPanel
      enrollment={{
        ...pending,
        verified: true,
        challengeId: null,
        reason: "consent-required",
      }}
      configured
      practiceName="Cedar"
      action={vi.fn()}
    />,
  );
  expect(
    (
      screen.getByLabelText(
        "I agree to renewal reminder texts for this practice.",
      ) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(screen.queryByRole("button", { name: "Verify phone" })).toBeNull();
  expect(
    screen.getByText(/I agree to renewal reminder texts for Cedar/),
  ).toBeTruthy();
});
test("Enrollment survives refresh and sign-in", async () => {
  const action = vi
    .fn()
    .mockResolvedValue({ status: "wrong-code", message: "Wrong code" });
  render(
    <EnrollmentPanel
      enrollment={pending}
      configured
      practiceName="Cedar"
      action={action}
    />,
  );
  fireEvent.change(screen.getByLabelText("Six-digit verification code"), {
    target: { value: "123456" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Verify phone" }).closest("form")!,
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("alert")),
  );
  expect(
    (screen.getByLabelText("Six-digit verification code") as HTMLInputElement)
      .value.length,
  ).toBe(0);
  expect(action.mock.calls[0][1].get("intent")).toBe("check");
  expect(action.mock.calls[0][1].get("requestId")).toMatch(/^[a-f0-9-]{36}$/);
});
test("Phone replacement invalidates prior proof", async () => {
  refresh.mockClear();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const action = vi.fn().mockResolvedValue({
    status: "success",
    enrollment: pending,
    message: "Saved",
  });
  render(
    <EnrollmentPanel
      enrollment={{
        ...pending,
        verified: true,
        consented: true,
        challengeId: null,
        reason: "enrolled",
      }}
      configured
      practiceName="Cedar"
      action={action}
    />,
  );
  fireEvent.change(screen.getByLabelText("International phone number"), {
    target: { value: "+12025550124" },
  });
  const form = screen
    .getByRole("button", { name: "Request verification code" })
    .closest("form")!;
  fireEvent.submit(form);
  expect(action).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.submit(form);
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Saved"),
  );
  expect(action.mock.calls[0][1].get("changeConfirmed")).toBe("on");
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});
test("Withdrawal is immediate and idempotent", async () => {
  const confirm = vi.spyOn(window, "confirm"),
    action = vi.fn().mockResolvedValue({
      status: "success",
      message: "Withdrawn",
      enrollment: { ...pending, reason: "withdrawn", canEdit: false },
    });
  render(
    <EnrollmentPanel
      enrollment={{ ...pending, canEdit: false }}
      configured
      practiceName="Cedar"
      action={action}
    />,
  );
  expect(screen.queryByLabelText("International phone number")).toBeNull();
  fireEvent.submit(screen.getByRole("button").closest("form")!);
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Withdrawn"),
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(action.mock.calls[0][1].get("intent")).toBe("withdraw");
});
test("Unknown acceptance fails closed", async () => {
  render(
    <EnrollmentPanel
      enrollment={empty}
      configured
      practiceName="Cedar"
      action={vi.fn().mockRejectedValue(new Error("private"))}
    />,
  );
  fireEvent.change(screen.getByLabelText("International phone number"), {
    target: { value: "+12025550123" },
  });
  fireEvent.submit(screen.getByRole("button").closest("form")!);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Reload before continuing",
    ),
  );
  expect(screen.getByRole("link", { name: "Reload enrollment" })).toBeTruthy();
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  expect(
    (
      screen.getByLabelText("International phone number") as HTMLInputElement
    ).value.endsWith("0123"),
  ).toBe(true);
});
test("Enrollment refresh is independent of assignment version", () => {
  const action = vi.fn(),
    view = render(
      <EnrollmentPanel
        enrollment={empty}
        configured
        practiceName="Cedar"
        action={action}
      />,
    );
  view.rerender(
    <EnrollmentPanel
      enrollment={{ ...empty, canEdit: false }}
      configured
      practiceName="Cedar"
      action={action}
    />,
  );
  expect(screen.queryByLabelText("International phone number")).toBeNull();
  view.rerender(
    <EnrollmentPanel
      enrollment={{
        ...pending,
        version: 3,
        verified: true,
        consented: true,
        challengeId: null,
        reason: "enrolled",
      }}
      configured
      practiceName="Cedar"
      action={action}
    />,
  );
  expect(
    screen.getByText(
      "Phone verified and consent recorded. Renewal texts are not active yet.",
    ),
  ).toBeTruthy();
});
