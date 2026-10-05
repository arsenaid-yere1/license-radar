import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import {
  fixtureGuard,
  localConfig,
  prepare,
  run,
} from "./local-environment.mjs";
import { assertSnapshot, assertSchema } from "./gauntlet-contract.mjs";

const original = "20261003191334";
const migrations = readdirSync("supabase/migrations")
  .filter(
    (name) =>
      name.endsWith(".sql") && name > original + "_practice_profiles.sql",
  )
  .sort();
assert(migrations.length > 0, "Missing access upgrade migrations");
async function connect() {
  const db = new Client({ connectionString: localConfig().DB_URL });
  await db.connect();
  return db;
}
async function snapshot(db) {
  const result = {};
  for (const table of ["public.practices", "private.practice_audit_events"])
    result[table] = (await db.query(`select * from ${table} order by id`)).rows;
  return result;
}
async function catalog(db) {
  return (
    await db.query(
      "select n.nspname,c.relname,c.relkind,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') order by 1,2,3",
    )
  ).rows;
}
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
mkdirSync("reports", { recursive: true });
await reset(original);
let db = await connect();
try {
  const actors = [randomUUID(), randomUUID()];
  for (const [i, actor] of actors.entries()) {
    await db.query("begin");
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())",
      [actor, `fixture-${actor}@example.test`],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      actor,
    ]);
    await db.query("set local role authenticated");
    await db.query(
      "insert into public.practices(name,timezone) values($1,$2)",
      [i ? "Birch Clinic" : "Cedar Clinic", i ? "America/New_York" : "UTC"],
    );
    for (let edit = 0; edit <= i; edit++)
      await db.query("update public.practices set name=name || ' edited'");
    await db.query("commit");
  }
  const before = await snapshot(db);
  assertSnapshot(before);
  writeFileSync("reports/access-upgrade-before.json", JSON.stringify(before));
  assertSnapshot(
    JSON.parse(readFileSync("reports/access-upgrade-before.json", "utf8")),
  );
  assert.deepEqual(
    JSON.parse(readFileSync("reports/access-upgrade-before.json", "utf8")),
    JSON.parse(JSON.stringify(before)),
  );
  const schemaBefore = await catalog(db);
  await db.query("begin");
  for (const migration of migrations)
    await db.query(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await assert.rejects(
    db.query(
      "do $$ begin raise exception 'deliberate upgrade rollback'; end $$",
    ),
    /deliberate upgrade rollback/,
  );
  await db.query("rollback");
  assert.deepEqual(await snapshot(db), before, "S02 data rollback");
  assert.deepEqual(await catalog(db), schemaBefore, "S02 schema rollback");
  await db.end();
  run("node_modules/.bin/supabase", ["migration", "up", "--local"]);
  db = await connect();
  assert.deepEqual(
    await snapshot(db),
    before,
    "S01 profiles and historical audits preserved",
  );
  const memberships = await db.query(
    "select p.id,p.owner_user_id,m.user_id,m.role,m.state from public.practices p left join public.practice_memberships m on m.practice_id=p.id order by p.id",
  );
  assert.equal(memberships.rows.length, 2);
  for (const row of memberships.rows) {
    assert.equal(row.user_id, row.owner_user_id);
    assert.equal(row.role, "administrator");
    assert.equal(row.state, "active");
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.practice_access_events where operation='membership_initialized'",
      )
    ).rows[0].n,
    2,
  );
  run(process.execPath, ["tools/schema-fingerprint.mjs", "record-upgrade"]);
  writeFileSync(
    "reports/access-upgrade.json",
    JSON.stringify(
      {
        scenarios: ["S01", "S02"],
        profiles: 2,
        profileVersions: Object.values(before)[0].map((p) => p.version),
        historicalEvents: before["private.practice_audit_events"].length,
        rollback: "observed",
        migrations,
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
  await reset();
}
run(process.execPath, ["tools/schema-fingerprint.mjs", "record-replay"]);
assert.equal(
  readFileSync("reports/replay-schema.json", "utf8"),
  readFileSync("reports/upgrade-schema.json", "utf8"),
  "S03 fresh replay and upgrade schema agree",
);
const report = JSON.parse(readFileSync("reports/access-upgrade.json", "utf8"));
assertSchema(
  JSON.parse(readFileSync("reports/replay-schema.json", "utf8")),
  JSON.parse(readFileSync("reports/upgrade-schema.json", "utf8")),
);
report.scenarios.push("S03");
report.replay = "schema matched";
writeFileSync("reports/access-upgrade.json", JSON.stringify(report, null, 2));
