import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CredentialFields } from "@/components/register/credential-fields";
import { CompletionFields } from "@/components/renewals/completion-fields";
import { RecordDates } from "@/components/register/record-dates";
import { RecordNumber } from "@/components/register/record-number";
import { credentialSchema } from "@/lib/register/schema";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const id = "aaaaaaaa-0000-4000-8000-000000000001";
const clinician = { id, name: "Rivera", version: 1 };
const record = {
  id,
  title: "Certificate",
  type: "state_license" as const,
  owner_kind: "clinician" as const,
  owner_clinician_id: id,
  owner_name: "Rivera",
  version: 1,
  covered_clinicians: [],
  issuer: "Board",
  jurisdiction: "CA",
  record_number: "000X",
  current_cycle: {
    id,
    cycle_number: 1,
    date_revision: 1,
    end_date: "2090-03-02",
    action_deadline: null,
  },
};
afterEach(cleanup);
it("PCI03 PCI05 confirmed clinician to PCI transition locks practice owner and cancellation preserves draft", () => {
  const view = render(
    <form>
      <CredentialFields record={record} clinicians={[clinician]} errors={{}} />
    </form>,
  );
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "pci_compliance_certificate" },
  });
  expect(
    screen.getByRole("group", { name: "Review type change" }),
  ).toBeTruthy();
  expect(
    (screen.getByLabelText("Record owner") as HTMLSelectElement).value,
  ).toBe("clinician");
  fireEvent.click(screen.getByRole("button", { name: "Keep current type" }));
  expect(
    (screen.getByLabelText("License number (optional)") as HTMLInputElement)
      .value,
  ).toBe("000X");
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "pci_compliance_certificate" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm type change" }));
  expect(screen.getByText("Record owner: This practice")).toBeTruthy();
  expect(screen.queryByLabelText("Owning clinician")).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Record owner" })).toBeNull();
  expect(screen.queryByText("Covered clinicians (optional)")).toBeNull();
  const form = new FormData(view.container.querySelector("form")!);
  expect(form.get("ownerKind")).toBe("practice");
  expect(form.has("ownerClinicianId")).toBe(false);
  expect(form.get("recordNumber")).toBe("");
  expect(form.get("issuer")).toBe("");
  expect(form.get("endDate")).toBe("");
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "state_license" },
  });
  expect(
    (screen.getByLabelText("Record owner") as HTMLSelectElement).value,
  ).toBe("practice");
  fireEvent.change(screen.getByLabelText("Record owner"), {
    target: { value: "clinician" },
  });
  expect(
    (screen.getByLabelText("Owning clinician") as HTMLSelectElement).value,
  ).toBe("");
});
it("PCI03 new form switches a clinician draft to fixed practice ownership without submitting clinician", () => {
  const v = render(
    <form>
      <CredentialFields
        clinicians={[clinician]}
        errors={{ ownerKind: "Check ownership" }}
      />
    </form>,
  );
  fireEvent.change(screen.getByLabelText("Record owner"), {
    target: { value: "clinician" },
  });
  fireEvent.change(screen.getByLabelText("Owning clinician"), {
    target: { value: id },
  });
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "pci_compliance_certificate" },
  });
  expect(screen.getByText("Record owner: This practice")).toBeTruthy();
  expect(screen.getByText("Check ownership")).toBeTruthy();
  expect(
    new FormData(v.container.querySelector("form")!).has("ownerClinicianId"),
  ).toBe(false);
  expect(screen.getByLabelText("Certificate issuer (optional)")).toBeTruthy();
  expect(screen.getByLabelText("Jurisdiction (optional)")).toBeTruthy();
});
it("PCI01 PCI02 PCI06 certificate display and completion labels reflect expiration", () => {
  const pci = credentialSchema.parse({
    ...record,
    type: "pci_compliance_certificate",
    owner_kind: "practice",
    owner_clinician_id: null,
    owner_name: "Practice",
  });
  render(
    <>
      <RecordNumber record={pci} />
      <RecordDates record={pci} />
      <CompletionFields
        record={{
          ...pci,
          archived_at: null,
          renewal: {
            link: { url: null, version: 1 },
            workflow: {
              cycleId: id,
              status: "not-started",
              version: 1,
              acknowledgedAt: null,
            },
          },
        }}
        timezone="UTC"
      />
    </>,
  );
  expect(screen.getByText("Certificate number: 000X")).toBeTruthy();
  expect(screen.getByText("Certificate issuer: Board")).toBeTruthy();
  expect(screen.getByLabelText("New expiration date")).toBeTruthy();
});
it("PCI05 saved clinician ownership alone requires explicit PCI confirmation", () => {
  render(
    <CredentialFields
      record={{
        ...record,
        record_number: null,
        issuer: null,
        jurisdiction: null,
        current_cycle: { ...record.current_cycle, end_date: null },
      }}
      clinicians={[clinician]}
      errors={{}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Record type"), {
    target: { value: "pci_compliance_certificate" },
  });
  expect(
    screen.getByRole("group", { name: "Review type change" }),
  ).toBeTruthy();
  expect(
    screen.getByText(/this change also clears the owning clinician/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep current type" }));
  expect(
    (screen.getByLabelText("Record owner") as HTMLSelectElement).value,
  ).toBe("clinician");
  expect(
    (screen.getByLabelText("Owning clinician") as HTMLSelectElement).value,
  ).toBe(id);
});
