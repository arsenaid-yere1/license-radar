import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  applicationSources,
  assertSmsCapabilities,
} from "./sms-capabilities.mjs";
import production from "../stryker.config.mjs";
import properties from "../stryker.properties.config.mjs";
const file = "src/lib/reminders/heartbeat.ts";
export function assertHeartbeatLayers(layers) {
  assert(Array.isArray(layers), "Missing heartbeat layer inventory");
  const matching = layers.filter((l) => l.id === "heartbeat-controls");
  assert.equal(matching.length, 1, "Missing/duplicate heartbeat layer");
  assert.deepEqual(
    matching[0],
    {
      id: "heartbeat-controls",
      command: "node",
      args: ["tools/heartbeat-controls.mjs"],
    },
    "Incorrect heartbeat gate command",
  );
}
export function assertHeartbeatMutationTargets(production, properties) {
  for (const config of [production, properties]) {
    assert(
      Array.isArray(config?.mutate),
      "Missing heartbeat mutation inventory",
    );
    assert(config.mutate.includes(file), "Missing heartbeat mutation target");
  }
}
export function assertHeartbeatCapabilities(files) {
  const source = files.get(file);
  assert(source, "Missing heartbeat server boundary");
  assert(
    source.includes('import "server-only"'),
    "Missing heartbeat server marker",
  );
  assert(!source.includes("NEXT_PUBLIC_"), "Public heartbeat setting");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let origins = 0;
  function visit(node) {
    if (ts.isStringLiteral(node) && node.text.startsWith("https://")) {
      // prettier-ignore
      assert.equal(node.text, "https://hc-ping.com/", "Unexpected heartbeat origin");
      origins++;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(origins, 1, "Missing fixed heartbeat origin");
}
function controls() {
  assertHeartbeatLayers(JSON.parse(readFileSync("tools/layers.json", "utf8")));
  assertHeartbeatMutationTargets(production, properties);
  const sources = applicationSources();
  assertHeartbeatCapabilities(sources);
  assertSmsCapabilities(sources);
  const result = spawnSync(
    process.execPath,
    ["--test", "tools/heartbeat-controls.test.mjs"],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `Heartbeat negative controls failed: ${result.stdout} ${result.stderr}`,
  );
  mkdirSync("reports", { recursive: true });
  writeFileSync(
    "reports/heartbeat-controls.json",
    JSON.stringify(
      {
        status: "passed",
        gate: true,
        mutationInventories: true,
        serverBoundary: true,
        negativeControls: true,
        removedOriginDefenseWitness: true,
        limits:
          "AST literal origin, explicit inventory and existing client-import graph checks cover these known violations, not all possible dataflow or future dynamic network constructions.",
      },
      null,
      2,
    ),
  );
  console.log(
    "Heartbeat gate, mutation inventories, server boundary and nonvacuous negative controls passed.",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  controls();
