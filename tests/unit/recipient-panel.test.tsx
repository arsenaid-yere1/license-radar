import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { RecipientPanel } from "@/components/recipients/recipient-panel";
import type { Recipient, RecipientState } from "@/lib/recipients/schema";
import { MemberControls } from "@/components/team/member-controls";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const one = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "first@example.test",
  role: "administrator" as const,
  state: "active" as const,
};
const two = {
  ...one,
  id: "10000000-0000-4000-8000-000000000002",
  email: "second@example.test",
  role: "manager" as const,
};
const recipient: Recipient = {
  version: 1,
  selected: one,
  readiness: "sms-setup-pending",
  ready: false,
  canEdit: true,
  candidates: [one, two],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function submit() {
  fireEvent.submit(screen.getByRole("button").closest("form")!);
}
it.each([
  "invalid",
  "forbidden",
  "unavailable",
  "conflict",
  "invalid-recipient",
] as const)(
  "R19 %s preserves unsaved choice focuses error and gates reload",
  async (status) => {
    const action = vi
      .fn()
      .mockResolvedValue({ status, message: "Safe result" });
    render(<RecipientPanel recipient={recipient} action={action} />);
    fireEvent.change(screen.getByLabelText("Proposed reminder recipient"), {
      target: { value: two.id },
    });
    submit();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("alert")),
    );
    expect(
      (
        screen.getByLabelText(
          "Proposed reminder recipient",
        ) as HTMLSelectElement
      ).value,
    ).toBe(two.id);
    expect(
      screen.getByText(/Current recipient:/).closest("p")!.textContent,
    ).toContain(one.email);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      ["conflict", "invalid-recipient"].includes(status),
    );
    expect(
      screen.queryByRole("link", { name: "Reload recipient" }) !== null,
    ).toBe(["conflict", "invalid-recipient"].includes(status));
    const data = action.mock.calls[0][1];
    expect(data.get("intent")).toBe("assign");
    expect(data.get("membershipId")).toBe(two.id);
    expect(data.get("expectedVersion")).toBe("1");
  },
);
it("R19 pending save blocks repeats and successful version survives later outage", async () => {
  let finish: (state: RecipientState) => void = () => {};
  const action = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ status: "unavailable", message: "Try again" });
  render(<RecipientPanel recipient={recipient} action={action} />);
  fireEvent.change(screen.getByLabelText("Proposed reminder recipient"), {
    target: { value: two.id },
  });
  submit();
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  expect(
    (screen.getByLabelText("Proposed reminder recipient") as HTMLSelectElement)
      .disabled,
  ).toBe(true);
  finish({
    status: "success",
    message: "Saved",
    recipient: { ...recipient, selected: two, version: 2 },
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Saved"),
  );
  expect(
    screen.getByText(/Current recipient:/).closest("p")!.textContent,
  ).toContain(two.email);
  expect(refresh).toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Proposed reminder recipient"), {
    target: { value: one.id },
  });
  submit();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("Try again"),
  );
  expect(action.mock.calls[1][1].get("expectedVersion")).toBe("2");
});
it("R20 explicit clear requires confirmation and never sends an empty assignment", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false),
    action = vi.fn().mockResolvedValue({
      status: "success",
      message: "Cleared",
      recipient: {
        ...recipient,
        selected: null,
        version: 2,
        readiness: "no-recipient",
      },
    });
  render(<RecipientPanel recipient={recipient} action={action} />);
  fireEvent.change(screen.getByLabelText("Proposed reminder recipient"), {
    target: { value: "" },
  });
  submit();
  expect(action).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith(
    "Clear the reminder recipient? This practice will have no reminder recipient.",
  );
  confirm.mockReturnValue(true);
  submit();
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Cleared"),
  );
  expect(action.mock.calls[0][1].get("intent")).toBe("clear");
  expect(action.mock.calls[0][1].has("membershipId")).toBe(false);
  expect(
    screen.getByText(/Current recipient:/).closest("p")!.textContent,
  ).toContain("No reminder recipient selected");
});
it("R18 viewer sees minimal current state and defensive unavailable readiness", () => {
  render(
    <RecipientPanel
      recipient={{
        version: 3,
        selected: { ...two, state: "revoked" },
        readiness: "member-unavailable",
        ready: false,
        canEdit: false,
      }}
      action={vi.fn()}
    />,
  );
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByText(/The selected member is unavailable/)).toBeTruthy();
});
it("R20 team controls explain clearing the selected recipient", () => {
  render(
    <MemberControls
      member={{ ...two, version: 1 }}
      recipient
      action={vi.fn()}
    />,
  );
  expect(
    screen.getByText(
      /Revoking access or changing their role to Viewer will clear the assignment/,
    ),
  ).toBeTruthy();
});
it("R18 refreshed membership authority updates controls even without a recipient version change", () => {
  const action = vi.fn(),
    view = render(<RecipientPanel recipient={recipient} action={action} />);
  view.rerender(
    <RecipientPanel
      recipient={{
        version: 1,
        selected: one,
        readiness: "sms-setup-pending",
        ready: false,
        canEdit: false,
      }}
      action={action}
    />,
  );
  expect(screen.queryByRole("combobox")).toBeNull();
});
it("R19 authoritative newer assignment replaces a draft on refresh", () => {
  const action = vi.fn(),
    view = render(<RecipientPanel recipient={recipient} action={action} />);
  view.rerender(
    <RecipientPanel
      recipient={{ ...recipient, version: 2, selected: two }}
      action={action}
    />,
  );
  expect(
    (screen.getByLabelText("Proposed reminder recipient") as HTMLSelectElement)
      .value,
  ).toBe(two.id);
});
