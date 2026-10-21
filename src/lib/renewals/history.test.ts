import { expect, it, vi } from "vitest";
import fc from "fast-check";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  historyCursor,
  renewalCycleSchema,
  renewalHistorySchema,
} from "./history";
import { getRenewalHistory } from "./repository";
import { renewalInputSchema, completionResultSchema } from "./schema";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  next = "bbbbbbbb-0000-4000-8000-000000000002";
const cycle = {
  id,
  cycleNumber: 1,
  dateRevision: 1,
  type: "malpractice_policy",
  endDate: null,
  actionDeadline: null,
  completedAt: null,
  successorId: null,
  progress: "not-started",
  acknowledgedAt: null,
};
const page = {
  status: "success",
  credentialId: id,
  title: "Policy",
  archivedAt: null,
  currentCycleId: id,
  cycles: [cycle],
  nextBeforeCycleNumber: null,
};
const raw = {
  intent: "complete",
  requestId: id,
  id,
  expectedVersion: "1",
  expectedCycleId: next,
  expectedDateRevision: "1",
  expectedRenewalVersion: "1",
  endDate: "2090-03-02",
  actionDeadline: "",
  confirmed: "true",
};
it("RC07 cursor validates exact bounded decimal and no implicit page", () => {
  expect(historyCursor(undefined)).toEqual({ valid: true, value: null });
  for (const s of ["1", "2", "2147483647"])
    expect(historyCursor(s)).toEqual({ valid: true, value: Number(s) });
  for (const s of [
    null,
    "",
    0,
    "01",
    "0",
    "-1",
    "1.5",
    "2147483648",
    "1\n",
    [],
    ["1"],
    true,
    " 1",
  ])
    expect(historyCursor(s)).toEqual({ valid: false });
});
it("RC07 cycle and history contracts reject incoherent private fabricated pages", () => {
  expect(renewalHistorySchema.parse({ ...page, actor: id })).toEqual(page);
  expect(renewalCycleSchema.parse({ ...cycle, private: "secret" })).toEqual(
    cycle,
  );
  for (const patch of [
    { cycles: [{ ...cycle, cycleNumber: 0 }] },
    { cycles: [{ ...cycle, endDate: "1900-02-29" }] },
    {
      cycles: [
        { ...cycle, endDate: "2030-01-01", actionDeadline: "2030-01-01" },
      ],
    },
    { cycles: [{ ...cycle, successorId: next }] },
    {
      cycles: [
        { ...cycle, completedAt: "2030-01-01T00:00:00Z", successorId: id },
      ],
    },
    { cycles: [cycle, cycle] },
    { cycles: [cycle, { ...cycle, id: next, cycleNumber: 2 }] },
    { nextBeforeCycleNumber: 1 },
    { title: "" },
    { title: "x".repeat(241) },
    { cycles: Array(21).fill(cycle) },
  ])
    expect(renewalHistorySchema.safeParse({ ...page, ...patch }).success).toBe(
      false,
    );
  const many = Array.from({ length: 20 }, (_, i) => ({
    ...cycle,
    id: `aaaaaaaa-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    cycleNumber: 20 - i,
  }));
  expect(
    renewalHistorySchema.safeParse({
      ...page,
      cycles: many,
      nextBeforeCycleNumber: 1,
      title: "x".repeat(240),
    }).success,
  ).toBe(true);
  expect(
    renewalHistorySchema.safeParse({
      ...page,
      cycles: many,
      nextBeforeCycleNumber: 2,
    }).success,
  ).toBe(false);
  expect(
    renewalCycleSchema.parse({
      ...cycle,
      completedAt: "2030-01-01T00:00:00Z",
      successorId: next,
    }),
  ).toMatchObject({ successorId: next });
});
it("RC07 read binds tenant credential cursor and sanitizes failures", async () => {
  for (const [data, error, want] of [
    [page, null, page],
    [{ status: "not-found", actor: id }, null, { status: "not-found" }],
    [{ status: "invalid" }, null, { status: "invalid" }],
    [{}, null, { status: "unavailable" }],
    [null, { code: "42501" }, { status: "forbidden" }],
    [null, { code: "XX000" }, { status: "unavailable" }],
  ] as const) {
    const rpc = vi.fn().mockResolvedValue({ data, error }),
      client = { rpc } as unknown as SupabaseClient;
    expect(await getRenewalHistory(client, id, id)).toEqual(want);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_credential_renewal_history",
      { p_practice_id: id, p_credential_id: id, p_before_cycle_number: null },
    );
  }
  const rpc = vi.fn().mockRejectedValue(new Error("private"));
  expect(
    await getRenewalHistory({ rpc } as unknown as SupabaseClient, id, next, 3),
  ).toEqual({ status: "unavailable" });
  expect(rpc).toHaveBeenCalledWith("get_credential_renewal_history", {
    p_practice_id: id,
    p_credential_id: next,
    p_before_cycle_number: 3,
  });
});
it("RC01 RC04 property exact dates positive successor numbers and explicit confirmation", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 2147483647 }),
      fc.integer({ min: 1, max: 9999 }),
      (n, year) => {
        const endDate = `${String(year).padStart(4, "0")}-12-31`,
          actionDeadline = `${String(year).padStart(4, "0")}-01-01`;
        expect(
          renewalCycleSchema.parse({ ...cycle, cycleNumber: n }).cycleNumber,
        ).toBe(n);
        expect(historyCursor(String(n))).toEqual({ valid: true, value: n });
        expect(
          renewalInputSchema.parse({ ...raw, endDate, actionDeadline }),
        ).toMatchObject({ endDate, actionDeadline, confirmed: true });
        expect(
          renewalInputSchema.safeParse({
            ...raw,
            endDate,
            actionDeadline: endDate,
          }).success,
        ).toBe(false);
        expect(
          renewalInputSchema.safeParse({ ...raw, confirmed: "false" }).success,
        ).toBe(false);
      },
    ),
    { seed: 20261013, numRuns: 1000 },
  );
  for (const field of [
    "actor",
    "completedAt",
    "successorId",
    "cycleNumber",
    "namespace",
  ])
    expect(renewalInputSchema.safeParse({ ...raw, [field]: id }).success).toBe(
      false,
    );
  for (const patch of [
    { endDate: null },
    { endDate: "" },
    { endDate: "1900-02-29" },
    { actionDeadline: 3 },
    { confirmed: undefined },
    { confirmed: true, endDate: "0000-01-01" },
  ])
    expect(renewalInputSchema.safeParse({ ...raw, ...patch }).success).toBe(
      false,
    );
  expect(
    renewalInputSchema.parse({ ...raw, confirmed: true, actionDeadline: null }),
  ).toMatchObject({ confirmed: true, actionDeadline: null });
  expect(
    completionResultSchema.parse({
      status: "invalid",
      errors: {
        endDate: "Enter an end date after today in the practice timezone.",
      },
    }),
  ).toMatchObject({ status: "invalid" });
});

it("RC07 a fabricated reply cannot change the requested credential", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: page, error: null });
  expect(
    await getRenewalHistory({ rpc } as unknown as SupabaseClient, id, next),
  ).toEqual({ status: "unavailable" });
});
it("RC01 RC07 exact public errors offset times ordered dates and distinct history identities", () => {
  const stamp = "2030-01-01T10:00:00+05:30";
  expect(
    renewalCycleSchema.parse({
      ...cycle,
      endDate: "2031-03-02",
      actionDeadline: "2031-02-01",
      completedAt: stamp,
      successorId: next,
      acknowledgedAt: stamp,
    }),
  ).toMatchObject({ completedAt: stamp, acknowledgedAt: stamp });
  expect(
    renewalHistorySchema.parse({ ...page, archivedAt: stamp }),
  ).toMatchObject({ archivedAt: stamp });
  expect(
    renewalHistorySchema.safeParse({
      ...page,
      cycles: [
        { ...cycle, cycleNumber: 2 },
        { ...cycle, id: next, cycleNumber: 2 },
      ],
    }).success,
  ).toBe(false);
  expect(
    renewalHistorySchema.safeParse({
      ...page,
      cycles: [{ ...cycle, cycleNumber: 2 }, cycle],
    }).success,
  ).toBe(false);
  for (const [field, value, message] of [
    ["endDate", "1900-02-29", "Enter a valid date (YYYY-MM-DD)."],
    [
      "actionDeadline",
      "2090-03-02",
      "The action deadline must be earlier than the end date.",
    ],
  ]) {
    const parsed = renewalInputSchema.safeParse({ ...raw, [field]: value });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: [field], message }),
      );
  }
  for (const [field, values] of Object.entries({
    endDate: [
      "Enter a valid date (YYYY-MM-DD).",
      "Enter an end date after today in the practice timezone.",
    ],
    actionDeadline: [
      "Enter a valid date (YYYY-MM-DD).",
      "Enter an action deadline after today in the practice timezone.",
      "The action deadline must be earlier than the end date.",
    ],
  }))
    for (const value of values)
      expect(
        completionResultSchema.parse({
          status: "invalid",
          errors: { [field]: value },
        }),
      ).toEqual({ status: "invalid", errors: { [field]: value } });
  for (const field of ["endDate", "actionDeadline"])
    expect(
      completionResultSchema.safeParse({
        status: "invalid",
        errors: { [field]: "private SQL error" },
      }).success,
    ).toBe(false);
});
it("RC03 completion replies require actual successor and consecutive cycle number", () => {
  const completedCycle = {
    ...cycle,
    endDate: "2028-02-29",
    completedAt: "2030-01-01T10:00:00+05:30",
    successorId: next,
  };
  const credential = {
    id,
    title: "Policy",
    type: "malpractice_policy",
    owner_kind: "practice",
    owner_clinician_id: null,
    owner_name: "Practice",
    version: 2,
    covered_clinicians: [],
    issuer: null,
    jurisdiction: null,
    archived_at: null,
    current_cycle: {
      id: next,
      cycle_number: 2,
      date_revision: 1,
      end_date: "2090-03-02",
      action_deadline: null,
    },
    renewal: {
      link: { url: null, version: 1 },
      workflow: {
        cycleId: next,
        status: "not-started",
        version: 1,
        acknowledgedAt: null,
      },
    },
  };
  const reply = {
    status: "success",
    changed: true,
    completedCycle,
    credential,
  };
  expect(completionResultSchema.parse(reply)).toEqual(reply);
  expect(
    completionResultSchema.parse({ status: "conflict", credential }),
  ).toEqual({ status: "conflict", credential });
  for (const patch of [
    { completedCycle: { ...completedCycle, successorId: id } },
    { completedCycle: { ...completedCycle, successorId: null } },
    { completedCycle: { ...completedCycle, cycleNumber: 2 } },
    { completedCycle: { ...completedCycle, id: next } },
    { completedCycle: { ...completedCycle, completedAt: null } },
  ])
    expect(
      completionResultSchema.safeParse({ ...reply, ...patch }).success,
    ).toBe(false);
});
it("RC04 legacy success and conflict result discriminants remain distinct", async () => {
  const { renewalResultSchema } = await import("./schema");
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
    archived_at: null,
    current_cycle: {
      id: next,
      cycle_number: 1,
      date_revision: 1,
      end_date: null,
      action_deadline: null,
    },
    renewal: {
      link: { url: null, version: 1 },
      workflow: {
        cycleId: next,
        status: "not-started",
        version: 1,
        acknowledgedAt: null,
      },
    },
  };
  for (const status of ["success", "conflict"]) {
    const data = {
      status,
      ...(status === "success" ? { changed: true } : {}),
      credential,
    };
    expect(renewalResultSchema.parse(data)).toEqual(data);
  }
});
it("RC01 RC03 property suite covers blank deadlines every terminal status and rejects missing result fields", async () => {
  vi.resetModules();
  const { completionResultSchema, renewalInputSchema } =
    await import("./schema");
  expect(renewalInputSchema.parse(raw)).toMatchObject({
    actionDeadline: null,
    confirmed: true,
  });
  const credential = {
    id,
    title: "Policy",
    type: "malpractice_policy",
    owner_kind: "practice",
    owner_clinician_id: null,
    owner_name: "Practice",
    version: 2,
    covered_clinicians: [],
    issuer: null,
    jurisdiction: null,
    archived_at: null,
    current_cycle: {
      id: next,
      cycle_number: 2,
      date_revision: 1,
      end_date: "2090-03-02",
      action_deadline: null,
    },
    renewal: {
      link: { url: null, version: 1 },
      workflow: {
        cycleId: next,
        status: "not-started",
        version: 1,
        acknowledgedAt: null,
      },
    },
  };
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2147483647 }), (version) => {
      const reply = {
        status: "conflict",
        credential: { ...credential, version },
      };
      expect(completionResultSchema.parse(reply)).toEqual(reply);
    }),
    { seed: 20261013, numRuns: 100 },
  );
  fc.assert(
    fc.property(
      fc.constantFrom("request-conflict", "archived", "completed", "not-found"),
      (status) => {
        expect(
          completionResultSchema.parse({ status, private: "secret" }),
        ).toEqual({ status });
      },
    ),
    { seed: 20261013, numRuns: 100 },
  );
  expect(completionResultSchema.safeParse({ status: "invented" }).success).toBe(
    false,
  );
  expect(completionResultSchema.safeParse({}).success).toBe(false);
  expect(completionResultSchema.safeParse({ status: "conflict" }).success).toBe(
    false,
  );
  expect(
    completionResultSchema.safeParse({
      status: "invalid",
      errors: { actor: "private" },
    }).success,
  ).toBe(false);
  expect(completionResultSchema.parse({ status: "invalid" })).toEqual({
    status: "invalid",
  });
  fc.assert(
    fc.property(
      fc.constantFrom(
        { endDate: "Enter a valid date (YYYY-MM-DD)." },
        { endDate: "Enter an end date after today in the practice timezone." },
        { actionDeadline: "Enter a valid date (YYYY-MM-DD)." },
        {
          actionDeadline:
            "Enter an action deadline after today in the practice timezone.",
        },
        {
          actionDeadline:
            "The action deadline must be earlier than the end date.",
        },
      ),
      (errors) => {
        expect(
          completionResultSchema.parse({ status: "invalid", errors }),
        ).toEqual({
          status: "invalid",
          errors,
        });
      },
    ),
    { seed: 20261013, numRuns: 100 },
  );
});
