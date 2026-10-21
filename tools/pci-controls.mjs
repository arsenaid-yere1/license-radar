import assert from "node:assert/strict";
import { assertInventory } from "./gauntlet-contract.mjs";
export function assertPciVerification(layers, production, properties) {
  const id = "pci-certificates-upgrade";
  assertInventory(
    [id],
    layers
      .filter((l) => l.id === id)
      .map((l) => ({ name: l.id, status: "passed" })),
  );
  assert.deepEqual(
    layers.find((l) => l.id === id),
    { id, command: "node", args: ["tools/pci-certificates-upgrade.mjs"] },
  );
  for (const config of [production, properties])
    assert(
      config.mutate.includes("src/lib/register/types.ts"),
      "Missing PCI shared type mutation target",
    );
}
