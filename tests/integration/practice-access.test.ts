import { afterAll, expect, it } from "vitest";
import { account, pool } from "../helpers/local-fixtures";
afterAll(() => pool.end());

async function create() {
  const actor = await account();
  const result = await actor.client.rpc("create_practice", {
    p_name: "Cedar Clinic",
    p_timezone: "UTC",
  });
  expect(result.error).toBeNull();
  expect(result.data).toMatchObject({ name: "Cedar Clinic", version: 1 });
  return { ...actor, practice: result.data };
}

it("S04 concurrent RPC creation produces one practice, membership and each audit", async () => {
  const a = await account();
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      a.client.rpc("create_practice", {
        p_name: "Cedar Clinic",
        p_timezone: "UTC",
      }),
    ),
  );
  expect(results.every((r) => !r.error)).toBe(true);
  expect(new Set(results.map((r) => r.data?.id)).size).toBe(1);
  const id = results[0].data.id;
  const counts = await pool.query(
    "select (select count(*)::int from public.practice_memberships where practice_id=$1) members, (select count(*)::int from private.practice_access_events where practice_id=$1) access_events, (select count(*)::int from private.practice_audit_events where practice_id=$1) profile_events",
    [id],
  );
  expect(counts.rows[0]).toEqual({
    members: 1,
    access_events: 1,
    profile_events: 1,
  });
  expect(
    (
      await a.client.rpc("create_practice", {
        p_name: "Different",
        p_timezone: "UTC",
      })
    ).data,
  ).toEqual(results[0].data);
});

it("S33 N05 direct writes denied and manager reads shared profile only", async () => {
  const a = await create(),
    b = await account();
  await pool.query(
    "insert into public.practice_memberships(practice_id,user_id,role) values($1,$2,'manager')",
    [a.practice.id, b.user.id],
  );
  expect((await b.client.from("practices").select("*")).data).toEqual([
    a.practice,
  ]);
  expect(
    (await b.client.from("practice_memberships").select("*")).data,
  ).toHaveLength(1);
  for (const actor of [a, b]) {
    expect(
      (
        await actor.client
          .from("practices")
          .insert({ name: "Attacked", timezone: "UTC" })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await actor.client
          .from("practices")
          .update({ name: "Attacked" })
          .eq("id", a.practice.id)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await actor.client
          .from("practice_memberships")
          .update({ role: "administrator" })
          .eq("user_id", b.user.id)
      ).error,
    ).not.toBeNull();
  }
  expect(
    (
      await b.client.rpc("update_practice", {
        p_practice_id: a.practice.id,
        p_name: "Attacked",
        p_timezone: "UTC",
        p_expected_version: 1,
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await pool.query(
        "select name,version from public.practices where id=$1",
        [a.practice.id],
      )
    ).rows[0],
  ).toEqual({ name: "Cedar Clinic", version: 1 });
});

it("S37 deferred invariant rejects last administrator loss and orphan creation", async () => {
  const a = await create();
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query(
      "update public.practice_memberships set role='viewer' where practice_id=$1",
      [a.practice.id],
    );
    await expect(
      db.query("set constraints all immediate"),
    ).rejects.toMatchObject({ code: "23514" });
    await db.query("rollback");
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      a.user.id,
    ]);
    await db.query(
      "insert into public.practices(name,timezone) values('Orphan','UTC')",
    );
    await expect(
      db.query("set constraints all immediate"),
    ).rejects.toMatchObject({ code: "23514" });
  } finally {
    await db.query("rollback");
    db.release();
  }
});

it("S06 S38 creator provenance never restores access with the existing JWT", async () => {
  const a = await create(),
    d = await account();
  await pool.query(
    "insert into public.practice_memberships(practice_id,user_id,role) values($1,$2,'administrator')",
    [a.practice.id, d.user.id],
  );
  await pool.query(
    "update public.practice_memberships set state='revoked',revoked_at=clock_timestamp(),version=version+1 where practice_id=$1 and user_id=$2",
    [a.practice.id, a.user.id],
  );
  expect((await a.client.from("practices").select("*")).data).toEqual([]);
  expect(
    (
      await a.client.rpc("update_practice", {
        p_practice_id: a.practice.id,
        p_name: "Attacked",
        p_timezone: "UTC",
        p_expected_version: 1,
      })
    ).error?.code,
  ).toBe("42501");
  const next = await a.client.rpc("create_practice", {
    p_name: "New Practice",
    p_timezone: "UTC",
  });
  expect(next.error).toBeNull();
  expect(next.data.id).not.toBe(a.practice.id);
  expect((await d.client.from("practices").select("*")).data).toEqual([
    a.practice,
  ]);
});
