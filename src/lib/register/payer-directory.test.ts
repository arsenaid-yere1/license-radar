import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  registerInputSchema,
  maintenanceInputSchema,
  credentialSchema,
  maintenanceRegisterSchema,
  typeLabels,
} from "./schema";
import {
  renewalRegisterSchema,
  completionResultSchema,
} from "@/lib/renewals/schema";
import { renewalHistorySchema } from "@/lib/renewals/history";
import { pageSchema } from "@/lib/evidence/schema";
import { createRecord } from "./repository";
import { parseCalendarQuery, calendarHref } from "@/lib/calendar/query";
import { projectCalendar } from "@/lib/calendar/events";
import { projectDashboard } from "@/lib/dashboard/summary";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  next = "bbbbbbbb-0000-4000-8000-000000000002";
const type = "insurance_payer_provider_directory";
const input = {
  intent: "credential",
  requestId: id,
  title: " DIR fixture ",
  type,
  ownerKind: "practice",
  recordNumber: " 000DIR-01 ",
  issuer: " Fixture assessor ",
  jurisdiction: " US ",
  endDate: "2090-03-02",
  actionDeadline: "2090-02-01",
};
const cycle = {
  id,
  cycle_number: 1,
  date_revision: 1,
  end_date: "2090-03-02",
  action_deadline: "2090-02-01",
};
const record = {
  id,
  title: "DIR fixture",
  type,
  owner_kind: "practice",
  owner_clinician_id: null,
  owner_name: "Practice",
  version: 1,
  covered_clinicians: [],
  issuer: "Fixture assessor",
  jurisdiction: "US",
  record_number: "000DIR-01",
  current_cycle: cycle,
  archived_at: null,
  suspected_duplicate_ids: [],
  renewal: {
    link: { url: null, version: 1 },
    workflow: {
      cycleId: id,
      status: "not-started",
      version: 1,
      acknowledgedAt: null,
    },
  },
};
const historyCycle = {
  id,
  cycleNumber: 1,
  dateRevision: 1,
  type,
  endDate: cycle.end_date,
  actionDeadline: cycle.action_deadline,
  completedAt: null,
  successorId: null,
  progress: "not-started",
  acknowledgedAt: null,
};
it("DIR01 DIR02 fifth type normalizes input and mixed register responses", async () => {
  const parsed = registerInputSchema.parse(input);
  expect(parsed).toMatchObject({
    title: "DIR fixture",
    recordNumber: "000DIR-01",
    issuer: "Fixture assessor",
    jurisdiction: "US",
    type,
  });
  expect(typeLabels).toHaveProperty(type, "Insurance payer provider directory");
  const mixed = {
    clinicians: [],
    credentials: [record, { ...record, id: next, type: "state_license" }],
  };
  expect(maintenanceRegisterSchema.parse(mixed).credentials).toHaveLength(2);
  expect(renewalRegisterSchema.parse(mixed).credentials[0].type).toBe(type);
  const rpc = vi.fn().mockResolvedValue({
    data: { status: "success", credential: record },
    error: null,
  });
  expect(
    (await createRecord({ rpc } as unknown as SupabaseClient, id, parsed))
      .status,
  ).toBe("success");
  expect(rpc).toHaveBeenCalledWith(
    "create_practice_credential_with_number",
    expect.objectContaining({
      p_type: type,
      p_owner_kind: "practice",
      p_owner_clinician_id: null,
      p_record_number: "000DIR-01",
    }),
  );
});
it("DIR03 input and output reject incoherent ownership and forged directory coverage", () => {
  expect(credentialSchema.safeParse(record).success).toBe(true);
  for (const patch of [
    { ownerKind: "clinician" },
    { ownerKind: "practice", ownerClinicianId: next },
    { coveredClinicianIds: [next] },
    { type: "directory_other" },
  ]) {
    expect(registerInputSchema.safeParse({ ...input, ...patch }).success).toBe(
      false,
    );
    expect(
      maintenanceInputSchema.safeParse({
        ...input,
        intent: "update",
        id,
        expectedVersion: 1,
        expectedCycleId: id,
        expectedDateRevision: 1,
        ...patch,
      }).success,
    ).toBe(false);
  }
  expect(
    registerInputSchema.safeParse({
      ...input,
      ownerKind: "clinician",
      ownerClinicianId: next,
    }).success,
  ).toBe(true);
  expect(
    credentialSchema.safeParse({
      ...record,
      owner_kind: "clinician",
      owner_clinician_id: next,
    }).success,
  ).toBe(true);
  for (const patch of [
    { owner_kind: "clinician" },
    { owner_kind: "practice", owner_clinician_id: next },
    { covered_clinicians: [{ id: next, name: "Rivera" }] },
    { type: "directory_other" },
  ])
    expect(credentialSchema.safeParse({ ...record, ...patch }).success).toBe(
      false,
    );
});
it("DIR01 DIR06 DIR07 history completion and evidence share DIR cycle validation", () => {
  expect(
    renewalHistorySchema.parse({
      status: "success",
      credentialId: id,
      title: record.title,
      archivedAt: null,
      currentCycleId: id,
      cycles: [historyCycle],
      nextBeforeCycleNumber: null,
    }).cycles[0].type,
  ).toBe(type);
  expect(
    pageSchema.parse({
      status: "success",
      credentialId: id,
      cycleId: id,
      title: record.title,
      archivedAt: null,
      current: true,
      cycle: historyCycle,
      files: [],
      notices: [],
    }).cycle.type,
  ).toBe(type);
  expect(
    completionResultSchema.parse({
      status: "success",
      changed: true,
      credential: {
        ...record,
        current_cycle: { ...cycle, id: next, cycle_number: 2 },
        renewal: {
          ...record.renewal,
          workflow: { ...record.renewal.workflow, cycleId: next },
        },
      },
      completedCycle: {
        ...historyCycle,
        completedAt: "2089-01-01T00:00:00Z",
        successorId: next,
      },
    }).status,
  ).toBe("success");
});
it("DIR01 DIR02 calendar filters and urgency preserve directory due date and unknown semantics", () => {
  const parsed = maintenanceRegisterSchema.parse({
    clinicians: [],
    credentials: [record],
  });
  const query = parseCalendarQuery({ month: "2090-03", type }, "2090-01-01");
  expect(query.invalidFilters).toBe(false);
  expect(
    parseCalendarQuery(
      Object.fromEntries(
        new URL(calendarHref(query), "http://fixture").searchParams,
      ),
      "2090-01-01",
    ),
  ).toEqual(query);
  expect(
    projectCalendar(parsed, query).events.map((e) => [
      e.date,
      e.purpose,
      e.tracking,
    ]),
  ).toEqual([["2090-03-02", "directory update due", false]]);
  expect(
    projectDashboard(parsed, "2090-01-01").dueWithin60[0].tracking,
  ).toEqual({ date: "2090-02-01", purpose: "earlier action deadline" });
  const undated = maintenanceRegisterSchema.parse({
    clinicians: [],
    credentials: [
      {
        ...record,
        current_cycle: { ...cycle, end_date: null, action_deadline: null },
      },
    ],
  });
  expect(projectDashboard(undated, "2090-01-01").undated).toHaveLength(1);
});

