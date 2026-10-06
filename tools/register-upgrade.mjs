import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import {
  fixtureGuard,
  localConfig,
  prepare,
  run,
} from "./local-environment.mjs";
import { catalog } from "./schema-catalog.mjs";
import { assertSchema } from "./gauntlet-contract.mjs";
const original = "20261006003555";
const tables = [
  "public.practices",
  "public.practice_memberships",
  "private.practice_invitations",
  "private.practice_audit_events",
  "private.practice_access_events",
  "private.practice_reminder_settings",
  "private.practice_recipient_events",
];
const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql") && name.slice(0, 14) > original)
  .sort();
assert(migrations.length > 0, "Missing register upgrade");
async function reset(version) {
  await fixtureGuard();
  run("node_modules/.bin/supabase", [
    "db",
    "reset",
    "--local",
    "--no-seed",
    "--yes",
    ...(version ? ["--version", version] : []),
  ]);
  prepare();
}
async function connect() {
  const db = new Client({ connectionString: localConfig().DB_URL });
  await db.connect();
  return db;
}
async function snapshot(db) {
  const result = {};
  for (const table of tables)
    result[table] = (
      await db.query(
        `select * from ${table} order by ${table.endsWith("settings") ? "practice_id" : "id"}`,
      )
    ).rows;
  return result;
}
async function actor(db) {
  const id = randomUUID();
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())",
    [id, `fixture-${id}@example.test`],
  );
  return id;
}
async function as(db, id, sql, args = []) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    await db.query("set local role authenticated");
    const result = await db.query(sql, args);
    await db.query("commit");
    return result.rows[0].result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
mkdirSync("reports", { recursive: true });
await reset(original);
let db = await connect();
let upgraded;
try {
  for (let i = 0; i < 2; i++) {
    const owner = await actor(db),
      staff = await actor(db);
    const practice = await as(
      db,
      owner,
      "select to_jsonb(public.create_practice($1,'UTC')) result",
      [`Upgrade fixture ${i}`],
    );
    await as(
      db,
      owner,
      "select public.update_practice($1,$2,'America/Los_Angeles',1) result",
      [practice.id, `Edited fixture ${i}`],
    );
    const digest = randomBytes(32).toString("hex");
    await as(
      db,
      owner,
      "select public.create_practice_invitation($1,$2,'manager',$3) result",
      [practice.id, `fixture-${staff}@example.test`, digest],
    );
    await as(db, staff, "select public.accept_practice_invitation($1) result", [
      digest,
    ]);
    const member = (
      await db.query(
        "select id from public.practice_memberships where user_id=$1",
        [staff],
      )
    ).rows[0];
    const administrator = (
      await db.query(
        "select id from public.practice_memberships where user_id=$1",
        [owner],
      )
    ).rows[0];
    for (const [membership, version] of [
      [administrator.id, 1],
      [member.id, 2],
      [null, 3],
    ])
      assert.equal(
        (
          await as(
            db,
            owner,
            "select public.set_practice_reminder_recipient($1,$2,$3) result",
            [practice.id, membership, version],
          )
        ).status,
        "success",
      );
    await as(
      db,
      owner,
      "select public.change_practice_member_role($1,1,'viewer') result",
      [member.id],
    );
    if (i)
      await as(db, owner, "select public.revoke_practice_member($1,2) result", [
        member.id,
      ]);
    for (const canceled of [false, true]) {
      const email = `fixture-${randomUUID()}@example.test`;
      const invitation = await as(
        db,
        owner,
        "select public.create_practice_invitation($1,$2,'viewer',$3) result",
        [practice.id, email, randomBytes(32).toString("hex")],
      );
      if (canceled)
        await as(
          db,
          owner,
          "select public.cancel_practice_invitation($1,1) result",
          [invitation.invitation.id],
        );
    }
  }
  const before = await snapshot(db);
  for (const table of tables)
    assert(before[table].length > 0, `Empty historical snapshot ${table}`);
  const fingerprint = await catalog(db);
  writeFileSync(
    "reports/register-upgrade-before.json",
    JSON.stringify({ rows: before, schema: fingerprint }, null, 2),
  );
  await db.query("begin");
  for (const migration of migrations)
    await db.query(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await assert.rejects(
    db.query(
      "do $$begin raise exception 'deliberate register rollback'; end$$",
    ),
    /deliberate register rollback/,
  );
  await db.query("rollback");
  assert.deepEqual(
    await snapshot(db),
    before,
    "Every historical table rolls back",
  );
  assertSchema(await catalog(db), fingerprint);
  await db.end();
  run("node_modules/.bin/supabase", ["migration", "up", "--local"]);
  db = await connect();
  assert.deepEqual(
    await snapshot(db),
    before,
    "Every historical table preserved exactly",
  );
  for (const table of [
    "public.clinicians",
    "public.credentials",
    "public.credential_cycles",
    "public.policy_coverage",
    "private.register_create_requests",
    "private.register_audit_events",
  ])
    assert.equal(
      (await db.query(`select count(*)::int n from ${table}`)).rows[0].n,
      0,
      `Unexpected register backfill: ${table}`,
    );
  for (const practice of before["public.practices"]) {
    const owner = practice.owner_user_id;
    const clinician = await as(
      db,
      owner,
      "select public.create_practice_clinician($1,$2,'Upgrade clinician') result",
      [practice.id, randomUUID()],
    );
    assert.equal(clinician.status, "success");
    const credential = await as(
      db,
      owner,
      "select public.create_practice_credential($1,$2,'Upgrade policy','malpractice_policy','practice',null,$3) result",
      [practice.id, randomUUID(), [clinician.clinician.id]],
    );
    assert.equal(credential.status, "success");
    const register = await as(
      db,
      owner,
      "select public.list_practice_register($1) result",
      [practice.id],
    );
    assert.equal(register.credentials.length, 1);
    assert.equal(register.credentials[0].covered_clinicians.length, 1);
    const recipient = await as(
      db,
      owner,
      "select public.get_practice_reminder_recipient($1) result",
      [practice.id],
    );
    assert.equal(recipient.version, 4);
    assert.equal(recipient.selected, null);
    const profile = await as(
      db,
      owner,
      "select to_jsonb(public.update_practice($1,$2,'UTC',2)) result",
      [practice.id, practice.name],
    );
    assert.equal(profile.version, 3);
    const team = await as(
      db,
      owner,
      "select public.list_practice_team($1) result",
      [practice.id],
    );
    assert(team.members.length > 0);
  }
  upgraded = await catalog(db);
  writeFileSync(
    "reports/register-upgrade-schema.json",
    JSON.stringify(upgraded, null, 2),
  );
  writeFileSync(
    "reports/register-upgrade.json",
    JSON.stringify(
      {
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
        migrations,
        historicalRows: Object.fromEntries(
          tables.map((table) => [table, before[table].length]),
        ),
        rollback: "full rows/functions/ACLs/constraints/indexes matched",
        backfill:
          "all six new tables empty; old RPC compatibility and two representative shared policies witnessed",
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
  await reset();
}
db = await connect();
try {
  assertSchema(await catalog(db), upgraded);
} finally {
  await db.end();
}
console.log(
  "E1-S3 historical rows preserved; full schema rollback and fresh replay witnessed.",
);
