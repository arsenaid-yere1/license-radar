import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CredentialFields } from "@/components/register/credential-fields";
import { EditRecordForm } from "@/components/register/edit-record-form";
import { RegisterPanel } from "@/components/register/register-panel";
import type { MaintenanceCredential } from "@/lib/register/schema";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
const record: MaintenanceCredential = {
  id,
  title: "Fixture",
  type: "state_license",
  owner_kind: "practice",
  owner_clinician_id: null,
  owner_name: "Practice",
  version: 1,
  covered_clinicians: [],
  issuer: null,
  jurisdiction: null,
  record_number: "000Ab-01",
  current_cycle: {
    id,
    cycle_number: 1,
    date_revision: 1,
    end_date: null,
    action_deadline: null,
  },
  archived_at: null,
};
afterEach(cleanup);
it("RN01 RN07 optional labels preserve number on owner edits and explicitly clear on type reset", () => {
  render(<CredentialFields record={record} clinicians={[]} errors={{}} />);
  const field = screen.getByLabelText(
    "License number (optional)",
  ) as HTMLInputElement;
  expect(field.value).toBe("000Ab-01");
  expect(field.type).toBe("text");
  fireEvent.change(screen.getByLabelText("Record owner"), {
    target: { value: "clinician" },
  });
  expect(field.value).toBe("000Ab-01");
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "dea_registration" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Keep current type" }));
  expect(field.value).toBe("000Ab-01");
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "dea_registration" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm type change" }));
  expect(
    (
      screen.getByLabelText(
        "DEA registration number (optional)",
      ) as HTMLInputElement
    ).value,
  ).toBe("");
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "malpractice_policy" },
  });
  expect(
    (screen.getByLabelText("Policy number (optional)") as HTMLInputElement)
      .value,
  ).toBe("");
});
it("RN08 conflict comparison exposes winning number and requires explicit draft discard", async () => {
  const action = vi.fn().mockResolvedValue({
    status: "conflict",
    credential: { ...record, version: 2, record_number: "WIN-0002" },
    message: "This record changed.",
  });
  render(
    <EditRecordForm
      record={record}
      clinicians={[]}
      action={action}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
      onLock={vi.fn()}
    />,
  );
  const field = screen.getByLabelText(
    "License number (optional)",
  ) as HTMLInputElement;
  fireEvent.change(field, { target: { value: "DRAFT-0003" } });
  fireEvent.submit(
    screen.getByRole("button", { name: "Save changes" }).closest("form")!,
  );
  await screen.findByText("License number: WIN-0002");
  expect(field.value).toBe("DRAFT-0003");
  expect(field.matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved values" }));
  expect(
    (screen.getByLabelText("License number (optional)") as HTMLInputElement)
      .value,
  ).toBe("WIN-0002");
});
it("RN08 uncertain number save retries identical frozen payload", async () => {
  const payloads: [string, FormDataEntryValue][][] = [];
  const action = vi.fn(async (_state, form: FormData) => {
    payloads.push(Array.from(form));
    return payloads.length === 1
      ? { status: "unavailable" as const, message: "Retry this save" }
      : {
          status: "success" as const,
          changed: true,
          credential: { ...record, version: 2, record_number: "000-new" },
        };
  });
  const saved = vi.fn();
  render(
    <EditRecordForm
      record={record}
      clinicians={[]}
      action={action}
      onSaved={saved}
      onCancel={vi.fn()}
      onLock={vi.fn()}
    />,
  );
  const field = screen.getByLabelText(
    "License number (optional)",
  ) as HTMLInputElement;
  fireEvent.change(field, { target: { value: "000-new" } });
  fireEvent.submit(
    screen.getByRole("button", { name: "Save changes" }).closest("form")!,
  );
  await screen.findByRole("button", { name: "Retry this save" });
  expect(field.matches(":disabled")).toBe(true);
  fireEvent.submit(
    screen.getByRole("button", { name: "Retry this save" }).closest("form")!,
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0]).toContainEqual(["recordNumber", "000-new"]);
});
it("RN03 register and archive display escaped numbers and distinct app references", () => {
  for (const archived of [false, true]) {
    const r = {
      ...record,
      record_number: "<script>0001</script>",
      archived_at: archived ? "2030-01-01T00:00:00Z" : null,
    };
    const view = render(
      <RegisterPanel
        register={{ clinicians: [], credentials: [r] }}
        canEdit={false}
        action={vi.fn()}
        clinicianKey={id}
        credentialKey={id}
        archivedView={archived}
      />,
    );
    expect(
      screen.getByText("License number: <script>0001</script>"),
    ).toBeTruthy();
    expect(screen.getByText(/App reference: 000001/)).toBeTruthy();
    expect(view.container.querySelector("script")).toBeNull();
    view.unmount();
  }
  render(
    <RegisterPanel
      register={{
        clinicians: [],
        credentials: [{ ...record, record_number: null }],
      }}
      canEdit={false}
      action={vi.fn()}
      clinicianKey={id}
      credentialKey={id}
    />,
  );
  expect(screen.getByText("License number: Not entered")).toBeTruthy();
});