import { endDatePurpose, cycleEndLabel, directoryDateError } from "./dates";
it("DIR04 independent date labels and canonical error display preserve all old types", () => {
  const cases = [
    ["state_license", "expiration", "Expiration"],
    ["dea_registration", "expiration", "Expiration"],
    ["malpractice_policy", "coverage end", "Coverage end"],
    ["pci_compliance_certificate", "expiration", "Expiration"],
    [
      "insurance_payer_provider_directory",
      "directory update due",
      "Next directory update due",
    ],
    ["unknown", "expiration", "Expiration"],
  ];
  const order = "The action deadline must be earlier than the end date.";
  const future = "Enter an end date after today in the practice timezone.";
  for (const [type, purpose, label] of cases) {
    expect(endDatePurpose(type)).toBe(purpose);
    expect(cycleEndLabel(type)).toBe(label);
    expect(directoryDateError(type, order)).toBe(
      type === "insurance_payer_provider_directory"
        ? "The action deadline must be earlier than the next directory update due date."
        : order,
    );
    expect(directoryDateError(type, future)).toBe(
      type === "insurance_payer_provider_directory"
        ? "Enter a next directory update due date after today in the practice timezone."
        : future,
    );
    for (const message of [
      undefined,
      "Enter a valid date (YYYY-MM-DD).",
      "Unrecognized end date error",
      "toString",
      "",
    ])
      expect(directoryDateError(type, message)).toBe(message);
  }
});
