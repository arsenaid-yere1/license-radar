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
import { provisionEvidenceStorage } from "./evidence-storage.mjs";
const baseline = "20261013172507",
  migrations = readdirSync("supabase/migrations")
    .filter((p) => p.endsWith(".sql") && p.slice(0, 14) > baseline)
    .sort();
assert(migrations.length > 0, "Missing evidence migration");
const added = [
  "renewal_evidence",
  "renewal_evidence_requests",
  "renewal_evidence_objects",
  "renewal_evidence_audit_events",
];
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
  "tests/integration/practice-payer-directories.test.ts",
  "--exclude",
  "tests/integration/practice-pci-certificates.test.ts",
  "--exclude",
  "tests/integration/practice-credential-numbers.test.ts",
  "--exclude",
  "tests/integration/practice-gmail-reminders.test.ts",
  "--exclude",
  "tests/integration/practice-renewal-evidence.test.ts",
]);
let db = await connect(),
  upgraded;
const service = await provisionEvidenceStorage(),
  seed = randomUUID(),
  path = Array(5).fill(seed).join("/") + ".pdf",
  bytes = Buffer.from("%PDF-1.7\nupgrade preservation fixture\n%%EOF\n");
try {
  const worker = (
    await db.query("select private.start_email_reminder_run() id")
  ).rows[0].id;
  await db.query("select private.finish_email_reminder_run($1,true,$2)", [
    worker,
    { submitted: 0 },
  ]);
  const tables = (
    await db.query(
      "select n.nspname s,c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='private' or (n.nspname='public' and c.relname in ('practices','practice_memberships','clinicians','credentials','policy_coverage','credential_cycles'))) order by n.nspname,c.relname",
    )
  ).rows.map((r) => `${r.s}.${r.t}`);
  assert.equal(tables.length, 43, "Complete E5-S2 baseline inventory");
  const before = await snapshot(db, tables),
    schema = await catalog(db);
  for (const t of tables)
    assert(
      before[t].length > 0,
      `Empty historical evidence upgrade fixture ${t}`,
    );
  assert.equal(
    (
      await service.storage
        .from("renewal-evidence")
        .upload(path, bytes, { contentType: "application/pdf", upsert: false })
    ).error,
    null,
  );
  await db.query("begin");
  for (const migration of migrations)
    await db.query(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await assert.rejects(
    db.query("do $$begin raise exception 'evidence rollback witness';end$$"),
    /evidence rollback witness/,
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
    "Evidence migration preserves all original rows/Auth",
  );
  for (const t of added)
    assert.equal(
      (await db.query(`select count(*)::int n from private.${t}`)).rows[0].n,
      0,
      "Evidence has no backfill",
    );
  let read = await service.storage.from("renewal-evidence").download(path);
  assert.equal(read.error, null);
  assert(
    Buffer.from(await read.data.arrayBuffer()).equals(bytes),
    "Migration changed existing object bytes",
  );
  // Application withdrawal leaves SQL/history and physical bytes intact.
  await db.query("begin");
  await db.query(
    "revoke execute on function public.reserve_renewal_evidence(uuid,uuid,uuid,uuid,text,text,integer,text), public.remove_renewal_evidence(uuid,uuid,uuid,uuid,uuid,integer,boolean), private.reserve_renewal_evidence(uuid,uuid,uuid,uuid,text,text,integer,text), private.remove_renewal_evidence(uuid,uuid,uuid,uuid,uuid,integer,boolean) from authenticated",
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.reserve_renewal_evidence(uuid,uuid,uuid,uuid,text,text,integer,text)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.get_renewal_evidence(uuid,uuid,uuid)','execute') allowed",
      )
    ).rows[0].allowed,
    true,
  );
  read = await service.storage.from("renewal-evidence").download(path);
  assert.equal(read.error, null);
  assert(Buffer.from(await read.data.arrayBuffer()).equals(bytes));
  await db.query("rollback");
  assert.deepEqual(
    await snapshot(db, tables),
    before,
    "Write withdrawal altered retained records",
  );
  upgraded = await catalog(db);
  writeFileSync(
    "reports/renewal-evidence-upgrade.json",
    JSON.stringify(
      {
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
        baseline,
        migrations,
        historicalRows: Object.fromEntries(
          Object.entries(before).map(([k, v]) => [k, v.length]),
        ),
        rollback: "Original rows/catalog restored",
        preservation:
          "43 application tables/Auth and real preexisting object bytes preserved",
        fallback: "Writes withdrawn; authorized reads and bytes retained",
        freshReplay: "Compared after final reset",
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
  const removed = await service.storage.from("renewal-evidence").remove([path]);
  assert.equal(
    removed.error,
    null,
    "Could not remove exact upgrade fixture object",
  );
  await reset();
}
db = await connect();
try {
  assertSchema(await catalog(db), upgraded);
} finally {
  await db.end();
}
await provisionEvidenceStorage();
console.log(
  "Evidence upgrade preserved 43 populated application tables/Auth and object bytes; rollback, write withdrawal and fresh replay match.",
);
