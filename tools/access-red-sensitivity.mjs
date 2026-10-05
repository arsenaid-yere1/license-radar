import assert from "node:assert/strict";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fixtureGuard, localConfig, run } from "./local-environment.mjs";
import {
  assertInventory,
  assertMutant,
  browserCases,
  vitestCases,
  assertionFailure,
  assertBrowserFault,
} from "./gauntlet-contract.mjs";

const browserFiles = [
  "tests/e2e/practice-team.spec.ts",
  "tests/e2e/practice-join.spec.ts",
  "tests/e2e/practice-access-adversarial.spec.ts",
];
const browserNames = [
  "S09 S11 S13 S15 S48 invitation validation, duplicate and reissue recovery",
  "S39 stale administrator settings retain edits after demotion and team route uses live role",
  "S34 S35 S38 administrator role controls prevent final-admin loss and revoke existing session",
  "S18 S44 S47 new account retains same-tab context through OTP and explicitly joins as manager",
  "S19 S45 wrong account denied then sign-out clears context and reopened link joins existing account",
  "S46 S48 GET does not consume and mobile keyboard join has private headers and accessibility",
  "S44 another tab requires reopening the invitation",
  "A04 markup invitation preview is text and foreign-Origin action cannot write",
  "A05 fragment token stays out of request URLs referrers and retained text artifacts",
];
const propertyName =
  "P02 1000 strict generated role/version objects accept legitimate values and reject forged authority";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function browserRun(path) {
  rmSync(path, { force: true });
  const r = spawnSync(
    "node_modules/.bin/playwright",
    ["test", ...browserFiles, "--reporter=json"],
    {
      encoding: "utf8",
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: path },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  writeFileSync(path + ".log", `${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  if (r.error) throw r.error;
  return { run: r, report: JSON.parse(readFileSync(path, "utf8")) };
}
function unitRun(path) {
  rmSync(path, { force: true });
  const r = spawnSync(
    "node_modules/.bin/vitest",
    [
      "run",
      "--project",
      "unit",
      "src/lib/team/properties.test.ts",
      "--testNamePattern",
      "^P02 1000 strict",
      "--reporter=json",
      "--outputFile",
      path,
    ],
    { encoding: "utf8", env: process.env, maxBuffer: 16 * 1024 * 1024 },
  );
  writeFileSync(path + ".log", `${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  if (r.error) throw r.error;
  return { run: r, report: JSON.parse(readFileSync(path, "utf8")) };
}
export async function accessRedSensitivity() {
  await fixtureGuard();
  const records = [];
  const full = JSON.parse(
    readFileSync("reports/browser-results-full.json", "utf8"),
  );
  assertInventory(
    browserNames,
    browserCases(full).filter((r) => browserNames.includes(r.name)),
  );
  const sourcePath = "src/lib/team/schema.ts",
    originalSource = readFileSync(sourcePath, "utf8");
  const unit = {
    id: "strict-team-object-properties",
    applied: false,
    executed: false,
    killed: false,
    restored: false,
  };
  try {
    const baseline = unitRun("reports/access-red-unit-baseline.json");
    assert.equal(baseline.run.status, 0);
    assertInventory(
      [propertyName],
      vitestCases(baseline.report).filter((r) => r.name === propertyName),
    );
    const changed = originalSource.replaceAll("z.strictObject(", "z.object(");
    assert.notEqual(changed, originalSource);
    writeFileSync(sourcePath, changed);
    assert.notEqual(
      hash(readFileSync(sourcePath, "utf8")),
      hash(originalSource),
    );
    unit.applied = true;
    const result = unitRun("reports/access-red-unit.json");
    unit.executed = true;
    const selected = vitestCases(result.report).filter(
      (r) => r.name === propertyName,
    );
    assert.deepEqual(selected, [{ name: propertyName, status: "failed" }]);
    const failures = result.report.testResults
      .flatMap((r) => r.assertionResults)
      .filter((r) => r.fullName === propertyName);
    unit.killed =
      result.run.status === 1 &&
      failures.length === 1 &&
      failures[0].failureMessages.some(assertionFailure);
    assert(unit.killed, "Property sensitivity did not fail an assertion");
  } finally {
    writeFileSync(sourcePath, originalSource);
    assert.equal(hash(readFileSync(sourcePath, "utf8")), hash(originalSource));
    unit.restored = true;
  }
  assertMutant(unit);
  const restoredUnit = unitRun("reports/access-red-unit-restored.json");
  assert.equal(restoredUnit.run.status, 0);
  assertInventory(
    [propertyName],
    vitestCases(restoredUnit.report).filter((r) => r.name === propertyName),
  );
  records.push(unit);
  const browserBaseline = browserRun(
    "reports/access-red-browser-baseline.json",
  );
  assert.equal(browserBaseline.run.status, 0);
  assertInventory(browserNames, browserCases(browserBaseline.report));
  const db = new Client({ connectionString: localConfig().DB_URL });
  await db.connect();
  const original = (
    await db.query(
      "select pg_get_functiondef('private.require_administrator(uuid)'::regprocedure) body",
    )
  ).rows[0].body;
  const browser = {
    id: "legitimate-administrator-browser-access",
    applied: false,
    executed: false,
    killed: false,
    restored: false,
  };
  try {
    const changed = original.replace(
      "if not exists (select 1 from public.practice_memberships",
      "if true or not exists (select 1 from public.practice_memberships",
    );
    assert.notEqual(changed, original);
    await db.query(changed);
    assert.notEqual(
      hash(
        (
          await db.query(
            "select pg_get_functiondef('private.require_administrator(uuid)'::regprocedure) body",
          )
        ).rows[0].body,
      ),
      hash(original),
    );
    browser.applied = true;
    const result = browserRun("reports/access-red-browser.json");
    browser.executed = true;
    const actual = browserCases(result.report);
    assert.deepEqual(
      actual.map((r) => r.name).sort(),
      browserNames.slice().sort(),
    );
    const errors = [];
    function collect(suites) {
      for (const suite of suites) {
        for (const spec of suite.specs ?? [])
          for (const test of spec.tests)
            for (const result of test.results)
              errors.push(...(result.errors ?? []));
        collect(suite.suites ?? []);
      }
    }
    collect(result.report.suites);
    assertBrowserFault(browserNames, actual, errors, result.run.status);
    browser.killed = true;
    browser.failedTests = actual.map((r) => r.name);
  } finally {
    await db.query(original);
    assert.equal(
      hash(
        (
          await db.query(
            "select pg_get_functiondef('private.require_administrator(uuid)'::regprocedure) body",
          )
        ).rows[0].body,
      ),
      hash(original),
    );
    await db.end();
    run(process.execPath, ["tools/schema-fingerprint.mjs"]);
    browser.restored = true;
  }
  assertMutant(browser);
  const restoredBrowser = browserRun(
    "reports/access-red-browser-restored.json",
  );
  assert.equal(restoredBrowser.run.status, 0);
  assertInventory(browserNames, browserCases(restoredBrowser.report));
  records.push(browser);
  writeFileSync(
    "reports/access-red-sensitivity.json",
    JSON.stringify(
      { records, runId: process.env.GAUNTLET_RUN_ID ?? "standalone" },
      null,
      2,
    ),
  );
  console.log(
    "Initially GREEN strict-input property and all nine new browser cases failed actual faults; source/schema restored and cases passed again.",
  );
}
