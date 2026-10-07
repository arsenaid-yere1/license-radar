import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { RegisterPanel } from "@/components/register/register-panel";
import type {
  MaintenanceAction,
  MaintenanceRegister,
} from "@/lib/register/schema";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  cycle = "bbbbbbbb-0000-4000-8000-000000000002";
const record = {
  id,
  title: "Policy",
  type: "malpractice_policy" as const,
  owner_kind: "practice" as const,
  owner_clinician_id: null,
  owner_name: "Practice",
  version: 1,
  covered_clinicians: [{ id: cycle, name: "Rivera" }],
  issuer: "Insurer",
  jurisdiction: "CA",
  current_cycle: {
    id: cycle,
    cycle_number: 1 as const,
    date_revision: 1,
    end_date: "2028-02-29",
    action_deadline: "2028-02-01",
  },
  archived_at: null,
  suspected_duplicate_ids: [],
};
const register: MaintenanceRegister = {
  clinicians: [{ id: cycle, name: "Rivera", version: 1 }],
  credentials: [record],
};
function panel(
  action: MaintenanceAction,
  data = register,
  readKey = "read1",
  archivedView = false,
  canEdit = true,
) {
  return (
    <RegisterPanel
      register={data}
      canEdit={canEdit}
      action={vi.fn()}
      maintenanceAction={action}
      clinicianKey="c"
      credentialKey="k"
      readKey={readKey}
      archivedView={archivedView}
    />
  );
}
function editor() {
  return within(screen.getByRole("region", { name: "Edit Policy" }));
}
async function submit(label: string) {
  await act(async () => {
    fireEvent.submit(
      screen.getByRole("button", { name: label }).closest("form")!,
    );
  });
}
afterEach(() => {
  cleanup();
  refresh.mockClear();
});
it("M12 prefilled edits cancel without writes and confirm a populated type reset", () => {
  const action = vi.fn();
  render(panel(action));
  fireEvent.click(screen.getByRole("button", { name: "Edit record" }));
  const e = editor();
  expect((e.getByLabelText("Record title") as HTMLInputElement).value).toBe(
    "Policy",
  );
  expect(
    (e.getByLabelText("Coverage end date") as HTMLInputElement).value,
  ).toBe("2028-02-29");
  expect((e.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  fireEvent.change(e.getByLabelText("Record owner"), {
    target: { value: "clinician" },
  });
  expect(
    (e.getByLabelText("Coverage end date") as HTMLInputElement).value,
  ).toBe("2028-02-29");
  expect(e.queryByRole("checkbox")).toBeNull();
  fireEvent.change(e.getByLabelText("Owning clinician"), {
    target: { value: cycle },
  });
  fireEvent.change(e.getByLabelText("Record owner"), {
    target: { value: "practice" },
  });
  expect((e.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  fireEvent.change(e.getByLabelText("Record type"), {
    target: { value: "state_license" },
  });
  fireEvent.click(e.getByRole("button", { name: "Keep current type" }));
  expect(
    (e.getByLabelText("Coverage end date") as HTMLInputElement).value,
  ).toBe("2028-02-29");
  fireEvent.change(e.getByLabelText("Record type"), {
    target: { value: "state_license" },
  });
  fireEvent.click(e.getByRole("button", { name: "Confirm type change" }));
  expect((e.getByLabelText("Expiration date") as HTMLInputElement).value).toBe(
    "",
  );
  expect(
    (e.getByLabelText("Licensing board (optional)") as HTMLInputElement).value,
  ).toBe("");
  fireEvent.click(e.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("region", { name: "Edit Policy" })).toBeNull();
  expect(action).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Edit record" })).toBe(
    document.activeElement,
  );
});
it("M12 definite errors retain draft and conflict requires explicit replacement and fresh tokens", async () => {
  const current = {
    ...record,
    title: "Newer policy",
    version: 2,
    current_cycle: { ...record.current_cycle, date_revision: 2 },
  };
  const action = vi
    .fn()
    .mockResolvedValueOnce({
      status: "invalid",
      message: "Check the highlighted fields.",
      errors: { title: "Use 1 to 120 characters." },
    })
    .mockResolvedValueOnce({
      status: "conflict",
      message: "This record changed. Compare your draft with the saved values.",
      credential: current,
    })
    .mockResolvedValue({
      status: "success",
      changed: true,
      credential: { ...current, title: "Reviewed", version: 3 },
      message: "Changes saved.",
    });
  render(panel(action));
  fireEvent.click(screen.getByRole("button", { name: "Edit record" }));
  fireEvent.change(editor().getByLabelText("Record title"), {
    target: { value: "Draft" },
  });
  await submit("Save changes");
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Check the highlighted fields.",
    ),
  );
  expect(
    editor().getByLabelText("Record title").getAttribute("aria-invalid"),
  ).toBe("true");
  await submit("Save changes");
  await waitFor(() =>
    expect(screen.getByText("Saved values for comparison")).toBeTruthy(),
  );
  expect(
    (editor().getByLabelText("Record title") as HTMLInputElement).value,
  ).toBe("Draft");
  expect(editor().getByLabelText("Record title").matches(":disabled")).toBe(
    true,
  );
  expect(screen.getByText("Newer policy")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reload saved values" }));
  expect(
    (editor().getByLabelText("Record title") as HTMLInputElement).value,
  ).toBe("Newer policy");
  fireEvent.change(editor().getByLabelText("Record title"), {
    target: { value: "Reviewed" },
  });
  await submit("Save changes");
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Changes saved."),
  );
  expect(action.mock.calls[2][1].get("expectedVersion")).toBe("2");
  expect(action.mock.calls[2][1].get("expectedDateRevision")).toBe("2");
  expect(action.mock.calls[2][1].get("requestId")).not.toBe(
    action.mock.calls[1][1].get("requestId"),
  );
  expect(refresh).toHaveBeenCalled();
});
it("M13 uncertain and pending freeze exact payload cancellation intent and view; retry confirms without stale resurrection", async () => {
  let resolve!: (v: unknown) => void;
  const action = vi
    .fn()
    .mockRejectedValueOnce(new Error("private"))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  const view = render(panel(action));
  fireEvent.click(screen.getByRole("button", { name: "Archive record" }));
  expect(screen.getByText(/Archive “Policy”/)).toBeTruthy();
  await submit("Confirm archive");
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Retry this save"),
  );
  expect(
    screen.getByRole("button", { name: "Cancel" }).matches(":disabled"),
  ).toBe(true);
  expect(screen.queryByRole("link", { name: "Archived records" })).toBeNull();
  await submit("Retry this save");
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(Array.from(action.mock.calls[1][1])).toEqual(
    Array.from(action.mock.calls[0][1]),
  );
  expect(
    screen.getByRole("button", { name: "Saving…" }).matches(":disabled"),
  ).toBe(true);
  resolve({
    status: "success",
    changed: true,
    message: "Record archived.",
    credential: { ...record, version: 2, archived_at: "2026-10-07T00:00:00Z" },
  });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Record archived."),
  );
  expect(screen.queryByRole("heading", { name: "Policy" })).toBeNull();
  view.rerender(panel(action, register, "read2"));
  expect(screen.queryByRole("heading", { name: "Policy" })).toBeNull();
  view.rerender(
    panel(
      action,
      {
        ...register,
        credentials: [
          { ...record, version: 3, archived_at: "2026-10-07T00:00:00Z" },
        ],
      },
      "read3",
      true,
    ),
  );
  expect(screen.getByRole("heading", { name: "Policy" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit record" })).toBeNull();
});
it("M10 M14 duplicates come from authoritative reads and viewers see archived inventory without controls", () => {
  const duplicate = {
    ...record,
    id: cycle,
    title: "Second policy",
    suspected_duplicate_ids: [id],
  };
  const data = {
    ...register,
    credentials: [{ ...record, suspected_duplicate_ids: [cycle] }, duplicate],
  };
  const v = render(panel(vi.fn(), data, "read", false, false));
  expect(
    screen.getAllByText("Possible duplicate — review these records"),
  ).toHaveLength(2);
  expect(
    screen.getByRole("link", { name: "Second policy" }).getAttribute("href"),
  ).toBe(`#record-${cycle}`);
  expect(screen.queryByRole("button", { name: "Edit record" })).toBeNull();
  v.rerender(
    panel(
      vi.fn(),
      {
        ...register,
        credentials: [{ ...record, archived_at: "2026-10-07T00:00:00Z" }],
      },
      "read2",
      true,
      false,
    ),
  );
  expect(screen.getByText(/Archived on/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Archive record" })).toBeNull();
  expect(
    screen.queryByText("Possible duplicate — review these records"),
  ).toBeNull();
});

it("M13 exact edit retry cannot replace a newer authoritative record with a historical receipt", async () => {
  const historical = { ...record, title: "Originally saved", version: 2 };
  const newer = { ...record, title: "Newer saved title", version: 3 };
  const action = vi
    .fn()
    .mockResolvedValueOnce({
      status: "unavailable",
      message: "Retry this save",
    })
    .mockResolvedValue({
      status: "success",
      changed: true,
      credential: historical,
      message: "Changes saved.",
    });
  const v = render(panel(action));
  fireEvent.click(screen.getByRole("button", { name: "Edit record" }));
  fireEvent.change(editor().getByLabelText("Record title"), {
    target: { value: "Originally saved" },
  });
  await submit("Save changes");
  await waitFor(() =>
    expect(editor().getByLabelText("Record title").matches(":disabled")).toBe(
      true,
    ),
  );
  v.rerender(panel(action, { ...register, credentials: [newer] }, "read2"));
  expect(
    (editor().getByLabelText("Record title") as HTMLInputElement).value,
  ).toBe("Originally saved");
  await submit("Retry this save");
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Changes saved."),
  );
  expect(Array.from(action.mock.calls[1][1])).toEqual(
    Array.from(action.mock.calls[0][1]),
  );
  expect(action.mock.calls[1][1].get("expectedVersion")).toBe("1");
  expect(
    screen.getByRole("heading", { name: "Newer saved title" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Edit record" }).matches(":disabled"),
  ).toBe(true);
  v.rerender(panel(action, { ...register, credentials: [newer] }, "read3"));
  expect(
    screen.getByRole("button", { name: "Edit record" }).matches(":disabled"),
  ).toBe(false);
});
