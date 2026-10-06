import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFixtureTarget, assertProject } from "./local-environment.mjs";
import {
  assertLayers,
  assertInventory,
  browserCases,
  vitestCases,
  assertArtifact,
  assertSchema,
  assertSnapshot,
  assertionFailure,
  assertBrowserFault,
} from "./gauntlet-contract.mjs";
import { verifyMap, assertCoverage } from "./check-coverage.mjs";

test("fixture target accepts empty and fixture-only data", () => {
  assert.doesNotThrow(() => assertFixtureTarget(0));
  assert.doesNotThrow(() =>
    assertProject('project_id = "license-radar-e1-s1"'),
  );
});
test("non-fixture reset target hard failure", () => {
  for (const n of [1, null, undefined, "0", -1, NaN])
    assert.throws(() => assertFixtureTarget(n), /Refusing/);
});
test("wrong project reset hard failure", () => {
  for (const c of [
    "",
    'project_id = "other"',
    'project_id = "license-radar-e1-s1"\nproject_id = "other"',
  ])
    assert.throws(() => assertProject(c), /Refusing/);
});
test("duplicate layer hard failure", () => {
  assert.throws(
    () =>
      assertLayers(
        ["types", "types"],
        [
          { id: "types", exitCode: 0 },
          { id: "types", exitCode: 0 },
        ],
      ),
    /Duplicate/,
  );
  assert.throws(
    () =>
      assertLayers(
        ["types", "browser"],
        [
          { id: "types", exitCode: 0 },
          { id: "types", exitCode: 0 },
        ],
      ),
    /Duplicate/,
  );
});
test("complete executed inventory accepted", () => {
  assert.doesNotThrow(() =>
    assertInventory(
      ["A01", "A02"],
      [
        { name: "A02", status: "passed" },
        { name: "A01", status: "passed" },
      ],
    ),
  );
});
test("empty incomplete duplicate skipped inventory hard failure", () => {
  for (const [expected, actual] of [
    [[], []],
    [["A01", "A02"], [{ name: "A01", status: "passed" }]],
    [
      ["A01", "A01"],
      [
        { name: "A01", status: "passed" },
        { name: "A01", status: "passed" },
      ],
    ],
    [
      ["A01", "A02"],
      [
        { name: "A01", status: "passed" },
        { name: "A01", status: "passed" },
      ],
    ],
    [["A01"], [{ name: "A01", status: "skipped" }]],
    [["A01"], [{ name: "A01", status: "pending" }]],
    [["A01"], []],
  ])
    assert.throws(() => assertInventory(expected, actual), /inventory/);
});
test("browser inventory detects retry skip and missing execution", () => {
  const report = (results) => ({
    suites: [{ specs: [{ title: "A01", tests: [{ results }] }] }],
  });
  assert.deepEqual(browserCases(report([{ status: "passed" }])), [
    { name: "A01", status: "passed" },
  ]);
  for (const results of [
    [],
    [{ status: "skipped" }],
    [{ status: "failed" }, { status: "passed" }],
  ])
    assert.throws(
      () => assertInventory(["A01"], browserCases(report(results))),
      /inventory/,
    );
});
test("Vitest inventory refuses missing assertion results", () => {
  assert.deepEqual(
    vitestCases({
      testResults: [
        { assertionResults: [{ fullName: "A01", status: "passed" }] },
      ],
    }),
    [{ name: "A01", status: "passed" }],
  );
  assert.throws(() => vitestCases({ testResults: [{}] }), /inventory/);
});
test("token-bearing retained artifact hard failure", () => {
  assert.doesNotThrow(() =>
    assertArtifact("safe redacted outcome", ["a".repeat(43)]),
  );
  assert.throws(
    () => assertArtifact("trace " + "a".repeat(43), ["a".repeat(43)]),
    /Token-bearing/,
  );
  assert.throws(
    () => assertArtifact("/join#token=anything", []),
    /Token-bearing/,
  );
});
test("incomplete statement coverage hard failure", () => {
  for (const count of [undefined, null, NaN, -1, "1"])
    assert.throws(
      () =>
        assertCoverage(
          {
            "src/example.ts": {
              statementMap: { 0: { start: { line: 1 } } },
              s: { 0: count },
            },
          },
          ["src/example.ts"],
        ),
      /Incomplete/,
    );
});
test("stale owned source map hard failure", () => {
  assert.throws(
    () =>
      verifyMap({
        sources: ["/workspace/src/lib/team/schema.ts"],
        sourcesContent: ["stale"],
      }),
    /Stale/,
  );
});
test("missing upgrade snapshot hard failure", () => {
  for (const snapshot of [
    null,
    {},
    { "public.practices": [], "private.practice_audit_events": [] },
  ])
    assert.throws(() => assertSnapshot(snapshot), /snapshot/);
  assert.doesNotThrow(() =>
    assertSnapshot({
      "public.practices": [{ id: "p" }],
      "private.practice_audit_events": [{ id: "event" }],
    }),
  );
});
test("schema grant policy index FK trigger drift hard failure", () => {
  const expected = Object.fromEntries(
    [
      "columns",
      "policies",
      "functions",
      "triggers",
      "grants",
      "rls",
      "constraints",
      "indexes",
      "schemas",
    ].map((name) => [name, [{ definition: name }]]),
  );
  assert.doesNotThrow(() => assertSchema(expected, expected));
  for (const key of Object.keys(expected))
    assert.throws(
      () => assertSchema({ ...expected, [key]: [] }, expected),
      /schema/i,
    );
});
test("mutation kill requires a behavioral assertion rather than an infrastructure error", () => {
  for (const message of [
    "AssertionError: expected false to be true",
    "Error: promise resolved instead of rejecting\n at _Assertion.__VITEST_REJECTS__",
  ])
    assert.equal(assertionFailure(message), true);
  for (const message of [
    "Error: Connection terminated unexpectedly",
    "SyntaxError: broken mutant",
    "Error: no tests found",
    "Error: promise resolved",
  ])
    assert.equal(assertionFailure(message), false);
});
test("browser mutation requires every named assertion failure", () => {
  const actual = [{ name: "A01", status: "failed" }],
    errors = [{ message: "Error: expect(locator).toBeVisible failed" }];
  assert.doesNotThrow(() => assertBrowserFault(["A01"], actual, errors, 1));
  for (const [names, cases, failures, code] of [
    [[], [], [], 1],
    [["A01"], [], errors, 1],
    [["A01"], [{ name: "A01", status: "passed" }], errors, 1],
    [["A01"], [{ name: "A01", status: "timedOut" }], errors, 1],
    [["A01"], actual, [], 1],
    [["A01"], actual, [{ message: "Connection closed" }], 1],
    [["A01"], actual, errors, 0],
  ])
    assert.throws(
      () => assertBrowserFault(names, cases, failures, code),
      /inventory|behavioral/,
    );
});
test("transactional catalog captures every schema section including function bodies and ACLs", async () => {
  const { catalog, schemaQueries } = await import("./schema-catalog.mjs");
  const calls = [];
  const result = await catalog({
    query: async (sql) => {
      calls.push(sql);
      return { rows: [{ definition: sql }] };
    },
  });
  assert.equal(calls.length, 9);
  assert.deepEqual(Object.keys(result), [
    "columns",
    "policies",
    "functions",
    "triggers",
    "grants",
    "rls",
    "constraints",
    "indexes",
    "schemas",
  ]);
  for (const [key, sql] of Object.entries(schemaQueries))
    assert.deepEqual(result[key], [{ definition: sql }]);
  assert.match(schemaQueries.functions, /pg_get_functiondef/);
  assert.match(schemaQueries.functions, /proacl/);
});
