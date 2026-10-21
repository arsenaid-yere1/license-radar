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
import { catalog } from "./schema-catalog.mjs";
import { assertSchema } from "./gauntlet-contract.mjs";

const baseline = "20261015181333";
const migrations = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql") && f.slice(0, 14) > baseline)
  .sort();
assert(
  migrations.some((f) => f.endsWith("_credential_record_numbers.sql")),
  "Missing number migration",
);
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
async function snapshot(db, columns) {
  const result = {};
  for (const [table, names] of columns) {
    assert(names.length > 0, "Missing original columns");
    result[table] = (
      await db.query(
        `select to_jsonb(t) row from (select ${names.map((n) => '"' + n + '"').join(",")} from ${table}) t order by to_jsonb(t)::text`,
      )
    ).rows;
  }
  return result;
}
async function as(db, actor, query, values) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      actor,
    ]);
    await db.query("set local role authenticated");
    const result = await db.query(query, values);
    await db.query("commit");
    return result.rows[0].result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
mkdirSync("reports", { recursive: true });
await reset(baseline);
run("npm", [
  "run",
  "test:integration",
  "--",
  "--exclude",
  "tests/integration/practice-payer-directories.test.ts",
  "--exclude",
  "tests/integration/practice-pci-certificates.test.ts",
  "--exclude",
  "tests/integration/practice-credential-numbers.test.ts",
]);
let db = await connect(),
  upgraded;
