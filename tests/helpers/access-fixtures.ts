import { createHash, randomBytes } from "node:crypto";
import { expect } from "vitest";
import { account, pool } from "./local-fixtures";
export { account, pool };
export function capability() {
  const token = randomBytes(32).toString("base64url");
  return { token, digest: createHash("sha256").update(token).digest("hex") };
}
export async function practice(name = "Cedar Clinic") {
  const actor = await account();
  const result = await actor.client.rpc("create_practice", {
    p_name: name,
    p_timezone: "UTC",
  });
  expect(result.error).toBeNull();
  return { ...actor, practice: result.data };
}
export async function invite(
  a: Awaited<ReturnType<typeof practice>>,
  email: string,
  role = "manager",
) {
  const link = capability();
  const result = await a.client.rpc("create_practice_invitation", {
    p_practice_id: a.practice.id,
    p_email: email,
    p_role: role,
    p_token_digest: link.digest,
  });
  expect(result.error).toBeNull();
  expect(result.data).toMatchObject({
    status: "success",
    invitation: { role, state: "pending", version: 1 },
  });
  return { ...link, invitation: result.data.invitation };
}
export async function membership(practiceId: string, userId: string) {
  const result = await pool.query(
    "select * from public.practice_memberships where practice_id=$1 and user_id=$2",
    [practiceId, userId],
  );
  return result.rows[0];
}
export async function events(practiceId: string) {
  return (
    await pool.query(
      "select * from private.practice_access_events where practice_id=$1 order by occurred_at,id",
      [practiceId],
    )
  ).rows;
}
export async function fixtureWrite(
  actorId: string,
  sql: string,
  values: unknown[],
) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      actorId,
    ]);
    await db.query(sql, values);
    await db.query("commit");
  } finally {
    await db.query("rollback");
    db.release();
  }
}
