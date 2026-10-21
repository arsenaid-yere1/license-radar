import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  assertHeartbeatLayers,
  assertHeartbeatMutationTargets,
  assertHeartbeatCapabilities,
} from "./heartbeat-controls.mjs";
import {
  applicationSources,
  assertSmsCapabilities,
} from "./sms-capabilities.mjs";
const layer = {
  id: "heartbeat-controls",
  command: "node",
  args: ["tools/heartbeat-controls.mjs"],
};
test("SA07 exact heartbeat gate cannot be omitted, duplicated or replaced in either verifier", async () => {
  assert.doesNotThrow(() => assertHeartbeatLayers([layer]));
  for (const bad of [
    [],
    [layer, layer],
    [{ ...layer, args: [] }],
    [{ ...layer, command: "true" }],
  ])
    assert.throws(() => assertHeartbeatLayers(bad));
  assert.doesNotThrow(() =>
    assertHeartbeatLayers(
      JSON.parse(readFileSync("tools/layers.json", "utf8")),
    ),
  );
  const { requiredWorkspaceLayers } = await import("./verify-workspace.mjs");
  assert(requiredWorkspaceLayers.includes(layer.id));
  assert(
    readFileSync("tools/gauntlet.mjs", "utf8").includes('"heartbeat-controls"'),
  );
});
test("SA07 heartbeat source remains server-only, fixed origin and free of public settings", () => {
  const sources = applicationSources(),
    file = "src/lib/reminders/heartbeat.ts",
    original = sources.get(file);
  assert.doesNotThrow(() => assertHeartbeatCapabilities(sources));
  for (const altered of [
    original.replace('import "server-only";', ""),
    original.replace("https://hc-ping.com/", "https://attacker.invalid/"),
    original.replace(
      "REMINDER_HEALTHCHECK_URL",
      "NEXT_PUBLIC_REMINDER_HEALTHCHECK_URL",
    ),
  ]) {
    assert.notEqual(altered, original);
    assert.throws(() =>
      assertHeartbeatCapabilities(new Map(sources).set(file, altered)),
    );
  }
  assert.throws(() => assertHeartbeatCapabilities(new Map()));
  const bad = new Map(sources).set(
    "src/components/heartbeat-leak.tsx",
    '"use client"; import { reminderHeartbeat } from "@/lib/reminders/heartbeat"; export const leak=reminderHeartbeat;',
  );
  assert.throws(() => assertSmsCapabilities(bad));
});
test("SA07 both mutation suites and property boundary suite must retain the helper", async () => {
  const { default: production } = await import("../stryker.config.mjs"),
    { default: properties } = await import("../stryker.properties.config.mjs");
  assert.doesNotThrow(() =>
    assertHeartbeatMutationTargets(production, properties),
  );
  const without = (c) => ({
    ...c,
    mutate: c.mutate.filter((f) => f !== "src/lib/reminders/heartbeat.ts"),
  });
  assert.throws(() =>
    assertHeartbeatMutationTargets(without(production), properties),
  );
  assert.throws(() =>
    assertHeartbeatMutationTargets(production, without(properties)),
  );
  assert.throws(() => assertHeartbeatMutationTargets({}, properties));
  const suite = readFileSync("vitest.properties.config.ts", "utf8");
  for (const file of ["heartbeat-properties.test.ts", "heartbeat.test.ts"])
    assert(suite.includes(file));
});
test("SA07 removed origin defense makes its negative control fail", () => {
  const source = readFileSync("tools/heartbeat-controls.mjs", "utf8");
  const needle =
    'assert.equal(node.text, "https://hc-ping.com/", "Unexpected heartbeat origin");';
  assert.equal(
    source.split(needle).length,
    2,
    "Defense must be removed exactly once",
  );
  const broken = source
    .replace(needle, "assert(true);")
    .replace(
      'from "typescript"',
      `from ${JSON.stringify(import.meta.resolve("typescript"))}`,
    )
    .replaceAll(
      /from "(\.\.?\/[^"]+)"/g,
      (_, relative) =>
        `from "${new URL(relative, pathToFileURL(`${process.cwd()}/tools/heartbeat-controls.mjs`)).href}"`,
    );
  const script = `import assert from "node:assert/strict"; import {assertHeartbeatCapabilities} from ${JSON.stringify("data:text/javascript;base64," + Buffer.from(broken).toString("base64"))}; import {applicationSources} from ${JSON.stringify(pathToFileURL(`${process.cwd()}/tools/sms-capabilities.mjs`).href)}; const files=applicationSources(); const file="src/lib/reminders/heartbeat.ts"; files.set(file,files.get(file).replace("https://hc-ping.com/","https://attacker.invalid/")); assert.throws(()=>assertHeartbeatCapabilities(files));`;
  const result = spawnSync(process.execPath, ["--input-type=module"], {
    input: script,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing expected exception/);
});
