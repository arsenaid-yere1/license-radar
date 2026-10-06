import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/practice/access", () => ({ getPracticeAccess: access }));
import { createRegisterRecord } from "@/lib/register/operations";
import { createRecord, getRegister } from "@/lib/register/repository";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
const raw = { intent: "clinician" as const, requestId: id, name: " Rivera " };
const clinician = { id, name: "Rivera", version: 1 };
function client(
  data: unknown = { status: "success", clinician },
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
it("G16 authenticated editors derive authority and bind canonical requests", async () => {
  for (const role of ["administrator", "manager"]) {
    access.mockResolvedValue({
      status: "success",
      access: { role, practice: { id } },
    });
    const c = client();
    expect(await createRegisterRecord(c, raw)).toEqual({
      status: "success",
      clinician,
    });
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith("create_practice_clinician", {
      p_practice_id: id,
      p_request_id: id,
      p_name: "Rivera",
    });
  }
  const credential = {
    id,
    title: "Policy",
    type: "malpractice_policy",
    owner_kind: "practice",
    owner_clinician_id: null,
    owner_name: "Practice",
    version: 1,
    covered_clinicians: [],
    issuer: null,
    jurisdiction: null,
    current_cycle: {
      id,
      cycle_number: 1,
      date_revision: 1,
      end_date: null,
      action_deadline: null,
    },
  };
  for (const ownerKind of ["practice", "clinician"] as const) {
    const c = client({
      status: "success",
      credential: {
        ...credential,
        owner_kind: ownerKind,
        owner_clinician_id: ownerKind === "clinician" ? id : null,
      },
    });
    expect(
      (
        await createRegisterRecord(c, {
          intent: "credential",
          requestId: id,
          title: " Policy ",
          type: "malpractice_policy",
          ownerKind,
          ...(ownerKind === "clinician" ? { ownerClinicianId: id } : {}),
        })
      ).status,
    ).toBe("success");
    expect(c.rpc).toHaveBeenCalledWith(
      "create_practice_credential_with_details",
      {
        p_practice_id: id,
        p_request_id: id,
        p_title: "Policy",
        p_type: "malpractice_policy",
        p_owner_kind: ownerKind,
        p_owner_clinician_id: ownerKind === "clinician" ? id : null,
        p_covered_clinician_ids: [],
        p_issuer: null,
        p_jurisdiction: null,
        p_end_date: null,
        p_action_deadline: null,
      },
    );
  }
});
it("G16 auth outage expiry and live role denial stop creates", async () => {
  for (const [auth, status] of [
    [{ data: { user: null }, error: null }, "auth-required"],
    [{ data: {}, error: { status: 401 } }, "auth-required"],
    [{ data: {}, error: { status: 503 } }, "unavailable"],
    [new Error("secret"), "unavailable"],
  ] as const) {
    const c = client();
    if (auth instanceof Error)
      vi.mocked(c.auth.getUser).mockRejectedValue(auth);
    else vi.mocked(c.auth.getUser).mockResolvedValue(auth as never);
    expect(await createRegisterRecord(c, raw)).toEqual({ status });
    expect(c.rpc).not.toHaveBeenCalled();
  }
  for (const result of [
    { status: "unavailable" },
    { status: "success", access: null },
    { status: "success", access: { role: "viewer" } },
  ]) {
    access.mockResolvedValue(result);
    const c = client();
    expect(await createRegisterRecord(c, raw)).toEqual({
      status: result.status === "unavailable" ? "unavailable" : "forbidden",
    });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it("G16 invalid and forged authority never reach persistence", async () => {
  for (const input of [
    null,
    {},
    { ...raw, name: " " },
    ...["practiceId", "actor", "role", "version"].map((key) => ({
      ...raw,
      [key]: id,
    })),
  ]) {
    const c = client();
    expect(await createRegisterRecord(c, input)).toMatchObject({
      status: "invalid",
      errors: expect.any(Object),
    });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it("G17 RPC boundary strips private data and rejects wrong success shapes", async () => {
  const c = client({
    clinicians: [{ ...clinician, private: "secret" }],
    credentials: [],
    secret: "private",
  });
  expect(await getRegister(c, id)).toEqual({
    status: "success",
    register: { clinicians: [clinician], credentials: [] },
  });
  expect(c.rpc).toHaveBeenCalledWith("list_practice_register", {
    p_practice_id: id,
  });
  expect(
    await createRecord(
      client({
        status: "success",
        clinician: { ...clinician, private: "secret" },
        secret: "private",
      }),
      id,
      { ...raw, name: "Rivera" },
    ),
  ).toEqual({ status: "success", clinician });
  for (const status of ["invalid", "invalid-reference", "request-conflict"])
    expect(
      await createRecord(client({ status, secret: "private" }), id, raw),
    ).toEqual({ status });
  for (const data of [
    null,
    {},
    { status: "success" },
    { status: "forbidden" },
    { status: "success", clinician: { ...clinician, version: 0 } },
    { status: "success", credential: {} },
    { clinicians: [], credentials: [], status: "success" },
  ])
    expect(await createRecord(client(data), id, raw)).toEqual({
      status: "unavailable",
    });
  for (const data of [
    null,
    {},
    { clinicians: [], credentials: [{}] },
    { clinicians: [{ ...clinician, version: 0 }], credentials: [] },
  ])
    expect(await getRegister(client(data), id)).toEqual({
      status: "unavailable",
    });
  for (const [code, status] of [
    ["42501", "forbidden"],
    ["XX000", "unavailable"],
  ]) {
    expect(await getRegister(client(null, { code }), id)).toEqual({ status });
    expect(await createRecord(client(null, { code }), id, raw)).toEqual({
      status,
    });
  }
  const thrown = client();
  vi.mocked(thrown.rpc).mockRejectedValue(new Error("private"));
  expect(await getRegister(thrown, id)).toEqual({ status: "unavailable" });
  expect(await createRecord(thrown, id, raw)).toEqual({
    status: "unavailable",
  });
});

it("D06 D14 binds all detailed values and allowlists database validation errors", async () => {
  const input = {
    intent: "credential" as const,
    requestId: id,
    title: "License",
    type: "state_license" as const,
    ownerKind: "practice" as const,
    coveredClinicianIds: [],
    issuer: " Board ",
    jurisdiction: " CA ",
    endDate: "2028-02-29",
    actionDeadline: "2028-02-01",
  };
  for (const errors of [
    { issuer: "Use 1 to 120 characters." },
    { jurisdiction: "Use 1 to 120 characters." },
    { endDate: "Enter a valid date (YYYY-MM-DD)." },
    { actionDeadline: "Enter a valid date (YYYY-MM-DD)." },
    {
      actionDeadline: "The action deadline must be earlier than the end date.",
    },
  ]) {
    const c = client({ status: "invalid", errors, secret: "private" });
    expect(await createRegisterRecord(c, input)).toEqual({
      status: "invalid",
      errors,
    });
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
      "create_practice_credential_with_details",
      {
        p_practice_id: id,
        p_request_id: id,
        p_title: "License",
        p_type: "state_license",
        p_owner_kind: "practice",
        p_owner_clinician_id: null,
        p_covered_clinician_ids: [],
        p_issuer: "Board",
        p_jurisdiction: "CA",
        p_end_date: "2028-02-29",
        p_action_deadline: "2028-02-01",
      },
    );
  }
  for (const errors of [
    { issuer: "SQL secret" },
    { jurisdiction: 1 },
    { endDate: "oops" },
    { actionDeadline: null },
    "private",
    null,
  ])
    expect(
      await createRegisterRecord(client({ status: "invalid", errors }), input),
    ).toEqual({ status: "unavailable" });
  expect(
    await createRegisterRecord(
      client({ status: "invalid", errors: { private: "SQL secret" } }),
      input,
    ),
  ).toEqual({ status: "invalid", errors: {} });
  const credential = {
    id,
    title: "License",
    type: "state_license",
    owner_kind: "practice",
    owner_clinician_id: null,
    owner_name: "Practice",
    version: 1,
    covered_clinicians: [],
    issuer: "Board",
    jurisdiction: "CA",
    current_cycle: {
      id,
      cycle_number: 1,
      date_revision: 1,
      end_date: "2028-02-29",
      action_deadline: "2028-02-01",
    },
  };
  expect(
    await createRegisterRecord(
      client({
        status: "success",
        credential: { ...credential, private: "SQL secret" },
      }),
      input,
    ),
  ).toEqual({ status: "success", credential });
  expect(
    await getRegister(
      client({ clinicians: [], credentials: [credential] }),
      id,
    ),
  ).toEqual({
    status: "success",
    register: { clinicians: [], credentials: [credential] },
  });
  for (const patch of [
    { current_cycle: undefined },
    { current_cycle: { ...credential.current_cycle, end_date: "infinity" } },
    { issuer: undefined },
  ]) {
    expect(
      await getRegister(
        client({ clinicians: [], credentials: [{ ...credential, ...patch }] }),
        id,
      ),
    ).toEqual({ status: "unavailable" });
    expect(
      await createRegisterRecord(
        client({ status: "success", credential: { ...credential, ...patch } }),
        input,
      ),
    ).toEqual({ status: "unavailable" });
  }
});