try {
  const tables = (
    await db.query(
      "select n.nspname s,c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='private' or (n.nspname='public' and c.relname in ('practices','practice_memberships','clinicians','credentials','policy_coverage','credential_cycles'))) order by n.nspname,c.relname",
    )
  ).rows;
  assert(tables.length >= 48, "Missing latest application inventory");
  const columns = new Map();
  for (const { s, t } of [
    ...tables,
    { s: "auth", t: "users" },
    { s: "auth", t: "identities" },
    { s: "storage", t: "objects" },
  ])
    columns.set(
      `${s}.${t}`,
      (
        await db.query(
          "select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position",
          [s, t],
        )
      ).rows.map((r) => r.column_name),
    );
  const before = await snapshot(db, columns),
    schema = await catalog(db);
  for (const t of [
    "public.credentials",
    "public.credential_cycles",
    "private.register_create_requests",
    "private.register_change_requests",
    "private.renewal_completion_requests",
    "private.reminder_message_attempts",
    "auth.users",
    "auth.identities",
  ])
    assert(before[t].length > 0, `Unpopulated required fixture ${t}`);
  await db.query("begin");
  for (const file of migrations)
    await db.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await assert.rejects(
    db.query("do $$begin raise exception 'number rollback witness';end$$"),
    /number rollback witness/,
  );
  await db.query("rollback");
  assert.deepEqual(await snapshot(db, columns), before);
  assertSchema(await catalog(db), schema);
  await db.end();
  run("node_modules/.bin/supabase", ["migration", "up", "--local"]);
  db = await connect();
  assert.deepEqual(
    await snapshot(db, columns),
    before,
    "Original application/Auth/Storage columns changed during migration",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.credentials where record_number is not null",
      )
    ).rows[0].n,
    0,
    "No guessed backfill",
  );
  // Exercise immutable historical create and maintenance receipts under current authority.
  let replayed = 0,
    denied = 0;
  for (const table of [
    "private.register_create_requests",
    "private.register_change_requests",
  ])
    for (const { row: r } of before[table]) {
      const p = r.payload;
      let name, args;
      if (table.endsWith("create_requests")) {
        if (r.operation === "clinician-created") {
          name = "create_practice_clinician";
          args = [r.practice_id, r.request_id, p.name];
        } else {
          const detailed = p.contract_version === 2;
          name = detailed
            ? "create_practice_credential_with_details"
            : "create_practice_credential";
          args = [
            r.practice_id,
            r.request_id,
            p.title,
            p.type,
            p.owner_kind,
            p.owner_clinician_id,
            p.covered_clinician_ids,
            ...(detailed
              ? [p.issuer, p.jurisdiction, p.end_date, p.action_deadline]
              : []),
          ];
        }
      } else {
        name =
          r.operation === "credential-archived"
            ? "archive_practice_credential"
            : "update_practice_credential";
        args = [
          r.practice_id,
          r.request_id,
          p.credential_id,
          p.expected_version,
          p.expected_cycle_id,
          p.expected_date_revision,
        ];
        if (p.values) {
          const v = p.values;
          args.push(
            v.title,
            v.type,
            v.owner_kind,
            v.owner_clinician_id,
            v.covered_clinician_ids,
            v.issuer,
            v.jurisdiction,
            v.end_date,
            v.action_deadline,
          );
        }
      }
      const query = `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`;
      const authorized = (
        await db.query(
          "select 1 from public.practice_memberships where practice_id=$1 and user_id=$2 and state='active' and role in ('administrator','manager')",
          [r.practice_id, r.actor_user_id],
        )
      ).rowCount;
      if (authorized) {
        assert.deepEqual(await as(db, r.actor_user_id, query, args), r.result);
        replayed++;
      } else {
        await assert.rejects(as(db, r.actor_user_id, query, args), {
          code: "42501",
        });
        denied++;
      }
    }
  assert(replayed > 0, "No old receipt replayed");
  assert.deepEqual(
    await snapshot(db, columns),
    before,
    "Replay mutated historical rows",
  );
  const a = (
    await db.query(
      "select c.practice_id,m.user_id actor,c.id from public.credentials c join public.practice_memberships m on m.practice_id=c.practice_id join lateral (select cy.completed_at from public.credential_cycles cy where cy.practice_id=c.practice_id and cy.credential_id=c.id order by cy.cycle_number desc limit 1) current_cycle on current_cycle.completed_at is null where m.state='active' and m.role='administrator' and c.archived_at is null and c.version<2147483647 order by c.id limit 1",
    )
  ).rows[0];
  assert(a, "Missing active rollback candidate");
  const rows = await as(
    db,
    a.actor,
    "select public.list_practice_register_with_renewal($1,false) result",
    [a.practice_id],
  );
  const c = rows.credentials.find((c) => c.id === a.id);
  await db.query(
    "update public.credentials set record_number='UPGRADE-0001' where id=$1",
    [c.id],
  );
  const args = [
    a.practice_id,
    randomUUID(),
    c.id,
    c.version,
    c.current_cycle.id,
    c.current_cycle.date_revision,
    c.title,
    c.type,
    c.owner_kind,
    c.owner_clinician_id,
    c.covered_clinicians.map((c) => c.id),
    c.issuer,
    c.jurisdiction,
    c.current_cycle.end_date,
    c.current_cycle.action_deadline,
  ];
  const old = await as(
    db,
    a.actor,
    `select public.update_practice_credential(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
    args,
  );
  assert.equal(old.status, "success");
  assert.equal(old.changed, false);
  assert.equal(
    old.credential.record_number,
    "UPGRADE-0001",
    "Old application erased number",
  );
  upgraded = await catalog(db);
  writeFileSync(
    "reports/credential-numbers-upgrade.json",
    JSON.stringify(
      {
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
        baseline,
        migrations,
        tables: tables.length,
        historicalRows: Object.fromEntries(
          Object.entries(before).map(([k, v]) => [k, v.length]),
        ),
        replayed,
        denied,
        rollback: "Original rows and catalog restored",
        preservation:
          "All original application/Auth/Storage columns identical; number initially null",
        applicationRollback: "Legacy same-type update retained number",
        freshReplay: "Catalog compared after reset",
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
  "Number upgrade, original-column preservation, exact old receipts, application rollback and fresh catalog passed.",
);
