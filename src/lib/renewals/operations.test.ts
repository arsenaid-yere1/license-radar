import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/practice/access", () => ({ getPracticeAccess: access }));
import { changeRenewal } from "./operations";
import { getRenewalRegister, saveRenewal } from "./repository";
import { renewalFormInput, renewalMessage } from "./messages";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  cycle = "bbbbbbbb-0000-4000-8000-000000000002";
const tokens = {
  requestId: id,
  id,
  expectedVersion: 1,
  expectedCycleId: cycle,
  expectedDateRevision: 1,
  expectedRenewalVersion: 1,
};
const renewal = {
  link: { url: null, version: 1 },
  workflow: {
    cycleId: cycle,
    status: "not-started",
    version: 1,
    acknowledgedAt: null,
  },
};
const record = {
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
    id: cycle,
    cycle_number: 1,
    date_revision: 1,
    end_date: "2028-02-29",
    action_deadline: null,
  },
  archived_at: null,
  renewal,
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
it("RW05 RW06 authority and exact scalar RPC binding for all three intents", async () => {
  for (const role of ["administrator", "manager"]) {
    access.mockResolvedValue({
      status: "success",
      access: { role, practice: { id } },
    });
    for (const intent of ["link", "progress", "review"]) {
      const c = client();
      const input = {
        ...tokens,
        intent,
        ...(intent === "link"
          ? { url: " HTTPS://Board.example.test " }
          : intent === "progress"
            ? { progress: "in-progress" }
            : {}),
      };
      expect(await changeRenewal(c, input, id)).toEqual({
        status: "success",
        changed: true,
        credential: record,
      });
      expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
        intent === "link"
          ? "set_credential_renewal_link"
          : intent === "progress"
            ? "set_credential_renewal_progress"
            : "acknowledge_credential_renewal",
        {
          p_practice_id: id,
          p_request_id: id,
          p_credential_id: id,
          p_expected_version: 1,
          p_expected_cycle_id: cycle,
          p_expected_date_revision: 1,
          p_expected_renewal_version: 1,
          ...(intent === "link"
            ? { p_url: "https://Board.example.test" }
            : intent === "progress"
              ? { p_status: "in-progress" }
              : {}),
        },
      );
    }
  }
});
it("RW05 auth transport and role failures stop mutation before validation", async () => {
  for (const [auth, status] of [
    [{ data: { user: null }, error: null }, "auth-required"],
    [{ data: {}, error: { status: 401 } }, "auth-required"],
    [{ data: {}, error: { status: 403 } }, "auth-required"],
    [{ data: {}, error: { status: 503 } }, "unavailable"],
    [new Error("secret"), "unavailable"],
  ] as const) {
    const c = client();
    if (auth instanceof Error)
      vi.mocked(c.auth.getUser).mockRejectedValue(auth);
    else vi.mocked(c.auth.getUser).mockResolvedValue(auth as never);
    expect(await changeRenewal(c, null, id)).toEqual({ status });
    expect(c.rpc).not.toHaveBeenCalled();
  }
  for (const a of [
    { status: "unavailable" },
    { status: "success", access: null },
    { status: "success", access: { role: "viewer" } },
  ]) {
    access.mockResolvedValue(a);
    const c = client();
    expect(await changeRenewal(c, null, id)).toEqual({
      status: a.status === "unavailable" ? "unavailable" : "forbidden",
    });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it("RW05 route binding forged payloads and malformed replies fail closed", async () => {
  const raw = { ...tokens, intent: "review" };
  const c = client();
  expect(await changeRenewal(c, raw, cycle)).toEqual({
    status: "invalid",
    errors: { id: "This record is unavailable. Reload the register." },
  });
  expect(c.rpc).not.toHaveBeenCalled();
  expect(await changeRenewal(c, { ...raw, actor: id }, id)).toMatchObject({
    status: "invalid",
    errors: expect.any(Object),
  });
  expect(c.rpc).not.toHaveBeenCalled();
  for (const data of [
    null,
    {},
    { status: "success" },
    { status: "success", changed: "yes", credential: record },
    { status: "conflict" },
    {
      status: "success",
      changed: true,
      credential: { ...record, renewal: undefined },
    },
    {
      status: "success",
      changed: true,
      credential: {
        ...record,
        renewal: { ...renewal, workflow: { ...renewal.workflow, cycleId: id } },
      },
    },
    { status: "invalid", errors: { url: "SQL secret" } },
    { status: "invalid", errors: { actor: "secret" } },
  ])
    expect(await changeRenewal(client(data), raw, id)).toEqual({
      status: "unavailable",
    });
  for (const [code, status] of [
    ["42501", "forbidden"],
    ["XX000", "unavailable"],
  ])
    expect(await changeRenewal(client(null, { code }), raw, id)).toEqual({
      status,
    });
  const thrown = client();
  vi.mocked(thrown.rpc).mockRejectedValue(new Error("secret"));
  expect(await changeRenewal(thrown, raw, id)).toEqual({
    status: "unavailable",
  });
});
it("RW06 safe exact outcomes and read requirements exclude private state", async () => {
  const raw = { ...tokens, intent: "review" };
  for (const status of [
    "invalid",
    "request-conflict",
    "archived",
    "completed",
    "not-found",
  ])
    expect(
      await changeRenewal(client({ status, private: "secret" }), raw, id),
    ).toEqual({ status });
  for (const status of ["success", "conflict"]) {
    const data = {
      status,
      ...(status === "success" ? { changed: false } : {}),
      credential: { ...record, private: "secret" },
    };
    expect(await changeRenewal(client(data), raw, id)).toEqual({
      ...data,
      credential: record,
    });
  }
  for (const errors of [
    { url: "Enter a valid HTTPS renewal link (up to 2,048 characters)." },
    { progress: "Choose a renewal progress status." },
  ])
    expect(
      await changeRenewal(client({ status: "invalid", errors }), raw, id),
    ).toEqual({ status: "invalid", errors });
  const data = {
      clinicians: [],
      credentials: [{ ...record, suspected_duplicate_ids: [] }],
    },
    c = client(data);
  expect(await getRenewalRegister(c, id, true)).toEqual({
    status: "success",
    register: data,
  });
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
    "list_practice_register_with_renewal",
    { p_practice_id: id, p_include_archived: true },
  );
  const empty = client({ clinicians: [], credentials: [] });
  expect(await getRenewalRegister(empty, id)).toEqual({
    status: "success",
    register: { clinicians: [], credentials: [] },
  });
  expect(empty.rpc).toHaveBeenCalledExactlyOnceWith(
    "list_practice_register_with_renewal",
    { p_practice_id: id, p_include_archived: false },
  );
  expect(
    await getRenewalRegister(
      client({ clinicians: [], credentials: [record] }),
      id,
    ),
  ).toEqual({ status: "unavailable" });
  for (const [code, status] of [
    ["42501", "forbidden"],
    ["XX000", "unavailable"],
  ])
    expect(await getRenewalRegister(client(null, { code }), id)).toEqual({
      status,
    });
  const broken = client();
  vi.mocked(broken.rpc).mockRejectedValue(new Error("secret"));
  expect(await getRenewalRegister(broken, id)).toEqual({
    status: "unavailable",
  });
  expect(
    await saveRenewal(client(), id, { ...tokens, intent: "review" }),
  ).toEqual({ status: "success", changed: true, credential: record });
});
it("RW07 strict scalar FormData and every safe feedback outcome", () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...tokens, intent: "review" }))
    f.set(k, String(v));
  f.set("$ACTION_test", "framework");
  expect(renewalFormInput(f)).toEqual({
    ...tokens,
    intent: "review",
    expectedVersion: "1",
    expectedDateRevision: "1",
    expectedRenewalVersion: "1",
  });
  f.append("id", cycle);
  expect(renewalFormInput(f)).toBeNull();
  const file = new FormData();
  file.set("url", new File(["private"], "private.txt"));
  expect(renewalFormInput(file)).toBeNull();
  expect(renewalFormInput(new FormData())).toEqual({});
  const messages = {
    invalid: "Check the highlighted fields.",
    conflict: "This record changed. Compare your draft with the saved values.",
    "request-conflict":
      "This save request was already used. Reload and review the saved record.",
    archived:
      "This record is archived. Reload the register to review its history.",
    completed: "This renewal cycle is completed. Reload the record.",
    "not-found": "This record is unavailable. Reload the register.",
    forbidden: "You do not have permission to change renewal progress.",
    unavailable:
      "We could not confirm this save. Retry this save before leaving this page.",
  };
  for (const [status, message] of Object.entries(messages))
    expect(renewalMessage(status)).toBe(message);
  for (const [intent, message] of [
    ["link", "Renewal link saved."],
    ["progress", "Renewal progress saved."],
    ["review", "Review acknowledged."],
  ])
    expect(renewalMessage("success", intent)).toBe(message);
  expect(renewalMessage("idle")).toBe(messages.unavailable);
});
it("RC01 RC03 completion binds exact confirmed new dates and immutable predecessor reply", async () => {
  const completedCycle = {
    id: cycle,
    cycleNumber: 1,
    dateRevision: 1,
    type: "malpractice_policy",
    endDate: "2028-02-29",
    actionDeadline: null,
    completedAt: "2030-01-01T10:00:00+00:00",
    successorId: id,
    progress: "not-started",
    acknowledgedAt: null,
  };
  const credential = {
    ...record,
    version: 2,
    current_cycle: {
      ...record.current_cycle,
      id,
      cycle_number: 2,
      end_date: "2090-03-02",
    },
    renewal: { ...renewal, workflow: { ...renewal.workflow, cycleId: id } },
  };
  const data = { status: "success", changed: true, completedCycle, credential },
    c = client(data),
    input = {
      ...tokens,
      intent: "complete",
      endDate: "2090-03-02",
      actionDeadline: "",
      confirmed: "true",
    };
  expect(await changeRenewal(c, input, id)).toEqual(data);
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith("complete_credential_renewal", {
    p_practice_id: id,
    p_request_id: id,
    p_credential_id: id,
    p_expected_version: 1,
    p_expected_cycle_id: cycle,
    p_expected_date_revision: 1,
    p_expected_renewal_version: 1,
    p_end_date: "2090-03-02",
    p_action_deadline: null,
    p_confirmed: true,
  });
  for (const patch of [
    { confirmed: false },
    { confirmed: "false" },
    { endDate: "" },
    { endDate: "1900-02-29" },
    { actionDeadline: "2090-03-02" },
    { actor: id },
    { successorId: id },
  ])
    expect(
      await changeRenewal(client(data), { ...input, ...patch }, id),
    ).toMatchObject({ status: "invalid" });
  for (const reply of [
    { ...data, completedCycle: undefined },
    { ...data, completedCycle: { ...completedCycle, successorId: cycle } },
    { ...data, credential: record },
  ])
    expect(await changeRenewal(client(reply), input, id)).toEqual({
      status: "unavailable",
    });
  expect(renewalMessage("success", "complete")).toBe(
    "Renewal confirmed. New dates saved.",
  );
});
