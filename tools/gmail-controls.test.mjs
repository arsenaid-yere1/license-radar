import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertGmailLayers,
  assertGmailMutationTargets,
  assertGmailCapabilities,
} from "./gmail-controls.mjs";
import {
  applicationSources,
  assertSmsCapabilities,
} from "./sms-capabilities.mjs";
const paths = [
  "gmail-reminders-upgrade",
  "gmail-controls",
  "gmail-oauth-controls",
];
const layers = paths.map((id) => ({
  id,
  command: "node",
  args: [`tools/${id}.mjs`],
}));
test("GM09 every exact Gmail gate is mandatory, unique and cannot be replaced", () => {
  assert.doesNotThrow(() => assertGmailLayers(layers));
  for (const id of paths) {
    assert.throws(() => assertGmailLayers(layers.filter((l) => l.id !== id)));
    assert.throws(() =>
      assertGmailLayers([...layers, layers.find((l) => l.id === id)]),
    );
    assert.throws(() =>
      assertGmailLayers(
        layers.map((l) => (l.id === id ? { ...l, args: ["skip"] } : l)),
      ),
    );
  }
});
test("GM08 Gmail server capabilities reject a client import and arbitrary provider origins", () => {
  const source = applicationSources();
  assert.doesNotThrow(() => assertGmailCapabilities(source));
  const bad = new Map(source);
  bad.set(
    "src/components/gmail-leak.tsx",
    '"use client";\nimport { googleJson } from "@/lib/reminders/gmail-authorization";\nexport function x(){return googleJson("identity",{},3000)}',
  );
  assert.throws(() => assertSmsCapabilities(bad));
  const altered = new Map(source);
  altered.set(
    "src/lib/reminders/gmail-authorization.ts",
    source
      .get("src/lib/reminders/gmail-authorization.ts")
      .replace(
        "https://oauth2.googleapis.com/token",
        "https://attacker.invalid/token",
      ),
  );
  assert.throws(() => assertGmailCapabilities(altered));
});
test("GM09 exact Gmail mutation targets must exist in production and properties inventories", async () => {
  const { default: production } = await import("../stryker.config.mjs"),
    { default: properties } = await import("../stryker.properties.config.mjs");
  assert.doesNotThrow(() => assertGmailMutationTargets(production, properties));
  for (const target of [
    "gmail-config",
    "gmail-provider",
    "gmail-authorization",
  ]) {
    const file = `src/lib/reminders/${target}.ts`;
    assert.throws(() =>
      assertGmailMutationTargets(
        { ...production, mutate: production.mutate.filter((t) => t !== file) },
        properties,
      ),
    );
  }
  assert.throws(() =>
    assertGmailMutationTargets(production, {
      ...properties,
      mutate: properties.mutate.filter(
        (t) => t !== "src/lib/reminders/gmail-authorization.ts",
      ),
    }),
  );
  const registered = JSON.parse(readFileSync("tools/layers.json", "utf8"));
  assert.doesNotThrow(() => assertGmailLayers(registered));
});
