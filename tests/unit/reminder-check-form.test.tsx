import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import {
  EmailCheckForm,
  type CheckState,
} from "@/components/reminders/check-form";
const attemptId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";
const initialLocation = window.location.href;
function form(
  action: (state: CheckState, data: FormData) => Promise<CheckState>,
  canCheck = true,
  version = 2,
) {
  return (
    <EmailCheckForm
      attemptId={attemptId}
      version={version}
      canCheck={canCheck}
      action={action}
    />
  );
}
function checkButton() {
  return screen.getByRole("button", {
    name: "Check delivery status",
  }) as HTMLButtonElement;
}
async function submit(element: HTMLFormElement) {
  await act(async () => {
    fireEvent.submit(element);
  });
}
afterEach(() => {
  cleanup();
  refresh.mockClear();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", initialLocation);
});
it("DR13 a check carries only one mounted request UUID and versioned attempt identity", async () => {
  const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
  const action = vi.fn().mockResolvedValue({ status: "queued" });
  const view = render(form(action));
  await waitFor(() => expect(checkButton().disabled).toBe(false));
  const element = checkButton().closest("form")!;
  expect(Array.from(new FormData(element))).toEqual([
    ["requestId", requestId],
    ["attemptId", attemptId],
    ["expectedVersion", "2"],
  ]);
  view.rerender(form(action));
  expect(uuid).toHaveBeenCalledTimes(1);
  await submit(element);
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(Array.from(action.mock.calls[0][1])).toEqual([
    ["requestId", requestId],
    ["attemptId", attemptId],
    ["expectedVersion", "2"],
  ]);
  expect(screen.queryByText(/send again|resend/i)).toBeNull();
});
it("DR08 queued feedback focuses, refreshes and cannot queue another request", async () => {
  const action = vi.fn().mockResolvedValue({ status: "queued" });
  render(form(action));
  await waitFor(() => expect(checkButton().disabled).toBe(false));
  const element = checkButton().closest("form")!;
  await submit(element);
  await waitFor(() =>
    expect(screen.getByRole("status")).toBe(document.activeElement),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Delivery check queued",
  );
  expect(checkButton().disabled).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("link", { name: "Reload delivery status" }),
  ).toBeNull();
  await submit(element);
  expect(action).toHaveBeenCalledTimes(1);
});
it("DR08 pending clicks and duplicate form events preserve one exact request", async () => {
  let finish!: (state: CheckState) => void;
  const action = vi.fn().mockImplementation(
    () =>
      new Promise<CheckState>((resolve) => {
        finish = resolve;
      }),
  );
  render(form(action));
  await waitFor(() => expect(checkButton().disabled).toBe(false));
  const element = checkButton().closest("form")!;
  await submit(element);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Checking…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  await submit(element);
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ status: "queued" });
  });
  await waitFor(() => expect(checkButton().disabled).toBe(true));
  expect(action).toHaveBeenCalledTimes(1);
});
it("DR08 duplicate events before pending renders cannot queue two requests", async () => {
  const action = vi.fn().mockResolvedValue({ status: "queued" });
  render(form(action));
  await waitFor(() => expect(checkButton().disabled).toBe(false));
  const element = checkButton().closest("form")!;
  await act(async () => {
    fireEvent.submit(element);
    fireEvent.submit(element);
  });
  await waitFor(() =>
    expect(screen.getByRole("status")).toBe(document.activeElement),
  );
  expect(action).toHaveBeenCalledTimes(1);
});
it("DR13 strict mounting generates exactly one UUID for the usable form", async () => {
  const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
  render(<React.StrictMode>{form(vi.fn())}</React.StrictMode>);
  await waitFor(() => expect(checkButton().disabled).toBe(false));
  expect(uuid).toHaveBeenCalledTimes(1);
  expect(new FormData(checkButton().closest("form")!).get("requestId")).toBe(
    requestId,
  );
});
it.each(["returned", "thrown"])(
  "DR08 ambiguous %s response requires reload without replay",
  async (mode) => {
    window.history.replaceState(
      null,
      "",
      `/practice/reminders/${attemptId}?attempt=${attemptId}`,
    );
    const action =
      mode === "returned"
        ? vi.fn().mockResolvedValue({ status: "unavailable" })
        : vi.fn().mockRejectedValue(new Error("secret provider identity"));
    render(form(action));
    await waitFor(() => expect(checkButton().disabled).toBe(false));
    const element = checkButton().closest("form")!;
    const original = Array.from(new FormData(element));
    await submit(element);
    await waitFor(() =>
      expect(screen.getByRole("status")).toBe(document.activeElement),
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Reload before trying again",
    );
    expect(screen.queryByText(/secret provider identity/)).toBeNull();
    expect(checkButton().disabled).toBe(true);
    expect(Array.from(new FormData(element))).toEqual(original);
    await submit(element);
    expect(action).toHaveBeenCalledTimes(1);
    const reload = screen.getByRole("link", {
      name: "Reload delivery status",
    }) as HTMLAnchorElement;
    expect(reload.getAttribute("href")).toBe(window.location.href);
    expect(reload.href).toBe(window.location.href);
    expect(reload.onclick).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    expect(checkButton().disabled).toBe(true);
  },
);
it("DR13 read-only or ineligible history exposes no form, hidden authority or action", () => {
  const action = vi.fn();
  const { container } = render(form(action, false));
  expect(
    screen.queryByRole("button", { name: "Check delivery status" }),
  ).toBeNull();
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector('input[type="hidden"]')).toBeNull();
  expect(action).not.toHaveBeenCalled();
});
it.each([
  "complete",
  "not-found",
  "invalid",
  "conflict",
  "unknown-id",
  "exhausted",
  "cooldown",
  "request-conflict",
  "forbidden",
  "auth-required",
] as const)(
  "DR02 %s has focused guidance and cannot spend another check",
  async (status) => {
    const action = vi.fn().mockResolvedValue({ status });
    render(form(action));
    await waitFor(() => expect(checkButton().disabled).toBe(false));
    await submit(checkButton().closest("form")!);
    await waitFor(() =>
      expect(screen.getByRole("status")).toBe(document.activeElement),
    );
    expect(screen.getByRole("status").textContent!.length).toBeGreaterThan(20);
    if (status === "complete")
      expect(screen.getByRole("status").textContent).toBe(
        "Delivery evidence is final. Another check is not available.",
      );
    expect(checkButton().disabled).toBe(true);
    expect(
      screen
        .getByRole("link", { name: "Reload delivery status" })
        .getAttribute("href"),
    ).toBe(window.location.href);
    expect(refresh).not.toHaveBeenCalled();
  },
);
