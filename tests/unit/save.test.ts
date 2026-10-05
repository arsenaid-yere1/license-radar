import { it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { savePractice } from "@/lib/practice/save";
function boundary(user: unknown, read: unknown, write: unknown) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValueOnce(read)
    .mockResolvedValueOnce(write);
  const chain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  };
  for (const fn of [chain.select, chain.insert, chain.update, chain.eq])
    fn.mockReturnValue(chain);
  return {
    auth: { getUser: vi.fn().mockResolvedValue(user) },
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockImplementation(() => maybeSingle()),
  } as unknown as SupabaseClient;
}
const row = { id: "own-id", name: "Cedar", timezone: "UTC", version: 1 };
const verified = { data: { user: { id: "owner" } }, error: null };
it("S26 expired session cannot mutate", async () => {
  const c = boundary(
    { data: { user: null }, error: { status: 401 } },
    null,
    null,
  );
  expect(
    await savePractice(c, { name: "Changed", timezone: "UTC" }, false),
  ).toEqual({ status: "auth-required" });
  expect(c.from).not.toHaveBeenCalled();
});
it("S12 hostile identity is rejected", async () => {
  const c = boundary(verified, null, null);
  expect(
    (
      await savePractice(
        c,
        { name: "Cedar", timezone: "UTC", owner_user_id: "victim" },
        false,
      )
    ).status,
  ).toBe("invalid");
  expect(c.from).not.toHaveBeenCalled();
});
it("S24 auth outage retains unavailable instead of logout", async () =>
  expect(
    await savePractice(
      boundary({ data: { user: null }, error: { status: 503 } }, null, null),
      {},
      false,
    ),
  ).toEqual({ status: "unavailable" }));
it("S24 thrown auth transport failure", async () => {
  const c = {
    auth: { getUser: vi.fn().mockRejectedValue(new Error("secret")) },
  } as unknown as SupabaseClient;
  expect(await savePractice(c, {}, false)).toEqual({ status: "unavailable" });
});
it("S21 owns server-derived update id", async () => {
  const c = boundary(
    verified,
    { data: row, error: null },
    { data: { ...row, version: 2 }, error: null },
  );
  expect(
    await savePractice(
      c,
      { name: "Updated", timezone: "UTC", expectedVersion: 1 },
      true,
    ),
  ).toMatchObject({ status: "success", practice: { version: 2 } });
});
it("S22 absent practice is conflict", async () =>
  expect(
    await savePractice(
      boundary(verified, { data: null, error: null }, null),
      { name: "Updated", timezone: "UTC", expectedVersion: 1 },
      true,
    ),
  ).toEqual({ status: "conflict" }));
it("S24 read error cannot fabricate update", async () =>
  expect(
    await savePractice(
      boundary(verified, { data: null, error: { code: "network" } }, null),
      { name: "Updated", timezone: "UTC", expectedVersion: 1 },
      true,
    ),
  ).toEqual({ status: "unavailable" }));
it("S08 create uses validated trimmed inputs", async () =>
  expect(
    await savePractice(
      boundary(verified, { data: row, error: null }, null),
      { name: " Cedar ", timezone: "UTC" },
      false,
    ),
  ).toMatchObject({ status: "success", practice: { name: "Cedar" } }));

it("S24 HTTP 500 is unavailable rather than authentication required", async () =>
  expect(
    await savePractice(
      boundary({ data: { user: null }, error: { status: 500 } }, null, null),
      {},
      false,
    ),
  ).toEqual({ status: "unavailable" }));

it("S24 SDK transport status zero is unavailable rather than authentication failure", async () =>
  expect(
    await savePractice(
      boundary({ data: { user: null }, error: { status: 0 } }, null, null),
      {},
      false,
    ),
  ).toEqual({ status: "unavailable" }));
