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
const baseline = "20261010002012";
const migrations = readdirSync("supabase/migrations")
  .filter((p) => p.endsWith(".sql") && p.slice(0, 14) > baseline)
  .sort();
assert(migrations.length > 0, "Missing renewal workflow migration");
const added = [
  "credential_renewal_links",
  "credential_renewal_workflows",
  "renewal_change_requests",
  "renewal_audit_events",
];
const publicTables =
  "'practices','practice_memberships','clinicians','credentials','policy_coverage','credential_cycles'";
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
async function as(db, actor, query, values = []) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      actor,
    ]);
    await db.query("set local role authenticated");
    const r = await db.query(query, values);
    await db.query("commit");
    return r.rows[0].result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
async function inventory(db) {
  return (
    await db.query(
      `select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='private' or (n.nspname='public' and c.relname in (${publicTables}))) order by n.nspname,c.relname`,
    )
  ).rows.map((t) => `${t.schema}.${t.name}`);
}
const originalColumns = new Map();
async function snapshot(db, tables) {
  const rows = {};
  for (const table of [...tables, "auth.users"]) {
    if (!originalColumns.has(table)) {
      const [schema, name] = table.split(".");
      originalColumns.set(
        table,
        (
          await db.query(
            "select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position",
            [schema, name],
          )
        ).rows.map((r) => r.column_name),
      );
    }
    const names = originalColumns.get(table);
    assert(names.length > 0, "Missing original column inventory");
    rows[table] = (
      await db.query(
        `select to_jsonb(t) row from (select ${names.map((n) => '"' + n + '"').join(",")} from ${table}) t order by to_jsonb(t)::text`,
      )
    ).rows;
  }
  return rows;
}
async function emptyDefaults(db, practices) {
  for (const p of practices) {
    const rows = await as(
      db,
      p.actor,
      "select public.list_practice_register_with_renewal($1,true) result",
      [p.id],
    );
    for (const c of rows.credentials)
      assert.deepEqual(c.renewal, {
        link: { url: null, version: 1 },
        workflow: {
          cycleId: c.current_cycle.id,
          status: "not-started",
          version: 1,
          acknowledgedAt: null,
        },
      });
  }
  for (const table of added)
    assert.equal(
      (await db.query(`select count(*)::int n from private.${table}`)).rows[0]
        .n,
      0,
      `No write/default backfill in ${table}`,
    );
}
mkdirSync("reports", { recursive: true });
await reset(baseline);
// Reuse real released API witnesses to populate every historical ledger, including recovery.
// This is fixture-only and intentionally excludes all E5-S1 API tests on the old schema.
run("npm", [
  "run",
  "test:integration",
  "--",
  "--exclude",
  "tests/integration/practice-pci-certificates.test.ts",
  "--exclude",
  "tests/integration/practice-credential-numbers.test.ts",
  "--exclude",
  "tests/integration/practice-gmail-reminders.test.ts",
  "--exclude",
  "tests/integration/practice-renewal-workflow.test.ts",
  "--exclude",
  "tests/integration/practice-renewal-completion.test.ts",
  "--exclude",
  "tests/integration/practice-renewal-evidence.test.ts",
]);
let db = await connect(),
  upgraded;
