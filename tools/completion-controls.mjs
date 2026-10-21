import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { catalog } from "./schema-catalog.mjs";
import {
  assertSchema,
  vitestCases,
  assertInventory,
  assertionFailure,
} from "./gauntlet-contract.mjs";
import { fixtureGuard, localConfig } from "./local-environment.mjs";
export async function completionSqlControls() {
  await fixtureGuard();
  mkdirSync("reports", { recursive: true });
  const db = new Client({ connectionString: localConfig().DB_URL });
  await db.connect();
  const reports = [];
  const signature =
    "private.complete_credential_renewal(uuid,uuid,uuid,integer,uuid,integer,integer,text,text,boolean)";
  const faults = [
    {
      id: "completion-future-day",
      signature,
      from: "entered_end <= today",
      to: "entered_end < today",
      pattern: "RC01 invalid dates",
    },
    {
      id: "completion-stale-context",
      signature,
      from: "credential.version <> p_expected_version",
      to: "false",
      pattern: "RC04 context tokens",
    },
    {
      id: "completion-replay",
      signature,
      from: "return receipt.result;",
      to: 'return \'{"status":"request-conflict"}\'::jsonb;',
      pattern: "RC03 concurrent exact",
    },
    {
      id: "completion-history-preservation",
      signature,
      from: "set completed_at = occurred, updated_at = occurred",
      to: "set end_date = entered_end, completed_at = occurred, updated_at = occurred",
      pattern: "RC02 RC04 confirmed",
    },
    {
      id: "completion-latest-cycle",
      signature: "private.current_credential_cycle(uuid,uuid)",
      from: "order by cycle_number desc",
      to: "order by cycle_number asc",
      pattern: "RC02 RC04 confirmed",
    },
  ];
  try {
    const before = await catalog(db);
    for (const f of faults) {
      const original = (
        await db.query("select pg_get_functiondef($1::regprocedure) body", [
          f.signature,
        ])
      ).rows[0].body;
      assert.equal(
        original.split(f.from).length,
        2,
        `Fault must match once: ${f.id}`,
      );
      const changed = original.replace(f.from, f.to);
      try {
        await db.query(changed);
        assert.notEqual(
          (
            await db.query("select pg_get_functiondef($1::regprocedure) body", [
              f.signature,
            ])
          ).rows[0].body,
          original,
        );
        const path = `reports/completion-${f.id}.json`;
        const r = spawnSync(
          "npm",
          [
            "run",
            "test:integration",
            "--",
            "tests/integration/practice-renewal-completion.test.ts",
            "--testNamePattern",
            f.pattern,
            "--reporter=json",
            `--outputFile=${path}`,
          ],
          { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
        );
        if (r.error) throw r.error;
        assert.equal(r.status, 1, "Fault must fail behavioral assertion");
        const result = JSON.parse(readFileSync(path, "utf8")),
          cases = vitestCases(result);
        assert(cases.length > 0);
        assert(cases.some((c) => c.status === "failed"));
        assert(
          result.testResults.some((t) =>
            t.assertionResults.some(
              (a) =>
                a.status === "failed" &&
                a.failureMessages.some(assertionFailure),
            ),
          ),
          "Fault must cause assertion failure",
        );
        writeFileSync(
          `reports/completion-${f.id}.log`,
          `${r.stdout}\n${r.stderr}`,
        );
        reports.push({
          id: f.id,
          applied: true,
          executed: true,
          killed: true,
          restored: true,
        });
      } finally {
        await db.query(original);
        assert.equal(
          (
            await db.query("select pg_get_functiondef($1::regprocedure) body", [
              f.signature,
            ])
          ).rows[0].body,
          original,
        );
        assertSchema(await catalog(db), before);
      }
    }
  } finally {
    await db.end();
  }
  writeFileSync(
    "reports/completion-sql-controls.json",
    JSON.stringify(reports, null, 2),
  );
  console.log(
    `${reports.length} applied completion faults killed by behavioral assertions and catalog restored.`,
  );
}
export function assertCompletionLayer(layers) {
  assertInventory(
    ["renewal-completion-upgrade"],
    layers
      .filter((l) => l.id === "renewal-completion-upgrade")
      .map((l) => ({ name: l.id, status: "passed" })),
  );
  const l = layers.find((l) => l.id === "renewal-completion-upgrade");
  assert.deepEqual(l, {
    id: "renewal-completion-upgrade",
    command: "node",
    args: ["tools/renewal-completion-upgrade.mjs"],
  });
}
