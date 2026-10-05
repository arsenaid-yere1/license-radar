import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { InvitationForm } from "@/components/team/invitation-form";
import { MemberControls } from "@/components/team/member-controls";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("S09 S48 invitation field errors retain values and focus result", async () => {
  const action = vi.fn().mockResolvedValue({
    status: "invalid",
    errors: { email: "Enter a valid email." },
    message: "Check the highlighted fields.",
  });
  render(<InvitationForm action={action} />);
  fireEvent.change(screen.getByLabelText("Staff email"), {
    target: { value: "bad" },
  });
  fireEvent.change(screen.getByLabelText("Invitation role"), {
    target: { value: "viewer" },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Create invitation link" })
      .closest("form")!,
  );
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      "Check the highlighted fields.",
    ),
  );
  expect((screen.getByLabelText("Staff email") as HTMLInputElement).value).toBe(
    "bad",
  );
  expect(
    (screen.getByLabelText("Invitation role") as HTMLSelectElement).value,
  ).toBe("viewer");
  expect(
    screen.getByLabelText("Staff email").getAttribute("aria-invalid"),
  ).toBe("true");
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("status")),
  );
});
it("S48 pending invitation prevents repeat submission", async () => {
  let finish: (result: { status: "unavailable" }) => void = () => {};
  render(
    <InvitationForm
      action={() =>
        new Promise((resolve) => {
          finish = resolve;
        })
      }
    />,
  );
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Create invitation link" })
      .closest("form")!,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Creating…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  finish({ status: "unavailable" });
});
it("S35 member revoke asks confirmation before submitting and versions target", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const action = vi
    .fn()
    .mockResolvedValue({ status: "success", message: "Access revoked." });
  render(
    <MemberControls
      member={{
        id: "10000000-0000-4000-8000-000000000001",
        email: "staff@example.test",
        role: "manager",
        state: "active",
        version: 3,
      }}
      action={action}
    />,
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Revoke access" }).closest("form")!,
  );
  expect(action).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.submit(
    screen.getByRole("button", { name: "Revoke access" }).closest("form")!,
  );
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(action.mock.calls[0][1].get("expectedVersion")).toBe("3");
});
