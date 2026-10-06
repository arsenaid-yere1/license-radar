import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { RegisterPanel } from "@/components/register/register-panel";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const one = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Rivera",
  version: 1,
};
const two = {
  ...one,
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  name: "Chen",
};
const register = { clinicians: [one, two], credentials: [] };
function panel(action = vi.fn(), canEdit = true) {
  return (
    <RegisterPanel
      register={register}
      canEdit={canEdit}
      action={action}
      clinicianKey="clin-key"
      credentialKey="record-key"
    />
  );
}
function submit(label: string) {
  fireEvent.submit(
    screen.getByRole("button", { name: label }).closest("form")!,
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("G21 deselecting a covered clinician preserves the other policy choices", async () => {
  const action = vi
    .fn()
    .mockResolvedValue({ status: "invalid", message: "Review policy" });
  render(panel(action));
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "malpractice_policy" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /Rivera/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Chen/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Rivera/ }));
  expect(
    (screen.getByRole("checkbox", { name: /Rivera/ }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(
    (screen.getByRole("checkbox", { name: /Chen/ }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  submit("Add record");
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(action.mock.calls[0][1].getAll("coveredClinicianIds")).toEqual([
    two.id,
  ]);
});
it("G19 viewer sees saved people and truthful date-pending record without create controls", () => {
  const credential = {
    id: one.id,
    title: "Shared policy",
    type: "malpractice_policy" as const,
    owner_kind: "practice" as const,
    owner_clinician_id: null,
    owner_name: "Practice",
    version: 1,
    covered_clinicians: [one, two],
  };
  render(
    <RegisterPanel
      register={{ ...register, credentials: [credential] }}
      canEdit={false}
      action={vi.fn()}
      clinicianKey="a"
      credentialKey="b"
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getAllByText("Shared policy")).toHaveLength(1);
  expect(screen.getByText(/Covers: Rivera, Chen/)).toBeTruthy();
  expect(screen.getByText("Dates not entered")).toBeTruthy();
  expect(screen.getByText("Text reminders are not active yet.")).toBeTruthy();
  expect(screen.getByText(/read-only/)).toBeTruthy();
});
it("G20 validation keeps draft and associates field error; acknowledged success resets key and survives stale refresh", async () => {
  const action = vi
    .fn()
    .mockResolvedValueOnce({
      status: "invalid",
      message: "Check the highlighted fields.",
      errors: { name: "Use 1 to 120 characters." },
    })
    .mockResolvedValue({
      status: "success",
      message: "Clinician saved.",
      clinician: {
        ...one,
        id: "cccccccc-0000-4000-8000-000000000003",
        name: "New clinician",
      },
    });
  const view = render(panel(action));
  fireEvent.change(screen.getByLabelText("Clinician name"), {
    target: { value: " New clinician " },
  });
  submit("Add clinician");
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Check the highlighted fields.",
    ),
  );
  const input = screen.getByLabelText("Clinician name") as HTMLInputElement;
  expect(input.value).toBe(" New clinician ");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(
    document.getElementById(input.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toBe("Use 1 to 120 characters.");
  expect(document.activeElement).toBe(screen.getByRole("alert"));
  submit("Add clinician");
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Clinician saved."),
  );
  expect(
    (screen.getByLabelText("Clinician name") as HTMLInputElement).value,
  ).toBe("");
  expect(action.mock.calls[1][1].get("requestId")).toBe("clin-key");
  expect(
    (
      screen
        .getByLabelText("Clinician name")
        .closest("form")!
        .elements.namedItem("requestId") as HTMLInputElement
    ).value,
  ).not.toBe("clin-key");
  expect(refresh).toHaveBeenCalled();
  view.rerender(panel(action));
  expect(
    screen.getByRole("list", { name: "Saved clinicians" }).textContent,
  ).toContain("New clinician");
});
it("G21 uncertain retry freezes exact payload and pending blocks controls", async () => {
  let resolve!: (value: unknown) => void;
  const action = vi
    .fn()
    .mockRejectedValueOnce(new Error("private"))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  render(panel(action));
  fireEvent.change(screen.getByLabelText("Clinician name"), {
    target: { value: "Retry person" },
  });
  submit("Add clinician");
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "We could not confirm this save. Retry this save before changing it.",
    ),
  );
  expect(screen.getByLabelText("Clinician name").matches(":disabled")).toBe(
    true,
  );
  submit("Retry this save");
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(Array.from(action.mock.calls[1][1])).toEqual(
    Array.from(action.mock.calls[0][1]),
  );
  expect(
    (screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  resolve({
    status: "success",
    clinician: { ...one, name: "Retry person" },
    message: "Clinician saved.",
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Clinician saved."),
  );
});
it("G21 conflict and denied authority block a new key, while definite invalid-reference permits correction", async () => {
  for (const status of ["request-conflict", "forbidden", "invalid-reference"]) {
    const action = vi
      .fn()
      .mockResolvedValue({ status, message: "Review selection" });
    const view = render(panel(action));
    submit("Add clinician");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Review selection"),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Add clinician",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(status !== "invalid-reference");
    expect(
      screen
        .getByRole("link", { name: "Reload register" })
        .getAttribute("href"),
    ).toBe("/practice/register");
    view.unmount();
  }
});
it("G20 ownership and type switches clear incompatible coverage and clinician identity", async () => {
  const action = vi
    .fn()
    .mockResolvedValue({ status: "invalid", message: "Invalid" });
  render(panel(action));
  fireEvent.change(screen.getByLabelText("Record title"), {
    target: { value: "Policy" },
  });
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "malpractice_policy" },
  });
  expect(
    screen.getByRole("group", { name: "Covered clinicians (optional)" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: /Rivera/ }));
  submit("Add record");
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect(action.mock.calls[0][1].getAll("coveredClinicianIds")).toEqual([
    one.id,
  ]);
  fireEvent.change(screen.getByLabelText("Record owner"), {
    target: { value: "clinician" },
  });
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.change(screen.getByLabelText("Owning clinician"), {
    target: { value: one.id },
  });
  fireEvent.change(screen.getByLabelText("Record owner"), {
    target: { value: "practice" },
  });
  expect(
    (screen.getByRole("checkbox", { name: /Rivera/ }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "state_license" },
  });
  expect(screen.queryByRole("checkbox")).toBeNull();
  submit("Add record");
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(action.mock.calls[1][1].has("ownerClinicianId")).toBe(false);
  expect(action.mock.calls[1][1].getAll("coveredClinicianIds")).toEqual([]);
});

it("A02 markup names are text and missing clinician choices explain the next action", () => {
  const text = "<img src=x onerror=alert(1)>";
  const view = render(
    <RegisterPanel
      register={{ clinicians: [{ ...one, name: text }], credentials: [] }}
      canEdit={false}
      action={vi.fn()}
      clinicianKey="a"
      credentialKey="b"
    />,
  );
  expect(
    screen.getByRole("list", { name: "Saved clinicians" }).textContent,
  ).toContain(text);
  expect(view.container.querySelector("img")).toBeNull();
  view.unmount();
  render(
    <RegisterPanel
      register={{ clinicians: [], credentials: [] }}
      canEdit
      action={vi.fn()}
      clinicianKey="a"
      credentialKey="b"
    />,
  );
  fireEvent.change(screen.getByLabelText("Record owner"), {
    target: { value: "clinician" },
  });
  expect(screen.getByText("Add a clinician first.")).toBeTruthy();
});

it("G21 coverage field errors stay linked to retained choices", async () => {
  const action = vi.fn().mockResolvedValue({
    status: "invalid",
    message: "Check the highlighted fields.",
    errors: { coveredClinicianIds: "Choose each covered clinician once." },
  });
  render(panel(action));
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "malpractice_policy" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /Rivera/ }));
  submit("Add record");
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Check the highlighted fields.",
    ),
  );
  const group = screen.getByRole("group", {
    name: "Covered clinicians (optional)",
  });
  expect(group.getAttribute("aria-invalid")).toBe("true");
  expect(
    document.getElementById(group.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toBe("Choose each covered clinician once.");
  expect(
    (screen.getByRole("checkbox", { name: /Rivera/ }) as HTMLInputElement)
      .checked,
  ).toBe(true);
});
