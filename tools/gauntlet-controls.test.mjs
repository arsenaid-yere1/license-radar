import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { assertCoverage } from "./check-coverage.mjs";
import { assertLocal } from "./local-environment.mjs";
import {
  assertArtifact,
  assertSchema,
  assertLayers,
  assertMutant,
} from "./gauntlet-contract.mjs";
const fixtures = JSON.parse(
  readFileSync("tests/fixtures/gauntlet-controls/controls.json", "utf8"),
);
const covered = fixtures.covered;
test("number verification rejects missing/duplicate/changed execution and omitted mutation targets", async () => {
  const { assertNumberVerification } = await import("./number-controls.mjs");
  const { default: production } = await import("../stryker.config.mjs");
  const { default: properties } =
    await import("../stryker.properties.config.mjs");
  const layers = JSON.parse(readFileSync("tools/layers.json", "utf8"));
  const id = "credential-numbers-upgrade",
    layer = layers.find((l) => l.id === id);
  assert.doesNotThrow(() =>
    assertNumberVerification(layers, production, properties),
  );
  for (const bad of [
    layers.filter((l) => l.id !== id),
    [...layers, layer],
    layers.map((l) => (l.id === id ? { ...l, args: [] } : l)),
  ])
    assert.throws(() => assertNumberVerification(bad, production, properties));
  for (const propertyOnly of [false, true]) {
    const original = propertyOnly ? properties : production;
    const changed = {
      ...original,
      mutate: original.mutate.filter(
        (p) => p !== "src/lib/register/numbers.ts",
      ),
    };
    assert.throws(
      () =>
        assertNumberVerification(
          layers,
          propertyOnly ? production : changed,
          propertyOnly ? changed : properties,
        ),
      /Missing number validator/,
    );
  }
});
test("browser controls discard their recordings preserve original coverage and reject tampering even on failure", async () => {
  const { withIsolatedCoverage } = await import("./renewal-controls.mjs"),
    root = mkdtempSync(`${tmpdir()}/renewal-coverage-control-`),
    directories = [`${root}/browser`, `${root}/node`];
  try {
    for (const d of directories) {
      mkdirSync(d);
      writeFileSync(`${d}/original.json`, "original");
    }
    const make = () => {
      for (const d of directories) writeFileSync(`${d}/fault.json`, "fault");
    };
    assert.equal(
      await withIsolatedCoverage(() => {
        make();
        return "proved";
      }, directories),
      "proved",
    );
    for (const d of directories) {
      assert.deepEqual(readdirSync(d), ["original.json"]);
      assert.equal(readFileSync(`${d}/original.json`, "utf8"), "original");
    }
    await assert.rejects(
      withIsolatedCoverage(() => {
        make();
        throw new Error("fixture failure");
      }, directories),
      /fixture failure/,
    );
    for (const d of directories)
      assert.deepEqual(readdirSync(d), ["original.json"]);
    await assert.rejects(
      withIsolatedCoverage(() => {
        writeFileSync(`${directories[0]}/original.json`, "tampered");
      }, directories),
      /Control changed existing coverage/,
    );
    assert.equal(
      readFileSync(`${directories[0]}/original.json`, "utf8"),
      "original",
    );
    await assert.rejects(
      withIsolatedCoverage(() => {}, [`${directories[0]}/original.json`]),
      /ENOTDIR/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("uncommitted verification refuses source drift missing layers duplicates and failed evidence", async () => {
  const {
    assertWorkspaceUnchanged,
    assertWorkspaceLayers,
    requiredWorkspaceLayers,
  } = await import("./verify-workspace.mjs");
  assert.doesNotThrow(() =>
    assertWorkspaceUnchanged(
      { sourceHash: "a".repeat(64) },
      { sourceHash: "a".repeat(64) },
    ),
  );
  assert.throws(
    () =>
      assertWorkspaceUnchanged(
        { sourceHash: "a".repeat(64) },
        { sourceHash: "b".repeat(64) },
      ),
    /Workspace source changed/,
  );
  const layers = requiredWorkspaceLayers.map((id) => ({ id }));
  assert.throws(
    () => assertWorkspaceUnchanged({}, {}),
    /Missing identified source/,
  );
  assert.equal(layers.length, 47);
  assert.doesNotThrow(() => assertWorkspaceLayers(layers));
  for (const id of requiredWorkspaceLayers)
    assert.throws(
      () => assertWorkspaceLayers(layers.filter((l) => l.id !== id)),
      /Missing layer/,
    );
  assert.throws(
    () => assertWorkspaceLayers([...layers, layers[0]]),
    /Duplicate layer/,
  );
});
test("renewal upgrade and mutation inventories reject every omitted target", async () => {
  const { assertRenewalMutationTargets } =
    await import("./renewal-controls.mjs");
  const { default: production } = await import("../stryker.config.mjs");
  const { default: properties } =
    await import("../stryker.properties.config.mjs");
  assert.doesNotThrow(() =>
    assertRenewalMutationTargets(production, properties),
  );
  for (const target of [
    "src/lib/renewals/history.ts",
    "src/lib/renewals/state.ts",
    "src/lib/renewals/schema.ts",
    "src/lib/renewals/repository.ts",
    "src/lib/renewals/operations.ts",
    "src/lib/renewals/messages.ts",
    "src/app/practice/register/[[]credentialId]/actions.ts",
  ]) {
    assert.throws(
      () =>
        assertRenewalMutationTargets(
          {
            ...production,
            mutate: production.mutate.filter((t) => t !== target),
          },
          properties,
        ),
      /Missing renewal mutation target/,
    );
  }
  for (const target of [
    "src/lib/renewals/history.ts",
    "src/lib/renewals/state.ts",
    "src/lib/renewals/schema.ts",
  ])
    assert.throws(
      () =>
        assertRenewalMutationTargets(production, {
          ...properties,
          mutate: properties.mutate.filter((t) => t !== target),
        }),
      /Missing renewal mutation target/,
    );
  const layers = JSON.parse(readFileSync("tools/layers.json", "utf8"));
  assert(
    readFileSync("tools/gauntlet.mjs", "utf8").includes(
      '"renewal-workflow-upgrade"',
    ),
  );
  assert.deepEqual(
    layers.find((l) => l.id === "renewal-workflow-upgrade"),
    {
      id: "renewal-workflow-upgrade",
      command: "node",
      args: ["tools/renewal-workflow-upgrade.mjs"],
    },
  );
  assert.throws(
    () =>
      assertLayers(
        layers.map((l) => l.id),
        layers
          .filter((l) => l.id !== "renewal-workflow-upgrade")
          .map((l) => ({ id: l.id, exitCode: 0 })),
      ),
    /Missing layer/,
  );
});
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
test("browser coverage resolves encoded dynamic routes and refuses escaped bundle paths", async () => {
  const { browserCompiledPath } = await import("./check-coverage.mjs");
  assert.equal(
    browserCompiledPath(
      "http://127.0.0.1:3000/_next/static/chunks/app/practice/reminders/%5BcredentialId%5D/page.js",
    ),
    resolve(
      ".next/static/chunks/app/practice/reminders/[credentialId]/page.js",
    ),
  );
  assert.equal(
    browserCompiledPath("http://127.0.0.1:3000/_next/static/chunks/main.js"),
    resolve(".next/static/chunks/main.js"),
  );
  assert.throws(
    () =>
      browserCompiledPath(
        "http://127.0.0.1:3000/_next/static/%2e%2e%2f%2e%2e%2fsecret.js",
      ),
    /Escaped browser bundle path/,
  );
  assert.throws(
    () => browserCompiledPath("http://127.0.0.1:3000/other/main.js"),
    /Unexpected browser bundle path/,
  );
  assert.throws(
    () => browserCompiledPath("http://127.0.0.1:3000/_next/static/%ZZ.js"),
    URIError,
  );
});
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
    for (const table of [
      "clinicians",
      "credentials",
      "policy_coverage",
      "credential_cycles",
    ])
      assert(
        schemaQueries[section].includes(`'${table}'`),
        `${section} omits ${table}`,
      );
});

test("register fingerprint contains and detects removal of every table protection", () => {
  const contract = JSON.parse(
    readFileSync("tools/schema-contract.json", "utf8"),
  );
  assert.doesNotThrow(() => assertSchema(structuredClone(contract), contract));
  for (const section of [
    "columns",
    "policies",
    "grants",
    "rls",
    "constraints",
    "indexes",
  ])
    for (const table of [
      "clinicians",
      "credentials",
      "policy_coverage",
      "credential_cycles",
    ]) {
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
        { message: "Fresh schema drift from recorded contract" },
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

test("cycle trigger and detailed RPC fingerprint protections are witnessed", () => {
  const contract = JSON.parse(
    readFileSync("tools/schema-contract.json", "utf8"),
  );
  for (const [section, name] of [
    ["triggers", "initialize_credential_cycle"],
    ["functions", "create_practice_credential_with_details"],
    ["functions", "credential_date"],
    ["functions", "credential_details_projection"],
  ]) {
    const belongs = (row) => [row.tgname, row.proname].includes(name);
    assert(contract[section].some(belongs), `${section} missing ${name}`);
    assert.throws(
      () =>
        assertSchema(
          {
            ...contract,
            [section]: contract[section].filter((row) => !belongs(row)),
          },
          contract,
        ),
      { message: "Fresh schema drift from recorded contract" },
    );
  }
});

test("maintenance fingerprint detects removed receipt storage archive field and every helper", () => {
  const contract = JSON.parse(
    readFileSync("tools/schema-contract.json", "utf8"),
  );
  for (const section of [
    "columns",
    "grants",
    "rls",
    "constraints",
    "indexes",
  ]) {
    const belongs = (row) =>
      [row.table_name, row.tablename, row.relname].includes(
        "register_change_requests",
      );
    assert(
      contract[section].some(belongs),
      `${section} omits new private receipts`,
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
      /Fresh schema drift/,
    );
  }
  const archived = (row) =>
    row.table_name === "credentials" && row.column_name === "archived_at";
  assert(contract.columns.some(archived));
  assert.throws(
    () =>
      assertSchema(
        {
          ...contract,
          columns: contract.columns.filter((row) => !archived(row)),
        },
        contract,
      ),
    /Fresh schema drift/,
  );
  for (const name of [
    "credential_maintenance_projection",
    "duplicate_text",
    "credential_duplicate_ids",
    "credential_change_values",
    "register_change_replay",
    "finish_register_change",
    "apply_credential_change",
    "update_practice_credential",
    "archive_practice_credential",
    "list_practice_register_with_maintenance",
  ]) {
    assert(
      contract.functions.some((row) => row.proname === name),
      name,
    );
    assert.throws(
      () =>
        assertSchema(
          {
            ...contract,
            functions: contract.functions.filter((row) => row.proname !== name),
          },
          contract,
        ),
      /Fresh schema drift/,
    );
  }
});

test("catch-up upgrade is mandatory in both gauntlet inventories", () => {
  const layers = JSON.parse(readFileSync("tools/layers.json", "utf8"));
  const gauntlet = readFileSync("tools/gauntlet.mjs", "utf8");
  assert(layers.some((l) => l.id === "reminder-catch-up-upgrade"));
  assert(gauntlet.includes('"reminder-catch-up-upgrade"'));
  const required = layers.map((l) => l.id);
  assert.throws(
    () =>
      assertLayers(
        required,
        layers
          .filter((l) => l.id !== "reminder-catch-up-upgrade")
          .map((l) => ({ id: l.id, exitCode: 0 })),
      ),
    /Missing layer/,
  );
});

test("recovery upgrade is mandatory and omission fails even when every other layer passes", () => {
  const layers = JSON.parse(readFileSync("tools/layers.json", "utf8"));
  const gauntlet = readFileSync("tools/gauntlet.mjs", "utf8");
  const upgrade = layers.find(
    (layer) => layer.id === "reminder-recovery-upgrade",
  );
  assert(upgrade, "Missing recovery upgrade in executable layer inventory");
  assert(
    gauntlet.includes('"reminder-recovery-upgrade"'),
    "Missing recovery upgrade in required inventory",
  );
  assert.equal(upgrade.command, "node");
  assert.deepEqual(upgrade.args, ["tools/reminder-recovery-upgrade.mjs"]);
  assert.throws(
    () =>
      assertLayers(
        layers.map((layer) => layer.id),
        layers
          .filter((layer) => layer.id !== "reminder-recovery-upgrade")
          .map((layer) => ({ id: layer.id, exitCode: 0 })),
      ),
    /Missing layer: reminder-recovery-upgrade/,
  );
  assert.doesNotThrow(() =>
    assertLayers(
      layers.map((layer) => layer.id),
      layers.map((layer) => ({ id: layer.id, exitCode: 0 })),
    ),
  );
});

test("completion upgrade rejects missing duplicate and changed execution", async () => {
  const { assertCompletionLayer } = await import("./completion-controls.mjs"),
    layers = JSON.parse(readFileSync("tools/layers.json", "utf8"));
  assert.doesNotThrow(() => assertCompletionLayer(layers));
  assert.throws(() =>
    assertCompletionLayer(
      layers.filter((l) => l.id !== "renewal-completion-upgrade"),
    ),
  );
  assert.throws(() =>
    assertCompletionLayer([
      ...layers,
      layers.find((l) => l.id === "renewal-completion-upgrade"),
    ]),
  );
  assert.throws(() =>
    assertCompletionLayer(
      layers.map((l) =>
        l.id === "renewal-completion-upgrade" ? { ...l, args: [] } : l,
      ),
    ),
  );
});

test("PCI verification rejects omitted duplicate changed layer and missing shared mutation target", async () => {
  const { assertPciVerification } = await import("./pci-controls.mjs");
  const { default: production } = await import("../stryker.config.mjs"),
    { default: properties } = await import("../stryker.properties.config.mjs");
  const layers = JSON.parse(readFileSync("tools/layers.json", "utf8"));
  const layer = {
    id: "pci-certificates-upgrade",
    command: "node",
    args: ["tools/pci-certificates-upgrade.mjs"],
  };
  const valid = [...layers.filter((l) => l.id !== layer.id), layer];
  const prod = {
    ...production,
    mutate: [...production.mutate, "src/lib/register/types.ts"],
  };
  const props = {
    ...properties,
    mutate: [...properties.mutate, "src/lib/register/types.ts"],
  };
  assert.doesNotThrow(() => assertPciVerification(valid, prod, props));
  for (const bad of [
    valid.filter((l) => l.id !== layer.id),
    [...valid, layer],
    valid.map((l) => (l.id === layer.id ? { ...l, args: [] } : l)),
  ])
    assert.throws(() => assertPciVerification(bad, prod, props));
  for (const which of [0, 1]) {
    const configs = [prod, props].map((c) => ({ ...c, mutate: [...c.mutate] }));
    configs[which].mutate = configs[which].mutate.filter(
      (t) => t !== "src/lib/register/types.ts",
    );
    assert.throws(
      () => assertPciVerification(valid, ...configs),
      /Missing PCI/,
    );
  }
});
