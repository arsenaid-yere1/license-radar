import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  assertInventory,
  browserCases,
  vitestCases,
} from "./gauntlet-contract.mjs";
import { accessRedSensitivity } from "./access-red-sensitivity.mjs";

const suites = [
  {
    name: "api",
    command: "node_modules/.bin/vitest",
    args: [
      "run",
      "--project",
      "integration",
      "tests/integration/practice-access.test.ts",
      "tests/integration/practice-invitations.test.ts",
      "--testNamePattern",
      "^A0[1235]",
      "--reporter=json",
      "--outputFile=reports/access-attacks-api.json",
    ],
    file: "reports/access-attacks-api.json",
    parse: vitestCases,
    expected: [
      "A01 S33 all roles and guessed foreign IDs deny unauthorized team writes and private data",
      "A02 forged metadata and RPC actor fields never elevate verified staff",
      "A05 minimal roster and invitation errors expose no tokens or Auth metadata",
      "A03 S14 acceptance racing cancel has one serialized outcome and no stale capability",
      "A03 S14 acceptance racing reissue has one serialized outcome and no stale capability",
      "A03 S31 invitation issued exactly at revocation is unavailable",
      "A03 S25 accepted retry cannot reset current role and S30 cannot reactivate",
      "A03 S31 S32 S40 only explicit post-revocation reissue reactivates durable membership",
    ],
  },
  {
    name: "browser",
    command: "node_modules/.bin/playwright",
    args: ["test", "tests/e2e/practice-access-adversarial.spec.ts"],
    file: "reports/browser-results.json",
    parse: browserCases,
    expected: [
      "A04 markup invitation preview is text and foreign-Origin action cannot write",
      "A05 fragment token stays out of request URLs referrers and retained text artifacts",
    ],
  },
];
copyFileSync(
  "reports/browser-results.json",
  "reports/browser-results-full.json",
);
const results = [];
for (const suite of suites) {
  rmSync(suite.file, { force: true });
  const started = Date.now();
  const r = spawnSync(suite.command, suite.args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(
    `reports/access-attacks-${suite.name}.log`,
    `${r.stdout ?? ""}\n${r.stderr ?? ""}`,
  );
  if (r.error || r.status !== 0)
    throw new Error(`Adversarial ${suite.name} execution failed`);
  const report = JSON.parse(readFileSync(suite.file, "utf8"));
  // Vitest reports nonselected tests as pending: exclude only names outside the exact selection.
  const actual = suite.parse(report).filter((r) => /^A0[12345]/.test(r.name));
  assertInventory(suite.expected, actual);
  assert(readFileSync(suite.file, "utf8").length > 0);
  results.push({
    suite: suite.name,
    tests: actual,
    exitCode: r.status,
    started,
    runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
  });
  if (suite.name === "browser")
    copyFileSync(suite.file, "reports/access-attacks-browser.json");
}
writeFileSync(
  "reports/access-adversarial.json",
  JSON.stringify(
    {
      scenarios: ["A01", "A02", "A03", "A04", "A05"],
      results,
      limits:
        "Attacks use local fixture identities; artifact inspection checks generated tokens and concrete fragment links in retained text. Masked raster artifacts and disabled traces are checked through browser configuration/visual review, not exhaustive binary forensics.",
    },
    null,
    2,
  ),
);
console.log(
  "10 named API/browser adversarial cases passed with exact executed inventories.",
);
await accessRedSensitivity();
