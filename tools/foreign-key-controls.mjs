import { Client } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { localConfig } from "./local-environment.mjs";
const sql = readFileSync("supabase/tests/practice_profiles.test.sql", "utf8");
const cases = [
  { id: "baseline", mutation: "", expected: [] },
  {
    id: "owner-fk",
    mutation:
      "alter table public.practices drop constraint practices_owner_user_id_fkey;",
    expected: ["N04 owner foreign key restricts deletion"],
  },
  {
    id: "audit-fks",
    mutation:
      "alter table private.practice_audit_events drop constraint practice_audit_events_practice_id_fkey, drop constraint practice_audit_events_actor_user_id_fkey;",
    expected: ["N04 audit practice and actor foreign keys restrict deletion"],
  },
];
const reports = [];
for (const item of cases) {
  const db = new Client({ connectionString: localConfig().DB_URL });
  await db.connect();
  try {
    await db.query("begin");
    if (item.mutation) await db.query(item.mutation);
    const constraints = await db.query(
      "select count(*)::int n from pg_constraint where contype='f' and conrelid in ('public.practices'::regclass, 'private.practice_audit_events'::regclass)",
    );
    const expectedCount =
      item.id === "baseline" ? 3 : item.id === "owner-fk" ? 2 : 1;
    if (constraints.rows[0].n !== expectedCount)
      throw new Error("Foreign-key control not applied");
    const input = sql.replace(/^begin;\n/, "").replace(/rollback;\s*$/, "");
    const result = await db.query(input);
    const messages = result
      .flatMap((r) => r.rows.flatMap((row) => Object.values(row)))
      .filter((v) => typeof v === "string");
    const failures = messages
      .filter((v) => /^not ok \d+ - /.test(v))
      .map((v) => v.split(" - ")[1].split("\n")[0]);
    if (JSON.stringify(failures) !== JSON.stringify(item.expected))
      throw new Error(
        `Unexpected foreign-key control failures: ${JSON.stringify(failures)}`,
      );
    if (!messages.some((v) => v === "1..20"))
      throw new Error("SQL test plan did not execute");
    reports.push({
      id: item.id,
      applied: true,
      executed: true,
      failedAssertions: failures,
    });
  } finally {
    await db.query("rollback");
    const restored = await db.query(
      "select count(*)::int n from pg_constraint where contype='f' and conrelid in ('public.practices'::regclass, 'private.practice_audit_events'::regclass)",
    );
    if (restored.rows[0].n !== 3) throw new Error("Foreign keys not restored");
    await db.end();
  }
}
writeFileSync(
  "reports/foreign-key-controls.json",
  JSON.stringify(reports, null, 2),
);
console.log(
  "20 SQL assertions pass; removing owner/audit foreign keys produces both expected N04 failures; rolled back.",
);