try {
  // The API suite leaves notification history but does not invoke the worker HTTP route.
  // Seed its completed-run ledger explicitly so preservation of health evidence is witnessed.
  const workerRun = (
    await db.query("select private.start_email_reminder_run() id")
  ).rows[0].id;
  await db.query("select private.finish_email_reminder_run($1,true,$2)", [
    workerRun,
    { submitted: 0 },
  ]);
  const tables = await inventory(db);
  assert.equal(
    tables.length,
    37,
    "E4-S4 application table inventory must be complete",
  );
  const before = await snapshot(db, tables),
    fingerprint = await catalog(db);
  for (const table of tables)
    assert(before[table].length > 0, `Empty historical fixture ${table}`);
  const practices = (
    await db.query(
      "select p.id,m.user_id actor from public.practices p join public.practice_memberships m on m.practice_id=p.id where m.state='active' and m.role='administrator' order by p.id,m.id",
    )
  ).rows;
  assert(practices.length >= 2, "Two isolated populated practices required");
  const legacyReads = [];
  for (const p of practices.slice(0, 2))
    legacyReads.push(
      await as(
        db,
        p.actor,
        "select public.list_practice_register_with_maintenance($1,true) result",
        [p.id],
      ),
    );
  await db.query("begin");
  for (const p of migrations)
    await db.query(readFileSync(`supabase/migrations/${p}`, "utf8"));
  await assert.rejects(
    db.query(
      "do $$begin raise exception 'deliberate renewal upgrade rollback';end$$",
    ),
    /deliberate renewal upgrade rollback/,
  );
  await db.query("rollback");
  assert.deepEqual(
    await snapshot(db, tables),
    before,
    "All historical rows restored after transactional fault",
  );
  assertSchema(await catalog(db), fingerprint);
  await db.end();
  run("node_modules/.bin/supabase", ["migration", "up", "--local"]);
  db = await connect();
  assert.deepEqual(
    await snapshot(db, tables),
    before,
    "All 37 historical tables and Auth preserved exactly",
  );
  await emptyDefaults(db, practices);
  assert.deepEqual(
    await snapshot(db, tables),
    before,
    "Default reads create zero historical writes",
  );
  for (const [i, p] of practices.slice(0, 2).entries())
    assert.deepEqual(
      await as(
        db,
        p.actor,
        "select public.list_practice_register_with_maintenance($1,true) result",
        [p.id],
      ),
      {
        ...legacyReads[i],
        credentials: legacyReads[i].credentials.map((c) => {
          const latest = before["public.credential_cycles"]
            .map((r) => r.row)
            .filter((cy) => cy.credential_id === c.id)
            .sort((a, b) => b.cycle_number - a.cycle_number)[0];
          assert(latest, "Retained latest cycle exists");
          return {
            ...c,
            record_number: null,
            current_cycle: {
              id: latest.id,
              cycle_number: latest.cycle_number,
              date_revision: latest.date_revision,
              end_date: latest.end_date,
              action_deadline: latest.action_deadline,
            },
          };
        }),
      },
      "Legacy fields unchanged; current_cycle resolves retained highest cycle",
    );
  const actor = (
    await db.query(
      "select p.id,m.user_id actor from public.practices p join public.practice_memberships m on m.practice_id=p.id join public.credentials c on c.practice_id=p.id join public.credential_cycles cy on cy.credential_id=c.id where m.state='active' and m.role='administrator' and c.archived_at is null and cy.completed_at is null order by p.id limit 1",
    )
  ).rows[0];
  assert(actor, "An active uncompleted historical credential is required");
  const rows = await as(
    db,
    actor.actor,
    "select public.list_practice_register_with_renewal($1,false) result",
    [actor.id],
  );
  let c = rows.credentials.find((value) =>
    before["public.credential_cycles"].some(
      (row) =>
        row.row.id === value.current_cycle.id && row.row.completed_at === null,
    ),
  );
  assert(c);
  for (const [name, value, version] of [
    ["set_credential_renewal_link", "https://board.example.test/renew", 1],
    ["set_credential_renewal_progress", "awaiting-approval", 1],
    ["acknowledge_credential_renewal", null, 2],
  ]) {
    const tokens = [
      actor.id,
      randomUUID(),
      c.id,
      c.version,
      c.current_cycle.id,
      c.current_cycle.date_revision,
      version,
    ];
    const result = await as(
      db,
      actor.actor,
      `select public.${name}($1,$2,$3,$4,$5,$6,$7${value === null ? "" : ",$8"}) result`,
      value === null ? tokens : [...tokens, value],
    );
    assert.equal(result.status, "success");
    assert.equal(result.changed, true);
    c = result.credential;
    assert.deepEqual(
      await snapshot(db, tables),
      before,
      "New workflow changes preserve every original row including notification ledgers",
    );
  }
  let replayed = 0,
    denied = 0;
  for (const receipt of before["private.register_create_requests"].map(
    (row) => row.row,
  )) {
    const authority = (
      await db.query(
        "select 1 from public.practice_memberships where practice_id=$1 and user_id=$2 and state='active' and role in ('administrator','manager')",
        [receipt.practice_id, receipt.actor_user_id],
      )
    ).rowCount;
    const p = receipt.payload;
    let query, args;
    if (receipt.operation === "clinician-created") {
      query = "select public.create_practice_clinician($1,$2,$3) result";
      args = [receipt.practice_id, receipt.request_id, p.name];
    } else {
      const detailed = p.contract_version === 2;
      query = `select public.${detailed ? "create_practice_credential_with_details" : "create_practice_credential"}($1,$2,$3,$4,$5,$6,$7${detailed ? ",$8,$9,$10,$11" : ""}) result`;
      args = [
        receipt.practice_id,
        receipt.request_id,
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
    if (authority) {
      assert.deepEqual(
        await as(db, receipt.actor_user_id, query, args),
        receipt.result,
      );
      replayed++;
    } else {
      await assert.rejects(as(db, receipt.actor_user_id, query, args), {
        code: "42501",
      });
      denied++;
    }
  }
  assert(replayed > 0, "Populated original receipts must replay");
  assert.deepEqual(
    await snapshot(db, tables),
    before,
    "Original receipt replay never modifies historical state",
  );
  upgraded = await catalog(db);
  writeFileSync(
    "reports/renewal-workflow-upgrade.json",
    JSON.stringify(
      {
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
        baseline,
        migrations,
        historicalRows: Object.fromEntries(
          Object.entries(before).map(([t, r]) => [t, r.length]),
        ),
        rollback: "All original rows and complete catalog restored",
        defaults: "Four tables empty; default reads create zero work",
        legacy: { replayed, denied, read: "Exact maintenance projection" },
        renewal: "All three intents leave every historical row unchanged",
        freshReplay: "Checked after final reset",
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
  "Renewal upgrade preserved 37 populated application tables and Auth; atomic rollback, defaults, authorized legacy replay and fresh catalog passed.",
);
