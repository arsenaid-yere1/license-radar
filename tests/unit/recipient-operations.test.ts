import { expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/practice/access", () => ({ getPracticeAccess: access }));
import { saveRecipient } from "@/lib/recipients/operations";
import { getRecipient, setRecipient } from "@/lib/recipients/repository";
const id = "10000000-0000-4000-8000-000000000001";
const recipient = {
  version: 1,
  selected: null,
  readiness: "no-recipient",
  ready: false,
  canEdit: true,
  candidates: [],
};
const raw = { intent: "assign", membershipId: id, expectedVersion: 1 };
function client(
  data: unknown = { status: "success", recipient },
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
beforeEach(() => {
  access.mockReset().mockResolvedValue({
    status: "success",
    access: { role: "manager", practice: { id } },
  });
});
it("R15 verified editor derives practice and binds explicit assign/clear", async () => {
  for (const role of ["administrator", "manager"]) {
    access.mockResolvedValue({
      status: "success",
      access: { role, practice: { id } },
    });
    for (const input of [raw, { intent: "clear", expectedVersion: 7 }]) {
      const c = client();
      expect(await saveRecipient(c, input)).toEqual({
        status: "success",
        recipient,
      });
      expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
        "set_practice_reminder_recipient",
        {
          p_practice_id: id,
          p_membership_id: input.intent === "clear" ? null : id,
          p_expected_version: input.expectedVersion,
        },
      );
    }
  }
});
it("R15 auth expiry absence outage and access denial stop writes", async () => {
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
    expect(await saveRecipient(c, raw)).toEqual({ status });
    expect(c.rpc).not.toHaveBeenCalled();
  }
  for (const result of [
    { status: "unavailable" },
    { status: "success", access: null },
    { status: "success", access: { role: "viewer" } },
  ]) {
    access.mockResolvedValue(result);
    const c = client();
    expect(await saveRecipient(c, raw)).toEqual({
      status: result.status === "unavailable" ? "unavailable" : "forbidden",
    });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it("R13 invalid posted authority and missing assignment never reach RPC", async () => {
  for (const input of [
    null,
    {},
    { ...raw, membershipId: undefined },
    { ...raw, expectedVersion: 0 },
    ...["practiceId", "actor", "role", "ready"].map((key) => ({
      ...raw,
      [key]: "forged",
    })),
  ]) {
    const c = client();
    expect(await saveRecipient(c, input)).toMatchObject({
      status: "invalid",
      errors: expect.any(Object),
    });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it("R16 repository validates read/success strips private fields and preserves safe failures", async () => {
  const c = client({ ...recipient, secret: "private" });
  expect(await getRecipient(c, id)).toEqual({ status: "success", recipient });
  expect(c.rpc).toHaveBeenCalledWith("get_practice_reminder_recipient", {
    p_practice_id: id,
  });
  expect(
    await setRecipient(
      client({
        status: "success",
        recipient: { ...recipient, secret: "private" },
        token: "private",
      }),
      id,
      id,
      1,
    ),
  ).toEqual({ status: "success", recipient });
  for (const status of ["conflict", "invalid-recipient"])
    expect(
      await setRecipient(client({ status, secret: "private" }), id, null, 1),
    ).toEqual({ status });
  for (const data of [
    null,
    {},
    { status: "success" },
    { status: "success", recipient: { ...recipient, ready: true } },
    { status: "forbidden" },
  ])
    expect(await setRecipient(client(data), id, id, 1)).toEqual({
      status: "unavailable",
    });
  for (const data of [
    null,
    {},
    { ...recipient, version: 0 },
    { ...recipient, selected: null, readiness: "sms-setup-pending" },
  ])
    expect(await getRecipient(client(data), id)).toEqual({
      status: "unavailable",
    });
  for (const [code, status] of [
    ["42501", "forbidden"],
    ["XX000", "unavailable"],
  ])
    for (const read of [true, false])
      expect(
        await (read
          ? getRecipient(client(null, { code }), id)
          : setRecipient(client(null, { code }), id, null, 1)),
      ).toEqual({ status });
  const thrown = client();
  vi.mocked(thrown.rpc).mockRejectedValue(new Error("secret"));
  expect(await getRecipient(thrown, id)).toEqual({ status: "unavailable" });
  expect(await setRecipient(thrown, id, id, 1)).toEqual({
    status: "unavailable",
  });
});
