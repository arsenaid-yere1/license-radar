import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCoverage } from "./check-coverage.mjs";
import { assertLocal } from "./local-environment.mjs";
import { assertLayers, assertMutant } from "./gauntlet-contract.mjs";
const fixtures = JSON.parse(
  readFileSync("tests/fixtures/gauntlet-controls/controls.json", "utf8"),
);
const covered = fixtures.covered;
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
