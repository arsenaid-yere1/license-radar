import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/practice/access", () => ({ getPracticeAccess: access }));
import * as schema from "@/lib/register/schema";
import * as operations from "@/lib/register/operations";
import * as repository from "@/lib/register/repository";
import * as messages from "@/lib/register/messages";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  other = "bbbbbbbb-0000-4000-8000-000000000002";
const raw = {
  intent: "update",
  requestId: id,
  id,
  expectedVersion: 1,
  expectedCycleId: other,
  expectedDateRevision: 1,
  title: " Policy ",
  type: "malpractice_policy",
  ownerKind: "practice",
  coveredClinicianIds: [other, id],
  issuer: " Insurer ",
  jurisdiction: " CA ",
  endDate: "2028-02-29",
  actionDeadline: "2028-02-01",
};
const record = {
  id,
  title: "Policy",
  type: "malpractice_policy",
  owner_kind: "practice",
  owner_clinician_id: null,
  owner_name: "Practice",
  version: 2,
  covered_clinicians: [],
  issuer: "Insurer",
  jurisdiction: "CA",
  current_cycle: {
    id: other,
    cycle_number: 1,
    date_revision: 1,
    end_date: "2028-02-29",
    action_deadline: "2028-02-01",
  },
  archived_at: null,
};
function client(
  data: unknown = { status: "success", changed: true, credential: record },
  error: unknown = null,
) {
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id } }, error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as unknown as SupabaseClient;
}
beforeEach(() =>
  access.mockReset().mockResolvedValue({
    status: "success",
    access: { role: "manager", practice: { id } },
  }),
);
it("M11 canonical maintenance schema retains authored rules and strict tokens", () => {
  expect(schema.maintenanceInputSchema).toBeDefined();
  const parsed = schema.maintenanceInputSchema.parse({
    ...raw,
    expectedVersion: "1",
    expectedDateRevision: "2147483647",
  });
  expect(parsed).toEqual({
    ...raw,
    title: "Policy",
    issuer: "Insurer",
    jurisdiction: "CA",
    expectedDateRevision: 2147483647,
    coveredClinicianIds: [id, other],
  });
  for (const field of ["expectedVersion", "expectedDateRevision"])
    for (const value of [
      "",
      "01",
      " 1",
      "1 ",
      "+1",
      "1.0",
      "1e2",
      "0",
      "-1",
      0,
      1.5,
      2147483648,
      null,
      undefined,
    ])
      expect(
        schema.maintenanceInputSchema.safeParse({ ...raw, [field]: value })
          .success,
      ).toBe(false);
  for (const field of [
    "practiceId",
    "actor",
    "archived_at",
    "effectiveDate",
    "suspected_duplicate_ids",
  ])
    expect(
      schema.maintenanceInputSchema.safeParse({ ...raw, [field]: id }).success,
    ).toBe(false);
  for (const patch of [
    { expectedCycleId: "bad" },
    { intent: "restore" },
    { ownerKind: "clinician" },
    { coveredClinicianIds: [id, id] },
    { type: "state_license" },
    { endDate: "1900-02-29" },
    { actionDeadline: "2028-02-29" },
    { title: " " },
    { issuer: "x".repeat(121) },
  ])
    expect(
      schema.maintenanceInputSchema.safeParse({ ...raw, ...patch }).success,
    ).toBe(false);
  const archive = {
    intent: "archive",
    requestId: id,
    id,
    expectedVersion: 1,
    expectedCycleId: other,
    expectedDateRevision: 1,
  };
  expect(schema.maintenanceInputSchema.parse(archive)).toEqual(archive);
  expect(
    schema.maintenanceInputSchema.safeParse({ ...archive, title: "Posted" })
      .success,
  ).toBe(false);
});
it("M11 live editor authority binds all canonical update and archive arguments", async () => {
  expect(operations.changeRegisterRecord).toBeDefined();
  for (const role of ["administrator", "manager"]) {
    access.mockResolvedValue({
      status: "success",
      access: { role, practice: { id } },
    });
    const c = client();
    expect(await operations.changeRegisterRecord(c, raw)).toEqual({
      status: "success",
      changed: true,
      credential: record,
    });
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
      "update_practice_credential",
      {
        p_practice_id: id,
        p_request_id: id,
        p_credential_id: id,
        p_expected_version: 1,
        p_expected_cycle_id: other,
        p_expected_date_revision: 1,
        p_title: "Policy",
        p_type: "malpractice_policy",
        p_owner_kind: "practice",
        p_owner_clinician_id: null,
        p_covered_clinician_ids: [id, other],
        p_issuer: "Insurer",
        p_jurisdiction: "CA",
        p_end_date: "2028-02-29",
        p_action_deadline: "2028-02-01",
      },
    );
    const a = client();
    expect(
      (
        await operations.changeRegisterRecord(a, {
          intent: "archive",
          requestId: id,
          id,
          expectedVersion: 1,
          expectedCycleId: other,
          expectedDateRevision: 1,
        })
      ).status,
    ).toBe("success");
    expect(a.rpc).toHaveBeenCalledExactlyOnceWith(
      "archive_practice_credential",
      {
        p_practice_id: id,
        p_request_id: id,
        p_credential_id: id,
        p_expected_version: 1,
        p_expected_cycle_id: other,
        p_expected_date_revision: 1,
      },
    );
  }
  const c = client();
  await operations.changeRegisterRecord(c, {
    ...raw,
    ownerKind: "clinician",
    ownerClinicianId: other,
    coveredClinicianIds: [],
  });
  expect(c.rpc).toHaveBeenCalledWith(
    "update_practice_credential",
    expect.objectContaining({ p_owner_clinician_id: other }),
  );
});
it("M08 authentication failures and current roles stop invalid payloads before writes", async () => {
  expect(operations.changeRegisterRecord).toBeDefined();
  for (const [auth, status] of [
    [{ data: { user: null }, error: null }, "auth-required"],
    [{ data: {}, error: { status: 401 } }, "auth-required"],
    [{ data: {}, error: { status: 503 } }, "unavailable"],
    [new Error("private"), "unavailable"],
  ] as const) {
    const c = client();
    if (auth instanceof Error)
      vi.mocked(c.auth.getUser).mockRejectedValue(auth);
    else vi.mocked(c.auth.getUser).mockResolvedValue(auth as never);
    expect(await operations.changeRegisterRecord(c, null)).toEqual({ status });
    expect(c.rpc).not.toHaveBeenCalled();
  }
  for (const current of [
    { status: "unavailable" },
    { status: "success", access: null },
    { status: "success", access: { role: "viewer" } },
  ]) {
    access.mockResolvedValue(current);
    const c = client();
    expect(await operations.changeRegisterRecord(c, null)).toEqual({
      status: current.status === "unavailable" ? "unavailable" : "forbidden",
    });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it("M11 invalid input and malformed replies never invent successful state", async () => {
  expect(operations.changeRegisterRecord).toBeDefined();
  const c = client();
  expect(
    await operations.changeRegisterRecord(c, { ...raw, actor: id }),
  ).toMatchObject({ status: "invalid", errors: expect.any(Object) });
  expect(c.rpc).not.toHaveBeenCalled();
  for (const data of [
    null,
    {},
    { status: "success" },
    { status: "success", changed: "yes", credential: record },
    {
      status: "success",
      changed: true,
      credential: { ...record, archived_at: undefined },
    },
    { status: "conflict" },
    { status: "conflict", credential: {} },
    {
      status: "success",
      changed: true,
      credential: {
        ...record,
        current_cycle: { ...record.current_cycle, id: "bad" },
      },
    },
    { status: "invalid", errors: { issuer: "SQL secret" } },
    { status: "invalid", errors: null },
  ])
    expect(await operations.changeRegisterRecord(client(data), raw)).toEqual({
      status: "unavailable",
    });
  for (const [code, status] of [
    ["42501", "forbidden"],
    ["XX000", "unavailable"],
  ])
    expect(
      await operations.changeRegisterRecord(client(null, { code }), raw),
    ).toEqual({ status });
  const thrown = client();
  vi.mocked(thrown.rpc).mockRejectedValue(new Error("private"));
  expect(await operations.changeRegisterRecord(thrown, raw)).toEqual({
    status: "unavailable",
  });
});
it("M04 M11 safe maintenance replies strip secrets and preserve every acknowledged outcome", async () => {
  expect(operations.changeRegisterRecord).toBeDefined();
  for (const status of [
    "invalid",
    "invalid-reference",
    "request-conflict",
    "archived",
    "not-found",
  ])
    expect(
      await operations.changeRegisterRecord(
        client({ status, private: "SQL" }),
        raw,
      ),
    ).toEqual({ status });
  for (const errors of [
    { issuer: "Use 1 to 120 characters." },
    { jurisdiction: "Use 1 to 120 characters." },
    { endDate: "Enter a valid date (YYYY-MM-DD)." },
    {
      actionDeadline: "The action deadline must be earlier than the end date.",
    },
    { actionDeadline: "Enter a valid date (YYYY-MM-DD)." },
  ])
    expect(
      await operations.changeRegisterRecord(
        client({ status: "invalid", errors }),
        raw,
      ),
    ).toEqual({ status: "invalid", errors });
  expect(
    await operations.changeRegisterRecord(
      client({
        status: "conflict",
        credential: { ...record, private: "SQL" },
        private: "SQL",
      }),
      raw,
    ),
  ).toEqual({ status: "conflict", credential: record });
  expect(
    await operations.changeRegisterRecord(
      client({
        status: "success",
        changed: false,
        credential: {
          ...record,
          archived_at: "2026-10-07T00:00:00+00:00",
          private: "SQL",
        },
      }),
      raw,
    ),
  ).toEqual({
    status: "success",
    changed: false,
    credential: { ...record, archived_at: "2026-10-07T00:00:00+00:00" },
  });
});
it("M10 M15 maintenance read requires coherent archive and duplicate data without private fields", async () => {
  expect(repository.getMaintenanceRegister).toBeDefined();
  const c = client({
    clinicians: [],
    credentials: [
      { ...record, suspected_duplicate_ids: [other], private: "SQL" },
    ],
    private: "SQL",
  });
  expect(await repository.getMaintenanceRegister(c, id, true)).toEqual({
    status: "success",
    register: {
      clinicians: [],
      credentials: [{ ...record, suspected_duplicate_ids: [other] }],
    },
  });
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
    "list_practice_register_with_maintenance",
    { p_practice_id: id, p_include_archived: true },
  );
  for (const patch of [
    { archived_at: undefined },
    { archived_at: "bad" },
    { suspected_duplicate_ids: undefined },
    { suspected_duplicate_ids: [id] },
    { suspected_duplicate_ids: [other, other] },
    { suspected_duplicate_ids: ["bad"] },
    { archived_at: "2026-10-07T00:00:00Z", suspected_duplicate_ids: [other] },
  ])
    expect(
      await repository.getMaintenanceRegister(
        client({
          clinicians: [],
          credentials: [{ ...record, suspected_duplicate_ids: [], ...patch }],
        }),
        id,
      ),
    ).toEqual({ status: "unavailable" });
  for (const [code, status] of [
    ["42501", "forbidden"],
    ["XX000", "unavailable"],
  ])
    expect(
      await repository.getMaintenanceRegister(client(null, { code }), id),
    ).toEqual({ status });
  const thrown = client();
  vi.mocked(thrown.rpc).mockRejectedValue(new Error("private"));
  expect(await repository.getMaintenanceRegister(thrown, id)).toEqual({
    status: "unavailable",
  });
});
it("M11 FormData rejects forged scalar structure and keeps exact tokens", () => {
  expect(messages.maintenanceFormInput).toBeDefined();
  const form = new FormData();
  for (const [key, value] of Object.entries(raw))
    if (Array.isArray(value)) value.forEach((v) => form.append(key, v));
    else form.set(key, String(value));
  expect(messages.maintenanceFormInput(form)).toEqual({
    ...raw,
    expectedVersion: "1",
    expectedDateRevision: "1",
  });
  form.set("$ACTION_test", "framework");
  expect(messages.maintenanceFormInput(form)).toEqual({
    ...raw,
    expectedVersion: "1",
    expectedDateRevision: "1",
  });
  form.append("expectedVersion", "2");
  expect(messages.maintenanceFormInput(form)).toBeNull();
  const file = new FormData();
  file.set("id", new File(["private"], "private"));
  expect(messages.maintenanceFormInput(file)).toBeNull();
});

it("M11 default reads stay active and default success feedback describes an edit", async () => {
  const c = client({ clinicians: [], credentials: [] });
  expect(await repository.getMaintenanceRegister(c, id)).toEqual({
    status: "success",
    register: { clinicians: [], credentials: [] },
  });
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
    "list_practice_register_with_maintenance",
    { p_practice_id: id, p_include_archived: false },
  );
  expect(messages.maintenanceMessage("success")).toBe("Changes saved.");
  const invalid = schema.maintenanceInputSchema.safeParse({
    ...raw,
    intent: "forged",
  });
  expect(invalid.success).toBe(false);
  if (!invalid.success)
    expect(invalid.error.issues[0].path).toEqual(["intent"]);
});
