import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
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
const baseline = "20261014002159",
  migrations = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql") && f.slice(0, 14) > baseline)
    .sort();
assert(
  migrations.some((f) => f.endsWith("_gmail_reminders.sql")),
  "Missing Gmail migration",
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
  for (const [table, names] of columns)
    result[table] = (
      await db.query(
        `select to_jsonb(t) row from (select ${names.map((n) => '"' + n + '"').join(",")} from ${table}) t order by to_jsonb(t)::text`,
      )
    ).rows;
  return result;
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
]);
let db = await connect(),
  upgraded;
const service = await provisionEvidenceStorage(),
  seed = randomUUID(),
  path = Array(5).fill(seed).join("/") + ".pdf",
  bytes = Buffer.from(
    "%PDF-1.7\nGmail upgrade preserves original evidence bytes\n%%EOF\n",
  );
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
  ).rows;
  assert.equal(tables.length, 47, "Complete E5-S3 baseline inventory");
  const columns = new Map();
  for (const { s, t } of [...tables, { s: "auth", t: "users" }])
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
  for (const [t, rows] of Object.entries(before))
    assert(rows.length > 0, `Empty historical Gmail fixture ${t}`);
  assert.equal(
    (
      await service.storage
        .from("renewal-evidence")
        .upload(path, bytes, { contentType: "application/pdf", upsert: false })
    ).error,
    null,
  );
  async function preserved() {
    assert.deepEqual(
      await snapshot(db, columns),
      before,
      "Gmail upgrade altered original rows/Auth",
    );
    const read = await service.storage.from("renewal-evidence").download(path);
    assert.equal(read.error, null);
    assert(
      Buffer.from(await read.data.arrayBuffer()).equals(bytes),
      "Original private object bytes changed",
    );
  }
  await db.query("begin");
  for (const f of migrations)
    await db.query(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await assert.rejects(
    db.query("do $$begin raise exception 'gmail rollback witness';end$$"),
    /gmail rollback witness/,
  );
  await db.query("rollback");
  await preserved();
  assertSchema(await catalog(db), schema);
  await db.end();
  run("node_modules/.bin/supabase", ["migration", "up", "--local"]);
  db = await connect();
  await preserved();
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.reminder_message_attempts where provider_kind<>'resend' or gmail_message_id is not null or gmail_authority_version is not null or gmail_result is not null",
      )
    ).rows[0].n,
    0,
    "Historical attempts changed capability",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.gmail_reminder_authority",
      )
    ).rows[0].n,
    0,
    "Migration created a live authority",
  );
  await db.query("begin");
  await db.query(
    "revoke execute on function public.begin_gmail_reminder(uuid,uuid,jsonb,text,integer),private.begin_gmail_reminder(uuid,uuid,jsonb,text,integer) from service_role",
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('service_role','public.begin_gmail_reminder(uuid,uuid,jsonb,text,integer)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  await preserved();
  await db.query("rollback");
  upgraded = await catalog(db);
  writeFileSync(
    "reports/gmail-reminders-upgrade.json",
    JSON.stringify(
      {
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
        baseline,
        migrations,
        historicalRows: Object.fromEntries(
          Object.entries(before).map(([k, v]) => [k, v.length]),
        ),
        objectSha256: createHash("sha256").update(bytes).digest("hex"),
        rollback: "Original rows/catalog/bytes restored",
        preservation:
          "47 populated E5-S3 tables/Auth, Resend capability and actual private object bytes preserved",
        withdrawal:
          "New begin withdrawn; history and consumed permissions retained",
        freshReplay: "Compared after reset",
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
  assert.equal(
    (await service.storage.from("renewal-evidence").remove([path])).error,
    null,
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
  "Gmail upgrade preserved 47 populated E5-S3 tables/Auth and private object bytes; rollback/withdrawal/replay verified.",
);
