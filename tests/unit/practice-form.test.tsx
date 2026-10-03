import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { PracticeForm } from "@/components/practice/practice-form";
afterEach(cleanup);
const timezones = ["UTC", "America/Los_Angeles", "America/New_York"];
it("S13 S14 shows visible suggested zone and fixed preview", () => {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone: "America/New_York",
  } as Intl.ResolvedDateTimeFormatOptions);
  render(<PracticeForm action={vi.fn()} timezones={timezones} />);
  expect(
    (screen.getByLabelText("Practice timezone") as HTMLSelectElement).value,
  ).toBe("America/New_York");
  expect(screen.getByText(/Example only/).textContent).toContain(
    "October 3, 2026 at 09:00 (America/New_York)",
  );
  vi.restoreAllMocks();
});
it("S13 detection failure visibly falls back to UTC", () => {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
    () => {
      throw new Error("unsupported");
    },
  );
  render(<PracticeForm action={vi.fn()} timezones={timezones} />);
  expect(
    (screen.getByLabelText("Practice timezone") as HTMLSelectElement).value,
  ).toBe("UTC");
  vi.restoreAllMocks();
});
it("S09 S15 invalid response retains input and focuses associated error", async () => {
  const action = vi.fn().mockResolvedValue({
    status: "invalid",
    errors: { name: "Enter a practice name." },
    message: "Check the highlighted fields.",
  });
  render(<PracticeForm action={action} timezones={timezones} />);
  fireEvent.change(screen.getByLabelText("Practice name"), {
    target: { value: "  " },
  });
  fireEvent.change(screen.getByLabelText("Practice timezone"), {
    target: { value: "America/Los_Angeles" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create practice" }).closest("form")!,
  );
  await waitFor(() =>
    expect(screen.getByText("Enter a practice name.")).toBeTruthy(),
  );
  expect(
    (screen.getByLabelText("Practice name") as HTMLInputElement).value,
  ).toBe("  ");
  expect(
    (screen.getByLabelText("Practice timezone") as HTMLSelectElement).value,
  ).toBe("America/Los_Angeles");
  expect(
    screen.getByLabelText("Practice name").getAttribute("aria-describedby"),
  ).toContain("name-error");
  expect(document.activeElement).toBe(screen.getByRole("status"));
});
it("S15 pending save disables submission", async () => {
  let finish: (v: { status: string }) => void = () => {};
  render(
    <PracticeForm
      timezones={timezones}
      action={() =>
        new Promise((resolve) => {
          finish = resolve;
        })
      }
    />,
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Create practice" }).closest("form")!,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  finish({ status: "unavailable" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Create practice" }),
    ).toBeTruthy(),
  );
});
it.each(["invalid", "unavailable"])(
  "S21 S24 keeps the latest saved version after a %s response",
  async (status) => {
    const practice = {
      id: "practice-id",
      owner_user_id: "owner-id",
      name: "Cedar Clinic",
      timezone: "UTC",
      version: 1,
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    };
    const action = vi
      .fn()
      .mockResolvedValueOnce({
        status: "success",
        practice: { ...practice, version: 2 },
        message: "Practice settings saved.",
      })
      .mockResolvedValueOnce({
        status,
        message: "Recoverable error",
        ...(status === "invalid" && {
          errors: { name: "Enter a practice name." },
        }),
      })
      .mockResolvedValueOnce({
        status: "success",
        practice: { ...practice, name: "Recovered", version: 3 },
        message: "Practice settings saved.",
      });
    render(
      <PracticeForm
        practice={practice}
        action={action}
        timezones={timezones}
      />,
    );
    const form = screen
      .getByRole("button", { name: "Save changes" })
      .closest("form")!;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Practice settings saved.",
      ),
    );
    expect(
      form.querySelector<HTMLInputElement>('input[name="expectedVersion"]')!
        .value,
    ).toBe("2");
    fireEvent.change(screen.getByLabelText("Practice name"), {
      target: { value: "  " },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Recoverable error"),
    );
    expect(
      (screen.getByLabelText("Practice name") as HTMLInputElement).value,
    ).toBe("  ");
    expect(
      form.querySelector<HTMLInputElement>('input[name="expectedVersion"]')!
        .value,
    ).toBe("2");
    fireEvent.change(screen.getByLabelText("Practice name"), {
      target: { value: "Recovered" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(3));
    expect(action.mock.calls[2][1].get("expectedVersion")).toBe("2");
    await waitFor(() =>
      expect(
        form.querySelector<HTMLInputElement>('input[name="expectedVersion"]')!
          .value,
      ).toBe("3"),
    );
  },
);
