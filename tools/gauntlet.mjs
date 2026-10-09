import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sourceState } from "./source-state.mjs";
import { assertLayers } from "./gauntlet-contract.mjs";
const source = sourceState();
if (!process.version.startsWith("v24."))
  throw new Error("Gauntlet requires recorded Node 24 LTS");
const layers = JSON.parse(readFileSync("tools/layers.json", "utf8"));
const requiredLayers = [
  "checker-controls",
  "checker-sensitivity",
  "types",
  "lint",
  "format",
  "sql-lint",
  "access-upgrade",
  "recipient-upgrade",
  "register-upgrade",
  "credential-dates-upgrade",
  "register-maintenance-upgrade",
  "sms-enrollment-upgrade",
  "reminder-jobs-upgrade",
  "replay",
  "schema",
  "database",
  "integration",
  "unit-coverage",
  "mutation",
  "mutation-properties",
  "sql-mutants",
  "schema-restored",
  "generated-types",
  "build",
  "browser",
  "access-adversarial",
  "coverage",
  "suite-health-unit",
  "suite-health-integration",
  "suite-health-browser",
  "capabilities",
  "supply-chain",
  "secrets-history",
  "secrets-assets",
];
assertLayers(
  requiredLayers,
  layers.map((l) => ({ id: l.id, exitCode: 0 })),
);
rmSync("reports", { recursive: true, force: true });
rmSync("coverage", { recursive: true, force: true });
mkdirSync("reports", { recursive: true });
const result = {
  runId: randomUUID(),
  started: new Date().toISOString(),
  source,
  results: [],
  status: "running",
};
const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: `${process.cwd()}/.browser-cache`,
  TEST_SEED: "20261003",
  NO_COLOR: "1",
  GAUNTLET_RUN_ID: result.runId,
};
try {
  for (const layer of layers) {
    console.log(`Running ${layer.id}`);
    const start = Date.now();
    const r = spawnSync(layer.command, layer.args, {
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    writeFileSync(
      `reports/${layer.id}.log`,
      `${r.stdout ?? ""}\n${r.stderr ?? ""}`,
    );
    if (r.error || r.status !== 0) {
      result.failure = {
        id: layer.id,
        exitCode: r.status,
        message: r.error?.message,
      };
      throw new Error(
        `Gauntlet failed: ${layer.id}; see reports/${layer.id}.log`,
      );
    }
    result.results.push({
      id: layer.id,
      exitCode: r.status,
      durationMs: Date.now() - start,
    });
    writeFileSync("reports/gauntlet.json", JSON.stringify(result, null, 2));
    console.log(`Passed ${layer.id}`);
  }
  assertLayers(
    layers.map((l) => l.id),
    result.results,
  );
  const restored = sourceState();
  if (restored.sourceHash !== source.sourceHash)
    throw new Error("Source changed during gauntlet");
  result.status = "passed";
  result.finished = new Date().toISOString();
  console.log(`Gauntlet passed ${layers.length} required layers.`);
} catch (error) {
  result.status = "failed";
  throw error;
} finally {
  writeFileSync("reports/gauntlet.json", JSON.stringify(result, null, 2));
}
