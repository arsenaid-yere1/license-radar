export function assertionFailure(message) {
  return (
    /AssertionError/.test(message) ||
    (/promise resolved .*instead of rejecting/s.test(message) &&
      /__VITEST_REJECTS__/.test(message))
  );
}
export function assertSchema(actual, expected) {
  const sections = [
    "columns",
    "policies",
    "functions",
    "triggers",
    "grants",
    "rls",
    "constraints",
    "indexes",
    "schemas",
  ];
  if (
    sections.some(
      (name) =>
        !Array.isArray(actual?.[name]) ||
        !actual[name].length ||
        !Array.isArray(expected?.[name]) ||
        !expected[name].length,
    ) ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  )
    throw new Error("Fresh schema drift from recorded contract");
}
export function assertSnapshot(snapshot) {
  if (
    ["public.practices", "private.practice_audit_events"].some(
      (name) => !Array.isArray(snapshot?.[name]) || !snapshot[name].length,
    )
  )
    throw new Error("Missing upgrade snapshot");
}
export function assertInventory(expected, results) {
  const names = results.map((r) => r.name);
  if (
    !expected.length ||
    new Set(expected).size !== expected.length ||
    new Set(names).size !== names.length ||
    names.length !== expected.length ||
    expected.some((name) => !names.includes(name)) ||
    results.some((r) => r.status !== "passed")
  )
    throw new Error("Invalid executed test inventory");
}
export function browserCases(report, listing = false) {
  const cases = [];
  function walk(suites) {
    if (!Array.isArray(suites)) throw new Error("Missing browser inventory");
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        if (!Array.isArray(spec.tests) || spec.tests.length !== 1)
          throw new Error("Ambiguous browser inventory");
        const results = spec.tests[0].results;
        cases.push({
          name: spec.title,
          status: listing
            ? "listed"
            : results?.length === 1
              ? results[0].status
              : "unexecuted",
        });
      }
      walk(suite.suites ?? []);
    }
  }
  walk(report.suites);
  return cases;
}
export function vitestCases(report) {
  if (!Array.isArray(report.testResults))
    throw new Error("Missing Vitest inventory");
  return report.testResults.flatMap((r) => {
    if (!Array.isArray(r.assertionResults))
      throw new Error("Missing assertion inventory");
    return r.assertionResults.map((a) => ({
      name: a.fullName,
      status: a.status,
    }));
  });
}
export function assertArtifact(content, tokens) {
  if (
    tokens.some((token) => content.includes(token)) ||
    /\/join#token=/.test(content)
  )
    throw new Error("Token-bearing retained artifact");
}
export function assertLayers(expected, results) {
  if (
    new Set(expected).size !== expected.length ||
    new Set(results.map((r) => r.id)).size !== results.length
  )
    throw new Error("Duplicate layer");
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
export function assertBrowserFault(expected, actual, errors, exitCode) {
  assertInventory(
    expected,
    actual.map((r) => ({
      name: r.name,
      status: r.status === "failed" ? "passed" : "unexecuted",
    })),
  );
  if (
    exitCode !== 1 ||
    errors.length < expected.length ||
    errors.some((e) => !/expect\(/.test(e.message ?? ""))
  )
    throw new Error("Browser fault requires named behavioral assertions");
}
