import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const boundary = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  read: vi.fn(),
  config: vi.fn(),
  storage: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: boundary.user }));
vi.mock("@/lib/practice/access", () => ({
  getPracticeAccess: boundary.access,
}));
vi.mock("@/lib/sms/repository", () => ({ getMyEnrollment: boundary.read }));
vi.mock("@/lib/sms/config", () => ({ smsConfig: boundary.config }));
vi.mock("@/lib/sms/privileged-repository", () => ({
  smsStorageConfigured: boundary.storage,
}));
vi.mock("@/app/practice/sms/actions", () => ({ smsAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
import SmsEnrollment from "@/app/practice/sms/page";
import SmsInformation from "@/app/sms-information/page";
const enrollment = {
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
beforeEach(() => {
  vi.resetAllMocks();
  boundary.user.mockResolvedValue({ client: {} });
  boundary.access.mockResolvedValue({
    status: "success",
    access: { practice: { id: "own", name: "Cedar" }, role: "manager" },
  });
  boundary.read.mockResolvedValue({ status: "success", enrollment });
  boundary.config.mockReturnValue(null);
  boundary.storage.mockReturnValue(false);
});
afterEach(cleanup);
test("SMS route requires identity and live access and fails closed on unreadable owner state", async () => {
  boundary.user.mockRejectedValueOnce(new Error("REDIRECT:/login"));
  await expect(SmsEnrollment()).rejects.toThrow("REDIRECT:/login");
  expect(boundary.read).not.toHaveBeenCalled();
  boundary.access.mockResolvedValueOnce({ status: "unavailable" });
  await expect(SmsEnrollment()).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
  boundary.access.mockResolvedValueOnce({ status: "success", access: null });
  await expect(SmsEnrollment()).rejects.toThrow(
    "REDIRECT:/onboarding/practice",
  );
  boundary.read.mockResolvedValueOnce({ status: "unavailable" });
  await expect(SmsEnrollment()).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
});
test("Missing provider or private storage disables collection without hiding status or withdrawal", async () => {
  boundary.read.mockResolvedValue({
    status: "success",
    enrollment: {
      ...enrollment,
      phoneRevision: 1,
      phoneSuffix: "0123",
      verified: true,
      reason: "consent-required",
    },
  });
  for (const configured of [false, true]) {
    boundary.config.mockReturnValue(
      configured ? { supportEmail: "help@example.test" } : null,
    );
    const view = render(await SmsEnrollment());
    expect(screen.queryByLabelText("International phone number")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Request verification code" }),
    ).toBeNull();
    expect(
      screen.getByText(
        "Text enrollment is not configured yet. You can still withdraw existing consent.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Withdraw reminder consent" }),
    ).toBeTruthy();
    expect(boundary.read).toHaveBeenLastCalledWith({}, "own");
    expect(
      screen
        .getByRole("link", { name: "Practice settings" })
        .getAttribute("href"),
    ).toBe("/practice");
    view.unmount();
  }
  boundary.storage.mockReturnValue(true);
  render(await SmsEnrollment());
  expect(
    (screen.getByLabelText("International phone number") as HTMLInputElement)
      .disabled,
  ).toBe(false);
});
test("Public information renders actual customer care or an explicit setup requirement", () => {
  const first = render(<SmsInformation />);
  expect(
    screen.getByText(/operator provides a customer-care contact/),
  ).toBeTruthy();
  first.unmount();
  boundary.config.mockReturnValue({ supportEmail: "help@example.test" });
  render(<SmsInformation />);
  expect(
    screen
      .getByRole("link", { name: "help@example.test" })
      .getAttribute("href"),
  ).toBe("mailto:help@example.test");
  expect(screen.getByRole("heading", { name: "SMS terms" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "SMS privacy" })).toBeTruthy();
  expect(boundary.user).not.toHaveBeenCalled();
});
