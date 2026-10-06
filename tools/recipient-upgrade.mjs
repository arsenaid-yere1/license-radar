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
const original = "20261005212526";
const tables = [
  "public.practices",
  "public.practice_memberships",
  "private.practice_invitations",
  "private.practice_audit_events",
  "private.practice_access_events",
];
const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql") && name.slice(0, 14) > original)
  .sort();
assert(migrations.length > 0, "Missing recipient upgrade");
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
    result[table] = (await db.query(`select * from ${table} order by id`)).rows;
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
    "reports/recipient-upgrade-before.json",
    JSON.stringify({ rows: before, schema: fingerprint }, null, 2),
  );
  await db.query("begin");
  for (const migration of migrations)
    await db.query(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await assert.rejects(
    db.query(
      "do $$begin raise exception 'deliberate recipient rollback'; end$$",
    ),
    /deliberate recipient rollback/,
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
  const settings = (
    await db.query(
      "select membership_id,version from private.practice_reminder_settings",
    )
  ).rows;
  assert.equal(settings.length, 2);
  for (const row of settings)
    assert.deepEqual(row, { membership_id: null, version: 1 });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.practice_recipient_events",
      )
    ).rows[0].n,
    0,
  );
  upgraded = await catalog(db);
  writeFileSync(
    "reports/recipient-upgrade-schema.json",
    JSON.stringify(upgraded, null, 2),
  );
  writeFileSync(
    "reports/recipient-upgrade.json",
    JSON.stringify(
      {
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
        migrations,
        historicalRows: Object.fromEntries(
          tables.map((table) => [table, before[table].length]),
        ),
        rollback: "full rows/functions/ACLs/constraints/indexes matched",
        backfill: "two null/version-one rows, zero assignment events",
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
  "E1-S2 historical rows preserved; full schema rollback and fresh replay witnessed.",
);
