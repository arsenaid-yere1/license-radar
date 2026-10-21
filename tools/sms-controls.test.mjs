import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSmsCapabilities } from "./sms-capabilities.mjs";
import { assertRecoveryMutationTargets } from "./recovery-controls.mjs";
import mutationConfig from "../stryker.config.mjs";
import propertiesConfig from "../stryker.properties.config.mjs";
import { FileMatcher } from "../node_modules/@stryker-mutator/core/dist/src/config/file-matcher.js";
const boundary = "src/lib/sms/privileged-repository.ts";
function sources(other = "") {
  return new Map([
    [boundary, 'import "server-only";\nexport async function claimSend() {}'],
    ["src/app/client.tsx", '"use client";\n' + other],
  ]);
}
test("SMS checker accepts the constrained server boundary", () =>
  assertSmsCapabilities(sources()));
test("SMS checker rejects leaked client secrets", () =>
  assert.throws(
    () => assertSmsCapabilities(sources("process.env.NEXT_PUBLIC_SMS_SECRET")),
    /SMS public secret\/authority/,
  ));
test("SMS checker rejects secret use outside the exact module", () =>
  assert.throws(
    () => assertSmsCapabilities(sources("process.env.SUPABASE_SECRET_KEY")),
    /outside privileged boundary/,
  ));
test("SMS checker rejects direct and indirect client imports", () => {
  assert.throws(
    () =>
      assertSmsCapabilities(
        sources('import {claimSend} from "@/lib/sms/privileged-repository"'),
      ),
    /client reaches server capability/,
  );
  const files = sources('import {bridge} from "@/lib/sms/bridge"');
  files.set(
    "src/lib/sms/bridge.ts",
    'export {claimSend as bridge} from "./privileged-repository"',
  );
  assert.throws(
    () => assertSmsCapabilities(files),
    /client reaches server capability/,
  );
});
test("SMS checker rejects raw/generic exports and missing markers", () => {
  for (const source of [
    "export function claimSend() {}",
    'import "server-only"; export const client = {};',
    'import "server-only"; export function rpc() {}',
    'import "server-only"; export { client };',
    'import "server-only"; export default {};',
  ]) {
    const files = sources();
    files.set(boundary, source);
    assert.throws(
      () => assertSmsCapabilities(files),
      /marker missing|raw\/generic privileged export/,
    );
  }
});
test("SMS checker fails closed for missing source", () => {
  assert.throws(() => assertSmsCapabilities(new Map()), /boundary missing/);
  assert.throws(
    () => assertSmsCapabilities(sources('import "./missing"')),
    /unresolved client import/,
  );
});
test("Email named operations cannot cross the client boundary", () => {
  const files = sources(
    'import {beginReminderSubmission} from "@/lib/sms/privileged-repository"',
  );
  files.set(
    boundary,
    'import "server-only"; export async function beginReminderSubmission() {}',
  );
  assert.throws(
    () => assertSmsCapabilities(files),
    /client reaches server capability/,
  );
  assert.throws(
    () =>
      assertSmsCapabilities(sources("process.env.NEXT_PUBLIC_RESEND_API_KEY")),
    /public secret\/authority/,
  );
});

test("Recovery named operations stay server only; arbitrary recovery export fails", () => {
  const files = sources(
    'import {beginReminderRecovery} from "@/lib/sms/privileged-repository"',
  );
  files.set(
    boundary,
    'import "server-only"; export async function beginReminderRecovery() {}',
  );
  assert.throws(
    () => assertSmsCapabilities(files),
    /client reaches server capability/,
  );
  files.set("src/app/client.tsx", '"use client";');
  files.set(
    boundary,
    'import "server-only"; export async function retryArbitraryEmail() {}',
  );
  assert.throws(
    () => assertSmsCapabilities(files),
    /raw\/generic privileged export/,
  );
});

