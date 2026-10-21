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
const baseline = "20261012221339";
const migrations = readdirSync("supabase/migrations")
  .filter((p) => p.endsWith(".sql") && p.slice(0, 14) > baseline)
  .sort();
assert(migrations.length > 0, "Missing renewal workflow migration");
const added = ["credential_renewal_completions", "renewal_completion_requests"];

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
mkdirSync("reports", { recursive: true });
await reset(baseline);
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
  "tests/integration/practice-renewal-completion.test.ts",
  "--exclude",
  "tests/integration/practice-renewal-evidence.test.ts",
]);
let db = await connect(),
  upgraded;
try {
  const worker = (
    await db.query("select private.start_email_reminder_run() id")
  ).rows[0].id;
  await db.query("select private.finish_email_reminder_run($1,true,$2)", [
    worker,
    { submitted: 0 },
  ]);
  const tables = await inventory(db);
  assert.equal(tables.length, 41, "Complete E5-S1 table inventory");
  const before = await snapshot(db, tables),
    schema = await catalog(db);
  for (const t of tables)
    assert(before[t].length > 0, `Empty historical fixture ${t}`);
  await db.query("begin");
  for (const p of migrations)
    await db.query(readFileSync(`supabase/migrations/${p}`, "utf8"));
  await assert.rejects(
    db.query("do $$begin raise exception 'completion upgrade rollback';end$$"),
    /completion upgrade rollback/,
  );
  await db.query("rollback");
  assert.deepEqual(await snapshot(db, tables), before);
  assertSchema(await catalog(db), schema);
  await db.end();
  run("node_modules/.bin/supabase", ["migration", "up", "--local"]);
  db = await connect();
  assert.deepEqual(
    await snapshot(db, tables),
    before,
    "Migration preserves all 41 original tables and Auth",
  );
  for (const t of added)
    assert.equal(
      (await db.query(`select count(*)::int n from private.${t}`)).rows[0].n,
      0,
      "No completion backfill",
    );
  const candidates = (
    await db.query(
      "select c.id,c.practice_id,m.user_id actor from public.credentials c join public.practice_memberships m on m.practice_id=c.practice_id join private.practice_reminder_settings s on s.practice_id=c.practice_id join public.practice_memberships recipient on recipient.practice_id=s.practice_id and recipient.id=s.membership_id where c.archived_at is null and m.state='active' and m.role='administrator' order by c.id",
    )
  ).rows;
  let selected;
  for (const p of candidates) {
    const rows = await as(
      db,
      p.actor,
      "select public.list_practice_register_with_renewal($1,false) result",
      [p.practice_id],
    );
    const record = rows.credentials.find((c) => c.id === p.id);
    if (
      (
        await db.query(
          "select completed_at from public.credential_cycles where id=$1",
          [record.current_cycle.id],
        )
      ).rows[0].completed_at === null
    ) {
      selected = { ...p, record };
      break;
    }
  }
  assert(
    selected,
    "Active uncompleted historical fixture with a selected recipient",
  );
  const c = selected.record,
    p = selected;
  const h = await as(
    db,
    p.actor,
    "select public.get_credential_renewal_history($1,$2,null) result",
    [p.practice_id, c.id],
  );
  assert.equal(h.status, "success");
  assert.deepEqual(
    await snapshot(db, tables),
    before,
    "History creates zero state",
  );
  // Replay every original successful renewal receipt through its exact original API.
  let replayed = 0,
    denied = 0;
  for (const row of before["private.renewal_change_requests"]) {
    const r = row.row,
      v = r.payload,
      authority = (
        await db.query(
          "select 1 from public.practice_memberships where practice_id=$1 and user_id=$2 and state='active' and role in ('administrator','manager')",
          [r.practice_id, r.actor_user_id],
        )
      ).rowCount;
    const name =
      r.intent === "link"
        ? "set_credential_renewal_link"
        : r.intent === "progress"
          ? "set_credential_renewal_progress"
          : "acknowledge_credential_renewal";
    const values = [
      r.practice_id,
      r.request_id,
      v.credentialId,
      v.expectedVersion,
      v.expectedCycleId,
      v.expectedDateRevision,
      v.expectedRenewalVersion,
      ...(r.intent === "review" ? [] : [v.value]),
    ];
    const query = `select public.${name}($1,$2,$3,$4,$5,$6,$7${r.intent === "review" ? "" : ",$8"}) result`;
    if (authority) {
      assert.deepEqual(await as(db, r.actor_user_id, query, values), r.result);
      replayed++;
    } else {
      await assert.rejects(as(db, r.actor_user_id, query, values), {
        code: "42501",
      });
      denied++;
    }
  }
  assert(replayed > 0);
  assert.deepEqual(
    await snapshot(db, tables),
    before,
    "Legacy replay preserves all state",
  );
  const key = randomUUID(),
    tokens = [
      p.practice_id,
      key,
      c.id,
      c.version,
      c.current_cycle.id,
      c.current_cycle.date_revision,
      c.renewal.workflow.version,
      "2090-03-02",
      null,
      true,
    ];
  const query =
    "select public.complete_credential_renewal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result";
  const result = await as(db, p.actor, query, tokens);
  assert.equal(result.status, "success");
  assert.equal(
    result.credential.current_cycle.cycle_number,
    c.current_cycle.cycle_number + 1,
  );
  const after = await snapshot(db, tables);
  assert.deepEqual(await as(db, p.actor, query, tokens), result);
  assert.deepEqual(
    await snapshot(db, tables),
    after,
    "Completion replay creates zero duplicate effects",
  );
  assert.deepEqual(
    after["auth.users"],
    before["auth.users"],
    "Auth preserved by completion",
  );
  for (const t of [
    "private.register_create_requests",
    "private.register_change_requests",
    "private.renewal_change_requests",
    "private.credential_renewal_links",
    "private.credential_renewal_workflows",
    "private.reminder_message_attempts",
  ])
    assert.deepEqual(after[t], before[t], `Completion retains ${t}`);
  assert(
    (
      await db.query(
        "select 1 from private.reminder_reconcile_outbox where practice_id=$1",
        [p.practice_id],
      )
    ).rowCount,
    "Completion outbox persisted",
  );
  const zone = (
    await db.query("select timezone from public.practices where id=$1", [
      p.practice_id,
    ])
  ).rows[0].timezone;
  const now = (
    await db.query(
      "select '2089-01-01 10:00:00'::timestamp at time zone $1 now",
      [zone],
    )
  ).rows[0].now;
  for (let n = 0; n < 100; n++) {
    await db.query(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [p.practice_id],
    );
    await db.query(
      "select private.reconcile_email_reminders_at('fixture-upgrade-completion',$1)",
      [now],
    );
    if (
      !(
        await db.query(
          "select 1 from private.reminder_reconcile_outbox where practice_id=$1",
          [p.practice_id],
        )
      ).rowCount
    )
      break;
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.reminder_jobs where cycle_id=$1",
        [result.credential.current_cycle.id],
      )
    ).rows[0].n,
    1,
    "One materialized successor job (queued or blocked)",
  );
  upgraded = await catalog(db);
  writeFileSync(
    "reports/renewal-completion-upgrade.json",
    JSON.stringify(
      {
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
        baseline,
        migrations,
        historicalRows: Object.fromEntries(
          Object.entries(before).map(([t, r]) => [t, r.length]),
        ),
        rollback: "Original rows and full catalog restored",
        migration: "41 original tables and Auth identical; zero backfill",
        legacy: { replayed, denied },
        completion:
          "One successor and immutable retry; outbox reconciles one new-cycle job",
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
  "Completion upgrade preserved 41 populated application tables and Auth; rollback, immutable replay, successor job and fresh catalog passed.",
);
