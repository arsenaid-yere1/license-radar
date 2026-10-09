import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/practice/access", () => ({ getPracticeAccess: access }));
import { saveEmailPreference } from "./operations";
import { getReminderSchedule, setEmailPreference } from "./repository";
const id = "10000000-0000-4000-8000-000000000001",
  preference = { enabled: false, version: 2, canEnable: false },
  input = { requestId: id, enabled: false, expectedVersion: 1 };
function client(
  data: unknown = { status: "success", preference },
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
    access: { role: "viewer", practice: { id } },
  }),
);
it("EP01 viewers can disable their own emails, but cannot enable; practice authority is derived", async () => {
  const c = client();
  expect(await saveEmailPreference(c, input)).toEqual({
    status: "success",
    preference,
  });
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith(
    "set_my_email_reminder_preference",
    {
      p_practice_id: id,
      p_request_id: id,
      p_enabled: false,
      p_expected_version: 1,
    },
  );
  const denied = client();
  expect(
    await saveEmailPreference(denied, { ...input, enabled: true }),
  ).toEqual({ status: "forbidden" });
  expect(denied.rpc).not.toHaveBeenCalled();
  for (const role of ["manager", "administrator"]) {
    access.mockResolvedValue({
      status: "success",
      access: { role, practice: { id } },
    });
    expect(
      (await saveEmailPreference(client(), { ...input, enabled: true })).status,
    ).toBe("success");
  }
});
it("EP02 posted authority, invalid versions and absent authentication cannot write", async () => {
  for (const raw of [
    null,
    {},
    { ...input, practiceId: id },
    { ...input, actor: id },
    { ...input, expectedVersion: 0 },
    { ...input, enabled: "false" },
  ]) {
    const c = client();
    expect((await saveEmailPreference(c, raw)).status).toBe("invalid");
    expect(c.rpc).not.toHaveBeenCalled();
  }
  for (const [error, user, status] of [
    [null, null, "auth-required"],
    [{ status: 401 }, null, "auth-required"],
    [{ status: 503 }, null, "unavailable"],
  ] as const) {
    const c = client();
    vi.mocked(c.auth.getUser).mockResolvedValue({
      data: { user },
      error,
    } as never);
    expect((await saveEmailPreference(c, input)).status).toBe(status);
    expect(c.rpc).not.toHaveBeenCalled();
  }
  const c = client();
  vi.mocked(c.auth.getUser).mockRejectedValue(new Error("private"));
  expect((await saveEmailPreference(c, input)).status).toBe("unavailable");
  access.mockResolvedValue({ status: "success", access: null });
  expect((await saveEmailPreference(client(), input)).status).toBe("forbidden");
  access.mockResolvedValue({ status: "unavailable" });
  expect((await saveEmailPreference(client(), input)).status).toBe(
    "unavailable",
  );
});
it("EP03 malformed/private responses fail closed, expected stale conflicts remain visible", async () => {
  for (const status of ["invalid", "conflict", "request-conflict"])
    expect(await setEmailPreference(client({ status }), id, input)).toEqual({
      status,
    });
  for (const data of [
    null,
    {},
    { status: "success", preference: { ...preference, version: 0 } },
    { status: "success", preference, payload: "private" },
  ])
    expect((await setEmailPreference(client(data), id, input)).status).toBe(
      "unavailable",
    );
  expect(
    (await setEmailPreference(client(null, { code: "42501" }), id, input))
      .status,
  ).toBe("forbidden");
  expect(
    (await setEmailPreference(client(null, { code: "XX000" }), id, input))
      .status,
  ).toBe("unavailable");
  const broken = client();
  vi.mocked(broken.rpc).mockRejectedValue(new Error("private"));
  expect((await setEmailPreference(broken, id, input)).status).toBe(
    "unavailable",
  );
  const schedule = {
    rows: [],
    nextCursor: null,
    emailReadiness: "ready",
    smsOptional: true,
    lastSuccessAt: null,
    oldestDueAt: null,
    preference,
  };
  const c = client(schedule);
  expect(await getReminderSchedule(c, id, "configured", id)).toEqual({
    status: "success",
    schedule,
  });
  expect(c.rpc).toHaveBeenCalledWith("get_email_reminder_schedule_v2", {
    p_practice_id: id,
    p_namespace: "configured",
    p_after: id,
  });
  for (const data of [
    null,
    { ...schedule, payload: "private" },
    { ...schedule, smsOptional: false },
  ])
    expect(
      (await getReminderSchedule(client(data), id, "configured")).status,
    ).toBe("unavailable");
  expect((await getReminderSchedule(broken, id, "configured")).status).toBe(
    "unavailable",
  );
});
