import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  assertionFailure,
  assertInventory,
  vitestCases,
} from "./gauntlet-contract.mjs";
const faults = [
  {
    source: "src/components/register/credential-fields.tsx",
    from: "setDetails({",
    to: "void ({",
    file: "tests/unit/register-forms.test.tsx",
    name: "D11 type switches reset dates and metadata; owner changes preserve the draft",
  },
  {
    source: "src/components/register/register-panel.tsx",
    from: "cycle.action_deadline,",
    to: "null,",
    file: "tests/unit/register-forms.test.tsx",
    name: "D13 every date purpose and explicit unknown end remain visible for read-only records",
  },
  {
    source: "src/components/register/credential-fields.tsx",
    from: "coverage.filter((value) => value !== clinician.id)",
    to: "coverage",
    file: "tests/unit/register-forms.test.tsx",
    name: "G21 deselecting a covered clinician preserves the other policy choices",
  },
  {
    source: "src/components/team/invitation-link.tsx",
    from: 'setCopy("Link copied.");',
    to: 'setCopy("Incorrect feedback");',
    file: "tests/unit/team-forms.test.tsx",
    name: "S48 invitation copying confirms the exact link and offers keyboard fallback on rejection",
  },
  {
    source: "src/components/team/member-controls.tsx",
    from: 'role !== "administrator"',
    to: "false",
    file: "tests/unit/team-forms.test.tsx",
    name: "S35 cancelling administrator demotion prevents submission and confirmation preserves target version",
  },

  {
    source: "src/components/register/register-panel.tsx",
    from: "merged.get(value.id)!.version < value.version",
    to: "false",
    file: "tests/unit/register-maintenance-forms.test.tsx",
    name: "M13 uncertain and pending freeze exact payload cancellation intent and view; retry confirms without stale resurrection",
  },
  {
    source: "src/components/register/register-panel.tsx",
    from: "Boolean(record.archived_at) === archivedView",
    to: "true",
    file: "tests/unit/register-maintenance-forms.test.tsx",
    name: "M13 uncertain and pending freeze exact payload cancellation intent and view; retry confirms without stale resurrection",
  },
  {
    source: "src/components/register/edit-record-form.tsx",
    from: "const payload = frozen.current ?? form;",
    to: "const payload = form;",
    file: "tests/unit/register-maintenance-forms.test.tsx",
    name: "M13 exact edit retry cannot replace a newer authoritative record with a historical receipt",
  },
  {
    source: "src/components/register/edit-record-form.tsx",
    from: '"conflict",',
    to: '"ignored-conflict",',
    file: "tests/unit/register-maintenance-forms.test.tsx",
    name: "M12 definite errors retain draft and conflict requires explicit replacement and fresh tokens",
  },
];
export function mutationFailureEvidence(messages) {
  return messages.map((message) => ({
    assertionFailure: assertionFailure(message),
  }));
}
function execute(fault) {
  const output = "reports/ui-coverage-sensitivity-run.json";
  rmSync(output, { force: true });
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--project",
      "unit",
      fault.file,
      "--testNamePattern",
      RegExp.escape(fault.name) + "$",
      "--reporter=json",
      "--outputFile",
      output,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (run.error) throw run.error;
  const report = JSON.parse(readFileSync(output, "utf8"));
  return {
    run,
    cases: vitestCases(report).filter((row) => row.name === fault.name),
    failures: report.testResults
      .flatMap((row) => row.assertionResults)
      .filter((row) => row.fullName === fault.name)
      .flatMap((row) => row.failureMessages),
  };
}
export function uiCoverageSensitivity() {
  const results = [];
  for (const fault of faults) {
    const baseline = execute(fault);
    assert.equal(baseline.run.status, 0);
    assertInventory([fault.name], baseline.cases);
    const original = readFileSync(fault.source, "utf8");
    assert(original.includes(fault.from), "UI fault must apply");
    try {
      writeFileSync(fault.source, original.replace(fault.from, fault.to));
      assert.notEqual(readFileSync(fault.source, "utf8"), original);
      const result = execute(fault);
      assert.equal(result.run.status, 1);
      assert.deepEqual(result.cases, [{ name: fault.name, status: "failed" }]);
      assert(
        result.failures.some(assertionFailure),
        "UI fault must fail an assertion",
      );
      results.push({
        name: fault.name,
        exitCode: result.run.status,
        applied: true,
        killed: true,
        failures: mutationFailureEvidence(result.failures),
      });
    } finally {
      writeFileSync(fault.source, original);
      assert.equal(readFileSync(fault.source, "utf8"), original);
    }
    const restored = execute(fault);
    assert.equal(restored.run.status, 0);
    assertInventory([fault.name], restored.cases);
    results.at(-1).restored = true;
  }
  writeFileSync(
    "reports/ui-coverage-sensitivity.json",
    JSON.stringify(results, null, 2),
  );
  console.log(
    `${results.length} UI regression cases failed applied behavioral faults; source restored and cases passed again.`,
  );
}
