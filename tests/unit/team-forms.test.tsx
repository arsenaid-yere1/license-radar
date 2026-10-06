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
import { InvitationLink } from "@/components/team/invitation-link";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("S48 invitation copying confirms the exact link and offers keyboard fallback on rejection", async () => {
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("denied"));
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(
    <InvitationLink token={"a".repeat(64)} expiresAt="2030-01-01T00:00:00Z" />,
  );
  const expected = `${window.location.origin}/join#token=${"a".repeat(64)}`;
  expect(
    (screen.getByLabelText("Invitation link") as HTMLInputElement).value,
  ).toBe(expected);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Link copied."),
  );
  expect(writeText).toHaveBeenLastCalledWith(expected);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      "Select the link and copy it using your keyboard.",
    ),
  );
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(
    (screen.getByLabelText("Invitation link") as HTMLInputElement).value,
  ).toBe(expected);
});
it("S35 cancelling administrator demotion prevents submission and confirmation preserves target version", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const action = vi
    .fn()
    .mockResolvedValue({ status: "success", message: "Role saved." });
  render(
    <MemberControls
      member={{
        id: "10000000-0000-4000-8000-000000000001",
        email: "admin@example.test",
        role: "administrator",
        state: "active",
        version: 3,
      }}
      action={action}
    />,
  );
  fireEvent.change(screen.getByLabelText("Role for admin@example.test"), {
    target: { value: "manager" },
  });
  const form = screen
    .getByRole("button", { name: "Save role" })
    .closest("form")!;
  fireEvent.submit(form);
  expect(confirm).toHaveBeenCalledWith(
    "Remove this person's administrator role?",
  );
  expect(action).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.submit(form);
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(action.mock.calls[0][1].get("role")).toBe("manager");
  expect(action.mock.calls[0][1].get("expectedVersion")).toBe("3");
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
