import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import {
  browserCases,
  assertBrowserFault,
  assertInventory,
} from "./gauntlet-contract.mjs";
export function assertRenewalMutationTargets(production, properties) {
  for (const [name, config, required] of [
    [
      "production",
      production,
      ["state", "schema", "repository", "operations", "messages", "history"]
        .map((n) => `src/lib/renewals/${n}.ts`)
        .concat("src/app/practice/register/[[]credentialId]/actions.ts"),
    ],
    [
      "properties",
      properties,
      [
        "src/lib/renewals/state.ts",
        "src/lib/renewals/schema.ts",
        "src/lib/renewals/history.ts",
      ],
    ],
  ]) {
    assert(
      Array.isArray(config?.mutate),
      `Missing renewal mutation target inventory: ${name}`,
    );
    for (const target of required)
      assert(
        config.mutate.includes(target),
        `Missing renewal mutation target: ${name}: ${target}`,
      );
  }
}
export function restoreControlCoverage(snapshots) {
  let changed = false;
  for (const { directory, files } of snapshots) {
    if (existsSync(directory))
      for (const name of readdirSync(directory))
        if (!files.has(name))
          rmSync(`${directory}/${name}`, { recursive: true, force: true });
    for (const [name, original] of files) {
      const path = `${directory}/${name}`;
      if (!existsSync(path) || !readFileSync(path).equals(original)) {
        changed = true;
        mkdirSync(directory, { recursive: true });
        writeFileSync(path, original);
      }
    }
  }
  assert.equal(changed, false, "Control changed existing coverage");
}
export async function withIsolatedCoverage(work, directories) {
  const snapshots = directories.map((directory) => ({
    directory,
    files: new Map(
      (existsSync(directory) ? readdirSync(directory) : []).map((name) => [
        name,
        readFileSync(`${directory}/${name}`),
      ]),
    ),
  }));
  try {
    return await work();
  } finally {
    restoreControlCoverage(snapshots);
  }
}
export async function focusSensitivity() {
  const file = "src/components/practice/practice-form.tsx",
    original = readFileSync(file, "utf8"),
    needle = "if (state.message) message.current?.focus();";
  assert.equal(
    original.split(needle).length,
    2,
    "Focus fault must match one actual defense",
  );
  const hash = createHash("sha256").update(original).digest("hex");
  mkdirSync("reports", { recursive: true });
  try {
    writeFileSync(
      file,
      original.replace(needle, "if (state.message) message.current?.blur();"),
    );
    const r = spawnSync(
      "npm",
      [
        "test",
        "--",
        "tests/unit/practice-form.test.tsx",
        "--testNamePattern",
        "S09 S15 invalid response retains input and focuses associated error",
      ],
      { encoding: "utf8" },
    );
    if (r.error) throw r.error;
    assert.equal(r.status, 1, "Missing-focus fault must fail");
    assert.match(`${r.stdout}\n${r.stderr}`, /AssertionError/);
    writeFileSync(
      "reports/renewal-focus-control.log",
      `${r.stdout}\n${r.stderr}`,
    );
  } finally {
    writeFileSync(file, original);
    assert.equal(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
      hash,
      "Focus source restores exactly",
    );
  }
  console.log(
    "The unchanged awaited focus assertion rejected an applied missing-focus fault; source restored exactly.",
  );
}
async function runRenewalBrowserSensitivity() {
  const file = "src/components/renewals/form.tsx",
    original = readFileSync(file, "utf8"),
    needle = "const payload = frozen.current ?? form;",
    name =
      "RW06 RW07 dropped real response retries exact payload and a newer saved read wins the old receipt";
  assert.equal(
    original.split(needle).length,
    2,
    "Browser frozen-payload fault must apply once",
  );
  const run = (args) => {
    const r = spawnSync("npm", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: `${process.cwd()}/.browser-cache`,
      },
    });
    if (r.error) throw r.error;
    return r;
  };
  const build = () => {
    const r = run(["run", "build"]);
    assert.equal(r.status, 0, "Browser fault build must succeed");
  };
  const execute = (id) => {
    const r = run([
      "run",
      "test:e2e",
      "--",
      "tests/e2e/practice-renewal-workflow.spec.ts",
      "--grep",
      name,
    ]);
    writeFileSync(
      `reports/renewal-browser-${id}.log`,
      `${r.stdout}\n${r.stderr}`,
    );
    return {
      r,
      report: JSON.parse(readFileSync("reports/browser-results.json", "utf8")),
    };
  };
  build();
  const baseline = execute("baseline");
  assert.equal(baseline.r.status, 0);
  assertInventory([name], browserCases(baseline.report));
  try {
    writeFileSync(file, original.replace(needle, "const payload = form;"));
    build();
    const fault = execute("fault"),
      cases = browserCases(fault.report),
      errors = [];
    function walk(suites) {
      for (const s of suites) {
        for (const spec of s.specs ?? [])
          for (const t of spec.tests ?? [])
            for (const r of t.results ?? []) errors.push(...(r.errors ?? []));
        walk(s.suites ?? []);
      }
    }
    walk(fault.report.suites);
    assertBrowserFault([name], cases, errors, fault.r.status);
  } finally {
    writeFileSync(file, original);
    assert.equal(readFileSync(file, "utf8"), original);
    build();
  }
  const restored = execute("restored");
  assert.equal(restored.r.status, 0);
  assertInventory([name], browserCases(restored.report));
  writeFileSync(
    "reports/renewal-browser-control.json",
    JSON.stringify(
      {
        name,
        applied: true,
        executed: true,
        killed: true,
        restored: true,
        baselinePassed: true,
        restoredPassed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Real browser rejected an applied missing-frozen-payload fault; source rebuilt and restored witness passed.",
  );
}
export async function renewalBrowserSensitivity() {
  await withIsolatedCoverage(runRenewalBrowserSensitivity, [
    "coverage/browser",
    "coverage/node",
  ]);
  console.log(
    "Browser control recordings excluded; prior runtime coverage preserved exactly.",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await focusSensitivity();
