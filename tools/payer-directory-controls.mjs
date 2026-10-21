import assert from "node:assert/strict";
import { assertInventory } from "./gauntlet-contract.mjs";
export function assertPayerDirectoryVerification(
  layers,
  production,
  properties,
) {
  const id = "payer-directories-upgrade";
  assertInventory(
    [id],
    layers
      .filter((l) => l.id === id)
      .map((l) => ({ name: l.id, status: "passed" })),
  );
  assert.deepEqual(
    layers.find((l) => l.id === id),
    { id, command: "node", args: ["tools/payer-directories-upgrade.mjs"] },
  );
  for (const config of [production, properties])
    for (const file of [
      "src/lib/register/types.ts",
      "src/lib/register/dates.ts",
      "src/lib/register/numbers.ts",
      "src/lib/calendar/events.ts",
    ])
      assert(
        config.mutate.includes(file),
        `Missing directory mutation target: ${file}`,
      );
}