const requiredRecoveryTargets = [
  "src/lib/reminders/recovery.ts",
  "src/lib/reminders/recovery-worker.ts",
  "src/lib/reminders/history.ts",
  "src/app/practice/reminders/[[]credentialId]/actions.ts",
];
const requiredRecoveryProperties = [
  "src/lib/reminders/schema.ts",
  "src/lib/reminders/recovery.ts",
  "src/lib/reminders/history.ts",
];
test("recovery mutation control accepts both complete inherited inventories", () => {
  assert.doesNotThrow(() =>
    assertRecoveryMutationTargets(mutationConfig, propertiesConfig),
  );
  assert.doesNotThrow(() =>
    assertRecoveryMutationTargets(
      { ...mutationConfig, mutate: [...mutationConfig.mutate].reverse() },
      { ...propertiesConfig, mutate: [...propertiesConfig.mutate].reverse() },
    ),
  );
});
test("recovery mutation control rejects each omitted production target", () => {
  for (const target of requiredRecoveryTargets)
    assert.throws(
      () =>
        assertRecoveryMutationTargets(
          {
            ...mutationConfig,
            mutate: mutationConfig.mutate.filter((path) => path !== target),
          },
          propertiesConfig,
        ),
      /Missing recovery mutation target/,
    );
});
test("recovery property control rejects each omitted parser target", () => {
  for (const target of requiredRecoveryProperties)
    assert.throws(
      () =>
        assertRecoveryMutationTargets(mutationConfig, {
          ...propertiesConfig,
          mutate: propertiesConfig.mutate.filter((path) => path !== target),
        }),
      /Missing recovery mutation target/,
    );
});
test("recovery mutation control rejects duplicate targets in either inventory", () => {
  for (const target of [
    ...requiredRecoveryTargets,
    "src/lib/practice/schema.ts",
  ])
    assert.throws(
      () =>
        assertRecoveryMutationTargets(
          { ...mutationConfig, mutate: [...mutationConfig.mutate, target] },
          propertiesConfig,
        ),
      /Duplicate mutation target/,
    );
  for (const target of [
    ...requiredRecoveryProperties,
    "src/lib/practice/schema.ts",
  ])
    assert.throws(
      () =>
        assertRecoveryMutationTargets(mutationConfig, {
          ...propertiesConfig,
          mutate: [...propertiesConfig.mutate, target],
        }),
      /Duplicate mutation target/,
    );
});
test("recovery mutation control requires exact paths rather than glob or exclusion substitutes", () => {
  for (const alternate of [
    "src/lib/reminders/**",
    "!src/lib/reminders/recovery.ts",
    "./src/lib/reminders/recovery.ts",
    "src/lib/reminders/recovery.ts ",
  ])
    assert.throws(
      () =>
        assertRecoveryMutationTargets(
          {
            ...mutationConfig,
            mutate: mutationConfig.mutate.map((target) =>
              target === requiredRecoveryTargets[0] ? alternate : target,
            ),
          },
          propertiesConfig,
        ),
      /Missing recovery mutation target/,
    );
});
test("recovery mutation control fails closed for absent or malformed inventories", () => {
  for (const config of [
    null,
    undefined,
    {},
    { mutate: null },
    { mutate: "src/lib/reminders/**" },
    { mutate: [] },
    { mutate: [null] },
    { mutate: [""] },
  ]) {
    assert.throws(
      () => assertRecoveryMutationTargets(config, propertiesConfig),
      /mutation inventory|mutation target/,
    );
    assert.throws(
      () => assertRecoveryMutationTargets(mutationConfig, config),
      /mutation inventory|mutation target/,
    );
  }
});

test("recovery mutation control rejects an extra exclusion or glob even when exact required targets are present", () => {
  for (const alternate of [
    "!src/lib/reminders/recovery.ts",
    "src/lib/reminders/**",
  ])
    for (const kind of ["production", "properties"])
      assert.throws(
        () =>
          assertRecoveryMutationTargets(
            kind === "production"
              ? {
                  ...mutationConfig,
                  mutate: [...mutationConfig.mutate, alternate],
                }
              : mutationConfig,
            kind === "properties"
              ? {
                  ...propertiesConfig,
                  mutate: [...propertiesConfig.mutate, alternate],
                }
              : propertiesConfig,
          ),
        /Invalid mutation target/,
      );
});

test("recovery mutation target uses a bracket class that the actual Stryker matcher resolves to the literal action file", () => {
  const literal = "src/app/practice/reminders/[credentialId]/actions.ts";
  const escaped = "src/app/practice/reminders/\\[credentialId\\]/actions.ts";
  const pattern = "src/app/practice/reminders/[[]credentialId]/actions.ts";
  const replaceRoute = (pattern) => ({
    ...mutationConfig,
    mutate: mutationConfig.mutate.map((target) =>
      target === literal ||
      target === escaped ||
      target === requiredRecoveryTargets[3]
        ? pattern
        : target,
    ),
  });
  assert.equal(
    new FileMatcher(literal).matches(literal),
    false,
    "Raw brackets are a glob character class and omit the action",
  );
  assert.equal(
    new FileMatcher(escaped).matches(literal),
    false,
    "Stryker normalizes backslashes into path separators",
  );
  assert.equal(
    new FileMatcher(pattern).matches(literal),
    true,
    "Bracket-class escaping includes the literal route action",
  );
  for (const incorrect of [literal, escaped])
    assert.throws(
      () =>
        assertRecoveryMutationTargets(
          replaceRoute(incorrect),
          propertiesConfig,
        ),
      /Missing recovery mutation target/,
    );
  assert.doesNotThrow(() =>
    assertRecoveryMutationTargets(replaceRoute(pattern), propertiesConfig),
  );
});
