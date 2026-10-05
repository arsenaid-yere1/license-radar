import { it, expect, afterAll } from "vitest";
import {
  account,
  anonymous,
  pool,
  auditCount,
} from "../helpers/local-fixtures";
import {
  createPractice,
  updatePractice,
  getCurrentPractice,
} from "@/lib/practice/repository";
import { savePractice } from "@/lib/practice/save";
import { getSupportedTimezones } from "@/lib/practice/timezones";
afterAll(() => pool.end());
const input = { name: "Cedar Clinic", timezone: "America/Los_Angeles" };
it("S08 S16 S19 S20 real concurrent create is idempotent and audited once", async () => {
  const a = await account();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => savePractice(a.client, input, false)),
  );
  expect(results.every((r) => r.status === "success")).toBe(true);
  const first = results[0];
  if (first.status !== "success") throw new Error("create failed");
  expect(
    new Set(
      results.map((r) => (r.status === "success" ? r.practice.id : "failure")),
    ).size,
  ).toBe(1);
  expect(await auditCount(first.practice.id)).toBe(1);
  expect(
    await createPractice(a.client, { name: "Different", timezone: "UTC" }),
  ).toEqual(first);
  expect(await getCurrentPractice(a.client)).toEqual(first);
});
it("S17 S18 S23 direct Data API ownership and grants", async () => {
  const a = await account(),
    b = await account();
  const result = await createPractice(a.client, input);
  expect(result.status).toBe("success");
  if (result.status !== "success") throw new Error("create failed");
  const id = result.practice.id;
  const bProfile = await createPractice(b.client, {
    name: "Other Practice",
    timezone: "UTC",
  });
  expect(bProfile.status).toBe("success");
  expect(
    (
      await b.client.auth.updateUser({
        data: { role: "admin", owner_user_id: a.user.id },
      })
    ).error,
  ).toBeNull();
  expect(
    (await b.client.from("practices").select("*").eq("id", id)).data,
  ).toEqual([]);
  expect(
    (
      await b.client
        .from("practices")
        .update({ name: "Attacked" })
        .eq("id", id)
        .select()
    ).error,
  ).not.toBeNull();
  expect((await anonymous().from("practices").select()).error).not.toBeNull();
  expect(
    (await anonymous().from("practices").insert(input)).error,
  ).not.toBeNull();
  for (const key of [
    "id",
    "owner_user_id",
    "version",
    "created_at",
    "updated_at",
  ]) {
    expect(
      (
        await a.client
          .from("practices")
          .update({
            [key]:
              key === "version"
                ? 9
                : key.endsWith("_at")
                  ? new Date().toISOString()
                  : crypto.randomUUID(),
          })
          .eq("id", id)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await a.client.from("practices").insert({
          ...input,
          [key]:
            key === "version"
              ? 9
              : key.endsWith("_at")
                ? new Date().toISOString()
                : crypto.randomUUID(),
        })
      ).error,
    ).not.toBeNull();
  }
  expect(
    (await a.client.from("practices").delete().eq("id", id)).error,
  ).not.toBeNull();
  expect(
    (await a.client.schema("private").from("practice_audit_events").select())
      .error,
  ).not.toBeNull();
  expect(await getCurrentPractice(a.client)).toEqual(result);
  expect(await auditCount(id)).toBe(1);
  expect(
    (await pool.query("select name from public.practices where id=$1", [id]))
      .rows[0].name,
  ).toBe(input.name);
  expect(await getCurrentPractice(b.client)).toMatchObject({
    status: "success",
    practice: { name: "Other Practice", owner_user_id: b.user.id },
  });
  expect(
    (
      await a.client
        .schema("private")
        .from("practice_audit_events")
        .insert({ practice_id: id, operation: "forged" })
    ).error,
  ).not.toBeNull();
});
it("S21 S22 real stale updates have one winner and atomic audit", async () => {
  const a = await account();
  const first = await createPractice(a.client, input);
  if (first.status !== "success") throw new Error("create failed");
  const results = await Promise.all(
    ["Cedar Medical", "Competing"].map((name) =>
      updatePractice(a.client, first.practice.id, {
        name,
        timezone: "America/New_York",
        expectedVersion: 1,
      }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual(["conflict", "success"]);
  const saved = await getCurrentPractice(a.client);
  expect(saved.status).toBe("success");
  if (saved.status !== "success" || !saved.practice)
    throw new Error("no saved practice");
  expect(saved.practice.version).toBe(2);
  const audit = await pool.query(
    "select * from private.practice_audit_events where practice_id=$1 order by occurred_at",
    [first.practice.id],
  );
  expect(audit.rows).toHaveLength(2);
  expect(audit.rows[1]).toMatchObject({
    actor_user_id: a.user.id,
    before_name: input.name,
    after_name: saved.practice.name,
    before_timezone: input.timezone,
    after_timezone: "America/New_York",
    operation: "updated",
  });
});
it("S11 catalog agreement and invalid API zone", async () => {
  const zones = await pool.query("select name from pg_timezone_names");
  expect(
    getSupportedTimezones().every((z) => zones.rows.some((r) => r.name === z)),
  ).toBe(true);
  const a = await account();
  expect(
    (
      await a.client
        .from("practices")
        .insert({ ...input, timezone: "Mars/Olympus" })
    ).error,
  ).not.toBeNull();
  expect(await getCurrentPractice(a.client)).toEqual({
    status: "success",
    practice: null,
  });
});
it("S25 audit fault rolls back both creation and update", async () => {
  const a = await account(),
    b = await account();
  const first = await createPractice(a.client, input);
  if (first.status !== "success") throw new Error("create failed");
  await pool.query(
    "create function private.fixture_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture audit failure'; end $$; create trigger fixture_audit_failure before insert on private.practice_audit_events for each row execute function private.fixture_audit_failure()",
  );
  try {
    expect(await createPractice(b.client, input)).toEqual({
      status: "unavailable",
    });
    expect(await getCurrentPractice(b.client)).toEqual({
      status: "success",
      practice: null,
    });
    expect(
      await updatePractice(a.client, first.practice.id, {
        ...input,
        name: "Must roll back",
        expectedVersion: 1,
      }),
    ).toEqual({ status: "unavailable" });
    expect(await getCurrentPractice(a.client)).toEqual(first);
    expect(await auditCount(first.practice.id)).toBe(1);
  } finally {
    await pool.query(
      "drop trigger fixture_audit_failure on private.practice_audit_events; drop function private.fixture_audit_failure()",
    );
  }
});
