import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCoverage } from "./check-coverage.mjs";
import { assertLocal } from "./local-environment.mjs";
import {
  assertArtifact,
  assertLayers,
  assertMutant,
} from "./gauntlet-contract.mjs";
const fixtures = JSON.parse(
  readFileSync("tests/fixtures/gauntlet-controls/controls.json", "utf8"),
);
const covered = fixtures.covered;
test("UI fault evidence retains assertion classification without invitation-bearing diagnostics", async () => {
  const { mutationFailureEvidence } =
    await import("./ui-coverage-sensitivity.mjs");
  const token = "fixture-invitation-capability";
  const evidence = mutationFailureEvidence([
    `AssertionError: expected status; DOM includes /join#token=${token}`,
    `unexpected transport failure ${token}`,
  ]);
  assert.doesNotThrow(() => assertArtifact(JSON.stringify(evidence), [token]));
  assert.deepEqual(evidence, [
    { assertionFailure: true },
    { assertionFailure: false },
  ]);
});
test("coverage accepts executed source", () =>
  assert.doesNotThrow(() => assertCoverage(covered, ["src/example.ts"])));
test("missing coverage hard failure", () =>
  assert.throws(
    () => assertCoverage({}, ["src/example.ts"]),
    /Missing coverage/,
  ));
test("uncovered changed line hard failure", () =>
  assert.throws(
    () =>
      assertCoverage(
        {
          ...covered,
          "src/example.ts": { ...covered["src/example.ts"], s: { 0: 0 } },
        },
        ["src/example.ts"],
      ),
    /Uncovered/,
  ));
test("hosted reset URL hard failure", () =>
  assert.throws(
    () =>
      assertLocal(
        "postgresql://postgres:password@project.supabase.co:55322/postgres",
        55322,
        "postgresql:",
      ),
    /Refusing/,
  ));
test("wrong localhost port hard failure", () =>
  assert.throws(
    () =>
      assertLocal(
        "postgresql://127.0.0.1:54322/postgres",
        55322,
        "postgresql:",
      ),
    /Refusing/,
  ));
test("known local endpoint accepted", () =>
  assert.doesNotThrow(() =>
    assertLocal("postgresql://127.0.0.1:55322/postgres", 55322, "postgresql:"),
  ));
test("missing required layer hard failure", () =>
  assert.throws(
    () => assertLayers(["types", "browser"], [{ id: "types", exitCode: 0 }]),
    /Missing layer/,
  ));
test("failed layer hard failure", () =>
  assert.throws(
    () => assertLayers(["types"], [{ id: "types", exitCode: 1 }]),
    /Failed layer/,
  ));
test("all required layers accepted", () =>
  assert.doesNotThrow(() =>
    assertLayers(["types"], [{ id: "types", exitCode: 0 }]),
  ));
test("nonexecuted mutant hard failure", () =>
  assert.throws(
    () =>
      assertMutant({
        applied: true,
        executed: false,
        killed: true,
        restored: true,
      }),
    /not executed/,
  ));
test("survived or unrestored mutant hard failure", () => {
  for (const result of [
    { applied: true, executed: true, killed: false, restored: true },
    { applied: true, executed: true, killed: true, restored: false },
  ])
    assert.throws(() => assertMutant(result), /Invalid mutant/);
});
test("actually killed/restored mutant accepted", () =>
  assert.doesNotThrow(() =>
    assertMutant({
      applied: true,
      executed: true,
      killed: true,
      restored: true,
    }),
  ));

test("register public tables occur in every filtered catalog section", async () => {
  const { schemaQueries } = await import("./schema-catalog.mjs");
  for (const section of [
    "columns",
    "policies",
    "triggers",
    "grants",
    "rls",
    "constraints",
    "indexes",
  ])
    for (const table of ["clinicians", "credentials", "policy_coverage"])
      assert(
        schemaQueries[section].includes(`'${table}'`),
        `${section} omits ${table}`,
      );
});

