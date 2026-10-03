import { Client } from "pg";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { localConfig, run } from "./local-environment.mjs";
import { assertMutant } from "./gauntlet-contract.mjs";
const config = localConfig();
let db = new Client({ connectionString: config.DB_URL });
await db.connect();
const repo = "src/lib/practice/repository.ts";
const original = readFileSync(repo, "utf8");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const mutants = [
  {
    id: "isolation",
    name: "S17 S18 S23",
    apply: async () => {
      await db.query(
        "alter policy practices_select on public.practices using (true)",
      );
      const r = await db.query(
        "select qual from pg_policies where policyname='practices_select'",
      );
      if (r.rows[0].qual !== "true")
        throw new Error("Isolation mutant not applied");
    },
  },
  {
    id: "timezone",
    name: "S11 catalog",
    apply: async () => {
      const r = await db.query(
        "select pg_get_functiondef('private.validate_practice()'::regprocedure) as body",
      );
      const body = r.rows[0].body;
      const changed = body.replace(
        /if new.timezone[\s\S]*?then\n        raise exception/,
        "if false then\n        raise exception",
      );
      if (changed === body) throw new Error("Timezone mutant not applicable");
      await db.query(changed);
      const after = await db.query(
        "select pg_get_functiondef('private.validate_practice()'::regprocedure) as body",
      );
      if (!after.rows[0].body.includes("if false then"))
        throw new Error("Timezone mutant not applied");
    },
  },
  {
    id: "unique-owner",
    name: "S08 S16 S19 S20",
    apply: async () => {
      await db.query(
        "alter table public.practices drop constraint practices_owner_user_id_key",
      );
      const r = await db.query(
        "select count(*)::int n from pg_constraint where conname='practices_owner_user_id_key'",
      );
      if (r.rows[0].n !== 0) throw new Error("Unique mutant not applied");
    },
  },
  {
    id: "version-predicate",
    name: "S21 S22",
    apply: async () => {
      const changed = original.replace(
        '.eq("version", input.expectedVersion)',
        "",
      );
      if (changed === original)
        throw new Error("Version predicate mutant not applicable");
      writeFileSync(repo, changed);
      if (readFileSync(repo, "utf8") !== changed)
        throw new Error("Version mutant not applied");
    },
  },
  {
    id: "audit-atomicity",
    name: "S25 audit",
    apply: async () => {
      await db.query("drop trigger audit_practice on public.practices");
      const r = await db.query(
        "select count(*)::int n from pg_trigger where tgname='audit_practice'",
      );
      if (r.rows[0].n !== 0) throw new Error("Audit mutant not applied");
    },
  },
];
const records = [];
writeFileSync("reports/sql-mutants.json", "[]");
mkdirSync("reports/sql-mutants", { recursive: true });
try {
  for (const mutant of mutants) {
    let record = {
      id: mutant.id,
      applied: false,
      executed: false,
      killed: false,
      restored: false,
    };
    try {
      run("node_modules/.bin/vitest", [
        "run",
        "--project",
        "integration",
        "tests/integration/practice-profile.test.ts",
        "--testNamePattern",
        mutant.name,
      ]);
      await mutant.apply();
      record.applied = true;
      const file = `reports/sql-mutants/${mutant.id}.json`;
      const r = spawnSync(
        "node_modules/.bin/vitest",
        [
          "run",
          "--project",
          "integration",
          "tests/integration/practice-profile.test.ts",
          "--testNamePattern",
          mutant.name,
          "--reporter=json",
          "--outputFile",
          file,
        ],
        { encoding: "utf8", env: process.env },
      );
      record.executed = true;
      if (r.error) throw r.error;
      const result = JSON.parse(readFileSync(file, "utf8"));
      const failures = result.testResults
        .flatMap((t) => t.assertionResults)
        .filter((t) => t.status === "failed");
      record.killed =
        r.status === 1 &&
        failures.length === 1 &&
        failures[0].failureMessages.some((m) => m.includes("AssertionError"));
      record.exitCode = r.status;
      record.failedTests = failures.map((t) => t.fullName);
      if (!record.killed)
        throw new Error(
          `Mutant survived or test infrastructure failed: ${mutant.id}`,
        );
    } finally {
      writeFileSync(repo, original);
      await db.end();
      run(process.execPath, ["tools/local-environment.mjs", "reset"]);
      record.restored = hash(readFileSync(repo, "utf8")) === hash(original);
      records.push(record);
      writeFileSync(
        "reports/sql-mutants.json",
        JSON.stringify(records, null, 2),
      );
    }
    assertMutant(record);
    if (mutant !== mutants.at(-1)) {
      db = new Client({ connectionString: config.DB_URL });
      await db.connect();
    }
  }
} catch (error) {
  throw error;
} finally {
  if (!db._ending) await db.end();
}
run("node_modules/.bin/vitest", ["run", "--project", "integration"]);
console.log(
  "5 applied real SQL/API mutations killed and restored; restored integration suite passed.",
);
