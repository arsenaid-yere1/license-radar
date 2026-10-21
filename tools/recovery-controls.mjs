const recoveryTargets = [
  "src/lib/reminders/gmail-authorization.ts",
  "src/lib/reminders/gmail-config.ts",
  "src/lib/reminders/gmail-provider.ts",
  "src/lib/reminders/recovery.ts",
  "src/lib/reminders/recovery-worker.ts",
  "src/lib/reminders/history.ts",
  "src/app/practice/reminders/[[]credentialId]/actions.ts",
];
const propertyTargets = [
  "src/lib/reminders/gmail-authorization.ts",
  "src/lib/reminders/gmail-config.ts",
  "src/lib/reminders/gmail-provider.ts",
  "src/lib/reminders/schema.ts",
  "src/lib/reminders/recovery.ts",
  "src/lib/reminders/history.ts",
];
function assertTargets(config, required, name) {
  const targets = config?.mutate;
  if (!Array.isArray(targets) || targets.length === 0)
    throw new Error(`Missing recovery mutation inventory: ${name}`);
  if (
    targets.some((target) => typeof target !== "string" || target.length === 0)
  )
    throw new Error(`Invalid mutation target: ${name}`);
  if (new Set(targets).size !== targets.length)
    throw new Error(`Duplicate mutation target: ${name}`);
  for (const target of required)
    if (!targets.includes(target))
      throw new Error(`Missing recovery mutation target: ${name}: ${target}`);
  if (targets.some((target) => target.startsWith("!") || target.includes("*")))
    throw new Error(
      `Invalid mutation target: ${name}: exclusions and globs are not explicit inventories`,
    );
}
export function assertRecoveryMutationTargets(config, propertiesConfig) {
  assertTargets(config, recoveryTargets, "production");
  assertTargets(propertiesConfig, propertyTargets, "properties");
}