test("register fingerprint contains and detects removal of every table protection", () => {
  const contract = JSON.parse(
    readFileSync("tools/schema-contract.json", "utf8"),
  );
  for (const section of [
    "columns",
    "policies",
    "grants",
    "rls",
    "constraints",
    "indexes",
  ])
    for (const table of ["clinicians", "credentials", "policy_coverage"]) {
      const belongs = (row) =>
        [row.table_name, row.tablename, row.relname].includes(table);
      assert(
        contract[section].some(belongs),
        `${section} fingerprint omits ${table}`,
      );
      assert.throws(
        () =>
          assertSchema(
            {
              ...contract,
              [section]: contract[section].filter((row) => !belongs(row)),
            },
            contract,
          ),
        /schema/i,
      );
    }
});

test("coverage normalizes dot-segment source identities before bundled conversion", async () => {
  const { normalizeSourceMap } = await import("./check-coverage.mjs");
  const map = {
    version: 3,
    sources: [
      "webpack://fixture/./src/yes.ts",
      "webpack://fixture/./src/no.ts",
    ],
    sourcesContent: [
      "function yes() { return 1; }\nyes();",
      "function no() { return 2; }",
    ],
    names: [],
    mappings: "AAAA;ACAA;ADCA",
  };
  assert.deepEqual(normalizeSourceMap(map).sources, [
    "webpack://fixture/src/yes.ts",
    "webpack://fixture/src/no.ts",
  ]);
  assert.deepEqual(normalizeSourceMap(map).sourcesContent, map.sourcesContent);
});
test("bundled coverage attributes an uncalled function to its own source", async () => {
  const { convertCoverage } = await import("./check-coverage.mjs");
  const yes = "function yes() { return 1; }",
    no = "function no() { return 2; }",
    source = `${yes}\n${no}\nyes();`;
  const map = {
    version: 3,
    sources: [
      "webpack://fixture/./src/yes.ts",
      "webpack://fixture/./src/no.ts",
    ],
    sourcesContent: [`${yes}\nyes();`, no],
    names: [],
    mappings: "AAAA;ACAA;ADCA",
  };
  const functions = [
    {
      functionName: "",
      isBlockCoverage: true,
      ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
    },
    {
      functionName: "yes",
      isBlockCoverage: true,
      ranges: [{ startOffset: 0, endOffset: yes.length, count: 1 }],
    },
    {
      functionName: "no",
      isBlockCoverage: true,
      ranges: [
        {
          startOffset: yes.length + 1,
          endOffset: yes.length + 1 + no.length,
          count: 0,
        },
      ],
    },
  ];
  const output = await convertCoverage(
    "fixture-bundle.js",
    source,
    functions,
    map,
  );
  const entries = Object.entries(output),
    found = (name) =>
      entries.find(([file]) => file.endsWith(`/src/${name}.ts`));
  const a = found("yes"),
    b = found("no");
  assert(a && b, "Both mapped sources required");
  assert.doesNotThrow(() => assertCoverage({ [a[0]]: a[1] }, [a[0]]));
  assert.throws(() => assertCoverage({ [b[0]]: b[1] }, [b[0]]), /Uncovered/);
});

test("executable coverage uses AST statement lines rather than formatting continuations", async () => {
  const { assertExecutableCoverage } = await import("./check-coverage.mjs");
  const statement = (line) => ({ start: { line }, end: { line } });
  const raw = {
    "source.ts": {
      statementMap: { a: statement(2), b: statement(3), c: statement(4) },
      s: { a: 1, b: 0, c: 0 },
    },
  };
  const inventory = {
    "source.ts": { statementMap: { a: statement(2) }, s: { a: 1 } },
  };
  assert.deepEqual(assertExecutableCoverage(raw, inventory, ["source.ts"]), {
    lines: 1,
    covered: 1,
  });
  const withUncalledStatement = {
    "source.ts": {
      statementMap: { a: statement(2), b: statement(4) },
      s: { a: 1, b: 0 },
    },
  };
  assert.throws(
    () => assertExecutableCoverage(raw, withUncalledStatement, ["source.ts"]),
    /Uncovered.*\nsource.ts:4/s,
  );
  assert.throws(
    () => assertExecutableCoverage(raw, {}, ["source.ts"]),
    /Missing/,
  );
  assert.throws(
    () => assertExecutableCoverage({}, inventory, ["source.ts"]),
    /Missing/,
  );
  assert.throws(
    () =>
      assertExecutableCoverage(
        { "source.ts": { ...raw["source.ts"], s: { a: 1, b: null, c: 0 } } },
        inventory,
        ["source.ts"],
      ),
    /Incomplete/,
  );
});
