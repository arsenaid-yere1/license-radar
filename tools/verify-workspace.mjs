import { assertPciVerification } from "./pci-controls.mjs";
import {
  assertHeartbeatLayers,
  assertHeartbeatMutationTargets,
} from "./heartbeat-controls.mjs";
import {
  assertGmailLayers,
  assertGmailMutationTargets,
} from "./gmail-controls.mjs";
import {
  assertEvidenceLayers,
  assertEvidenceMutationTargets,
} from "./evidence-controls.mjs";
import { assertCompletionLayer } from "./completion-controls.mjs";
import { assertNumberVerification } from "./number-controls.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { assertLayers } from "./gauntlet-contract.mjs";
import { assertRenewalMutationTargets } from "./renewal-controls.mjs";
import { assertRecoveryMutationTargets } from "./recovery-controls.mjs";
import production from "../stryker.config.mjs";
import properties from "../stryker.properties.config.mjs";
export const requiredWorkspaceLayers = [
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
  "reminder-catch-up-upgrade",
  "reminder-recovery-upgrade",
  "renewal-workflow-upgrade",
  "renewal-completion-upgrade",
  "renewal-evidence-upgrade",
  "evidence-storage",
  "evidence-controls",
  "gmail-reminders-upgrade",
  "credential-numbers-upgrade",
  "pci-certificates-upgrade",
  "gmail-controls",
  "gmail-oauth-controls",
  "heartbeat-controls",
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
export function workspaceSource() {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--deduplicate",
      "-z",
    ],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((f) => f && !f.startsWith("thoughts/"))
    .sort();
  const inputs = files.map((file) => ({
    file,
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  }));
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    sourceHash: createHash("sha256")
      .update(JSON.stringify(inputs))
      .digest("hex"),
    files: inputs.length,
    inputs,
    kind: "uncommitted-workspace",
  };
}
export function assertWorkspaceUnchanged(expected, actual) {
  assert.match(
    expected?.sourceHash ?? "",
    /^[a-f0-9]{64}$/,
    "Missing identified source",
  );
  assert.match(
    actual?.sourceHash ?? "",
    /^[a-f0-9]{64}$/,
    "Missing identified source",
  );
  assert.equal(
    actual.sourceHash,
    expected.sourceHash,
    "Workspace source changed during verification",
  );
}
export function assertWorkspaceLayers(layers) {
  assertLayers(
    requiredWorkspaceLayers,
    layers.map((l) => ({ id: l.id, exitCode: 0 })),
  );
}
async function main() {
  assert(
    process.version.startsWith("v24."),
    "Verification requires pinned Node 24",
  );
  assertRecoveryMutationTargets(production, properties);
  assertRenewalMutationTargets(production, properties);
  const layers = JSON.parse(readFileSync("tools/layers.json", "utf8"));
  assertNumberVerification(layers, production, properties);
  assertPciVerification(layers, production, properties);
  assertCompletionLayer(layers);
  assertEvidenceLayers(layers);
  assertEvidenceMutationTargets(production, properties);
  assertGmailLayers(layers);
  assertHeartbeatLayers(layers);
  assertHeartbeatMutationTargets(production, properties);
  assertGmailMutationTargets(production, properties);
  assertWorkspaceLayers(layers);
  const source = workspaceSource(),
    path = "reports/workspace-verification.json",
    resume = process.argv.includes("--resume");
  let result;
  if (resume) {
    assert(existsSync(path), "Missing source-bound run to resume");
    result = JSON.parse(readFileSync(path, "utf8"));
    assertWorkspaceUnchanged(result.source, source);
    assert.equal(
      JSON.stringify(result.layers),
      JSON.stringify(layers),
      "Layer commands changed",
    );
    assertLayers(
      result.results.map((r) => r.id),
      result.results,
    );
  } else {
    rmSync("reports", { recursive: true, force: true });
    rmSync("coverage", { recursive: true, force: true });
    mkdirSync("reports", { recursive: true });
    result = {
      runId: randomUUID(),
      started: new Date().toISOString(),
      source,
      layers,
      results: [],
      status: "running",
    };
  }
  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: `${process.cwd()}/.browser-cache`,
    TEST_SEED: "20261003",
    NO_COLOR: "1",
    GAUNTLET_RUN_ID: result.runId,
  };
  result.status = "running";
  delete result.failure;
  try {
    for (const layer of layers) {
      if (result.results.some((r) => r.id === layer.id)) continue;
      assertWorkspaceUnchanged(source, workspaceSource());
      console.log(`Running ${layer.id}`);
      const start = Date.now(),
        r = spawnSync(layer.command, layer.args, {
          env,
          encoding: "utf8",
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
          `Verification failed: ${layer.id}; see reports/${layer.id}.log`,
        );
      }
      assertWorkspaceUnchanged(source, workspaceSource());
      result.results.push({
        id: layer.id,
        exitCode: r.status,
        durationMs: Date.now() - start,
      });
      writeFileSync(path, JSON.stringify(result, null, 2));
      console.log(`Passed ${layer.id}`);
    }
    assertLayers(requiredWorkspaceLayers, result.results);
    assertWorkspaceUnchanged(source, workspaceSource());
    result.status = "passed";
    result.finished = new Date().toISOString();
    console.log(
      `All ${requiredWorkspaceLayers.length} registered layers passed on unchanged uncommitted source. The clean-commit gauntlet was not invoked.`,
    );
  } catch (error) {
    result.status = "failed";
    throw error;
  } finally {
    writeFileSync(path, JSON.stringify(result, null, 2));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
