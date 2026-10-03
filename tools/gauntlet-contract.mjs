export function assertLayers(expected, results) {
  for (const id of expected) {
    const item = results.find((r) => r.id === id);
    if (!item) throw new Error(`Missing layer: ${id}`);
    if (item.exitCode !== 0) throw new Error(`Failed layer: ${id}`);
  }
  if (results.length !== expected.length)
    throw new Error("Unexpected layer count");
}
export function assertMutant(result) {
  if (result.executed !== true) throw new Error("Mutant not executed");
  if (
    result.applied !== true ||
    result.killed !== true ||
    result.restored !== true
  )
    throw new Error("Invalid mutant evidence");
}
