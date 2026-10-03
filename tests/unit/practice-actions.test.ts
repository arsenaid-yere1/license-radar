import { it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPractice,
  getCurrentPractice,
  updatePractice,
} from "@/lib/practice/repository";
const row = {
  id: "practice",
  owner_user_id: "owner",
  name: "Cedar",
  timezone: "UTC",
  version: 1,
  created_at: "date",
  updated_at: "date",
};
function boundary(results: unknown[]) {
  const maybeSingle = vi.fn();
  for (const r of results) maybeSingle.mockResolvedValueOnce(r);
  const chain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  };
  for (const method of [chain.select, chain.insert, chain.update, chain.eq])
    method.mockReturnValue(chain);
  return {
    client: {
      from: vi.fn().mockReturnValue(chain),
    } as unknown as SupabaseClient,
    chain,
  };
}
it("S16 reads own saved row and handles absent row", async () => {
  for (const data of [row, null]) {
    const { client } = boundary([{ data, error: null }]);
    expect(await getCurrentPractice(client)).toEqual({
      status: "success",
      practice: data,
    });
  }
});
it("S19 existing profile resolves only owner unique constraint", async () => {
  const { client } = boundary([
    {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key violates unique constraint "practices_owner_user_id_key"',
      },
    },
    { data: row, error: null },
  ]);
  expect(
    await createPractice(client, { name: "Different", timezone: "UTC" }),
  ).toEqual({ status: "success", practice: row });
});
it("S08 inserts only editable fields", async () => {
  const { client, chain } = boundary([{ data: row, error: null }]);
  expect(
    await createPractice(client, { name: "Cedar", timezone: "UTC" }),
  ).toEqual({ status: "success", practice: row });
  expect(chain.insert).toHaveBeenCalledWith({ name: "Cedar", timezone: "UTC" });
});
it("S21 version checked update", async () => {
  const { client, chain } = boundary([
    { data: { ...row, version: 2 }, error: null },
  ]);
  expect(
    await updatePractice(client, row.id, {
      name: "Updated",
      timezone: "UTC",
      expectedVersion: 1,
    }),
  ).toEqual({ status: "success", practice: { ...row, version: 2 } });
  expect(chain.eq.mock.calls).toEqual([
    ["id", row.id],
    ["version", 1],
  ]);
  expect(chain.update).toHaveBeenCalledWith({
    name: "Updated",
    timezone: "UTC",
  });
});
it("S22 stale version returns conflict", async () => {
  const { client } = boundary([{ data: null, error: null }]);
  expect(
    await updatePractice(client, row.id, {
      name: "Updated",
      timezone: "UTC",
      expectedVersion: 1,
    }),
  ).toEqual({ status: "conflict" });
});
it("S24 unrelated integrity failure never resolves as success", async () => {
  const { client } = boundary([
    { data: null, error: { code: "23505", message: "different_constraint" } },
  ]);
  expect(
    await createPractice(client, { name: "Cedar", timezone: "UTC" }),
  ).toEqual({ status: "unavailable" });
});
it("S24 empty insert or failed duplicate fetch unavailable", async () => {
  for (const results of [
    [{ data: null, error: null }],
    [
      {
        data: null,
        error: { code: "23505", message: "practices_owner_user_id_key" },
      },
      { data: null, error: null },
    ],
    [
      {
        data: null,
        error: { code: "23505", message: "practices_owner_user_id_key" },
      },
      { data: null, error: { code: "network" } },
    ],
  ]) {
    expect(
      await createPractice(boundary(results).client, {
        name: "Cedar",
        timezone: "UTC",
      }),
    ).toEqual({ status: "unavailable" });
  }
});
it("S24 API errors on read/update are unavailable", async () => {
  expect(
    await getCurrentPractice(
      boundary([{ data: null, error: { code: "network" } }]).client,
    ),
  ).toEqual({ status: "unavailable" });
  expect(
    await updatePractice(
      boundary([{ data: null, error: { code: "network" } }]).client,
      row.id,
      { name: "Updated", timezone: "UTC", expectedVersion: 1 },
    ),
  ).toEqual({ status: "unavailable" });
});
it("S24 thrown fetch error on all operations", async () => {
  const c = {
    from: () => {
      throw new Error("private transport details");
    },
  } as unknown as SupabaseClient;
  expect(await getCurrentPractice(c)).toEqual({ status: "unavailable" });
  expect(await createPractice(c, { name: "Cedar", timezone: "UTC" })).toEqual({
    status: "unavailable",
  });
  expect(
    await updatePractice(c, row.id, {
      name: "Updated",
      timezone: "UTC",
      expectedVersion: 1,
    }),
  ).toEqual({ status: "unavailable" });
});

it("S19 unrelated unique error cannot resolve to an existing row", async () => {
  for (const error of [
    { code: "23505", message: "unrelated_unique_constraint" },
    { code: "23514", message: "practices_owner_user_id_key" },
  ]) {
    const { client } = boundary([
      { data: null, error },
      { data: row, error: null },
    ]);
    expect(
      await createPractice(client, { name: "Cedar", timezone: "UTC" }),
    ).toEqual({ status: "unavailable" });
    expect(client.from).toHaveBeenCalledTimes(1);
  }
});
it("S17 all repository operations use only the practices table", async () => {
  const { client } = boundary([
    { data: row, error: null },
    { data: row, error: null },
    { data: row, error: null },
  ]);
  await getCurrentPractice(client);
  await createPractice(client, { name: "Cedar", timezone: "UTC" });
  await updatePractice(client, row.id, {
    name: "Cedar",
    timezone: "UTC",
    expectedVersion: 1,
  });
  expect(vi.mocked(client.from).mock.calls).toEqual([
    ["practices"],
    ["practices"],
    ["practices"],
  ]);
});
