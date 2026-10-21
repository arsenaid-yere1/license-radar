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
const type = "pci_compliance_certificate";
const input = {
  intent: "credential",
  requestId: id,
  title: " PCI fixture ",
  type,
  ownerKind: "practice",
  recordNumber: " 000PCI-01 ",
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
  title: "PCI fixture",
  type,
  owner_kind: "practice",
  owner_clinician_id: null,
  owner_name: "Practice",
  version: 1,
  covered_clinicians: [],
  issuer: "Fixture assessor",
  jurisdiction: "US",
  record_number: "000PCI-01",
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
it("PCI01 PCI02 fourth type normalizes input and mixed register responses", async () => {
  const parsed = registerInputSchema.parse(input);
  expect(parsed).toMatchObject({
    title: "PCI fixture",
    recordNumber: "000PCI-01",
    issuer: "Fixture assessor",
    jurisdiction: "US",
    type,
  });
  expect(typeLabels).toHaveProperty(type, "PCI compliance certificate");
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
      p_record_number: "000PCI-01",
    }),
  );
});
it("PCI03 input and output reject clinician ownership and forged PCI coverage", () => {
  expect(credentialSchema.safeParse(record).success).toBe(true);
  for (const patch of [
    { ownerKind: "clinician", ownerClinicianId: next },
    { ownerKind: "practice", ownerClinicianId: next },
    { coveredClinicianIds: [next] },
    { type: "pci_other" },
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
  const bad = registerInputSchema.safeParse({
    ...input,
    ownerKind: "clinician",
    ownerClinicianId: next,
  });
  expect(bad.success).toBe(false);
  if (!bad.success)
    expect(bad.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["ownerKind"],
        message: "PCI compliance certificates must be owned by the practice.",
      }),
    );
  for (const patch of [
    { owner_kind: "clinician", owner_clinician_id: next },
    { owner_kind: "practice", owner_clinician_id: next },
    { covered_clinicians: [{ id: next, name: "Rivera" }] },
    { type: "pci_other" },
  ])
    expect(credentialSchema.safeParse({ ...record, ...patch }).success).toBe(
      false,
    );
});
it("PCI01 PCI06 PCI07 history completion and evidence share PCI cycle validation", () => {
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
it("PCI01 PCI02 calendar filters and urgency preserve expiration and unknown semantics", () => {
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
  ).toEqual([["2090-03-02", "expiration", false]]);
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
