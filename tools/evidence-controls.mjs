import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { localConfig, fixtureGuard } from "./local-environment.mjs";
import { catalog } from "./schema-catalog.mjs";
import { assertSchema, assertionFailure } from "./gauntlet-contract.mjs";
export const evidenceSecretModules = new Set([
  "src/lib/evidence/config.ts",
  "src/lib/evidence/storage.ts",
]);
const exportsByFile = {
  "src/lib/evidence/config.ts": [
    "evidenceEnabled",
    "evidenceConfigured",
    "cleanupSecret",
  ],
  "src/lib/evidence/storage.ts": [
    "evidenceStorageReady",
    "claimUpload",
    "finalizeUpload",
    "authorizeDownload",
    "recordDownloadFailure",
    "claimCleanup",
    "recordCleanup",
    "writeObject",
    "readObject",
    "purgeObject",
  ],
};
export function assertEvidenceCapabilities(files) {
  for (const [file, allowed] of Object.entries(exportsByFile)) {
    const source = files.get(file);
    assert(source, "Missing evidence privileged boundary");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    assert(
      ast.statements.some(
        (s) =>
          ts.isImportDeclaration(s) && s.moduleSpecifier.text === "server-only",
      ),
      "Evidence server-only marker missing",
    );
    for (const s of ast.statements)
      if (
        ts.isExportDeclaration(s) ||
        ts.isExportAssignment(s) ||
        s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        assert(
          ts.isFunctionDeclaration(s) &&
            s.name &&
            allowed.includes(s.name.text),
          "Evidence raw/generic privileged export",
        );
      }
    assert(
      !/createSignedUrl|createSignedUploadUrl|getPublicUrl/.test(source),
      "Evidence bearer/public access is forbidden",
    );
  }
}
export function assertEvidenceLayers(layers) {
  for (const [id, file] of [
    ["renewal-evidence-upgrade", "renewal-evidence-upgrade"],
    ["evidence-storage", "evidence-storage"],
    ["evidence-controls", "evidence-controls"],
  ]) {
    assert.equal(
      layers.filter((l) => l.id === id).length,
      1,
      "Missing/duplicate evidence layer",
    );
    assert.deepEqual(
      layers.find((l) => l.id === id),
      { id, command: "node", args: [`tools/${file}.mjs`] },
      "Wrong evidence layer command",
    );
  }
}
export function assertEvidenceMutationTargets(production, properties) {
  for (const file of [
    "schema",
    "validation",
    "messages",
    "repository",
    "operations",
    "config",
    "storage",
    "cleanup",
  ])
    assert(
      production.mutate.includes(`src/lib/evidence/${file}.ts`),
      "Missing evidence mutation target",
    );
  for (const file of ["schema", "validation", "messages"])
    assert(
      properties.mutate.includes(`src/lib/evidence/${file}.ts`),
      "Missing evidence property target",
    );
}
async function controls() {
  await fixtureGuard();
  mkdirSync("reports", { recursive: true });
  const db = new Client({ connectionString: localConfig().DB_URL });
  await db.connect();
  const result = [];
  const faults = [
    [
      "evidence-identity-replay",
      "private.reserve_renewal_evidence(uuid,uuid,uuid,uuid,text,text,integer,text)",
      "receipt.payload <> payload",
      "false",
      "EV01 EV04 EV08",
    ],
    [
      "evidence-cycle-quota",
      "private.reserve_renewal_evidence(uuid,uuid,uuid,uuid,text,text,integer,text)",
      ") >= 20",
      ") >= 21",
      "EV03 EV09",
    ],
    [
      "evidence-download-audit",
      "private.authorize_renewal_evidence_download(uuid,uuid,uuid,uuid,uuid)",
      "access_id := private.evidence_event(evidence, p_actor_id, 'download-authorized');",
      "access_id := gen_random_uuid();",
      "EV05 EV07 EV10",
    ],
  ];
  try {
    const before = await catalog(db);
    for (const [id, signature, from, to, pattern] of faults) {
      const original = (
        await db.query("select pg_get_functiondef($1::regprocedure) body", [
          signature,
        ])
      ).rows[0].body;
      assert.equal(
        original.split(from).length,
        2,
        "Evidence fault must apply exactly once",
      );
      try {
        await db.query(original.replace(from, to));
        assert.notEqual(
          (
            await db.query("select pg_get_functiondef($1::regprocedure) body", [
              signature,
            ])
          ).rows[0].body,
          original,
          "Fault was not applied",
        );
        const path = `reports/${id}.json`,
          r = spawnSync(
            "npm",
            [
              "run",
              "test:integration",
              "--",
              "tests/integration/practice-renewal-evidence.test.ts",
              "--testNamePattern",
              pattern,
              "--reporter=json",
              `--outputFile=${path}`,
            ],
            { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
          );
        if (r.error) throw r.error;
        assert.equal(r.status, 1, "Evidence fault survived");
        const report = JSON.parse(readFileSync(path, "utf8"));
        assert(
          report.testResults.some((t) =>
            t.assertionResults.some(
              (a) =>
                a.status === "failed" &&
                a.failureMessages.some(assertionFailure),
            ),
          ),
          "Evidence fault did not cause a behavioral assertion",
        );
        writeFileSync(`reports/${id}.log`, `${r.stdout}\n${r.stderr}`);
        result.push({
          id,
          applied: true,
          executed: true,
          killed: true,
          restored: true,
        });
      } finally {
        await db.query(original);
        assert.equal(
          (
            await db.query("select pg_get_functiondef($1::regprocedure) body", [
              signature,
            ])
          ).rows[0].body,
          original,
        );
        assertSchema(await catalog(db), before);
      }
    }
  } finally {
    await db.end();
  }
  writeFileSync(
    "reports/evidence-controls.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    `${result.length} applied evidence SQL faults killed and catalog restored.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await controls();
