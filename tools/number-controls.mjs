import assert from "node:assert/strict";
import { assertInventory } from "./gauntlet-contract.mjs";

export function assertNumberVerification(layers, production, properties) {
  const id = "credential-numbers-upgrade";
  assertInventory(
    [id],
    layers
      .filter((l) => l.id === id)
      .map((l) => ({ name: l.id, status: "passed" })),
  );
  assert.deepEqual(
    layers.find((l) => l.id === id),
    {
      id,
      command: "node",
      args: ["tools/credential-numbers-upgrade.mjs"],
    },
  );
  for (const config of [production, properties])
    assert(
      config.mutate.includes("src/lib/register/numbers.ts"),
      "Missing number validator mutation target",
    );
}
