import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { localConfig, fixtureGuard } from "./local-environment.mjs";
import { catalog } from "./schema-catalog.mjs";
import { assertSchema, assertionFailure } from "./gauntlet-contract.mjs";
export const gmailSecretModules = new Set([
  "src/lib/reminders/gmail-config.ts",
  "src/lib/reminders/gmail-provider.ts",
  "src/lib/reminders/gmail-authorization.ts",
]);
export function assertGmailLayers(layers) {
  assert(Array.isArray(layers), "Missing Gmail layer inventory");
  for (const id of [
    "gmail-reminders-upgrade",
    "gmail-controls",
    "gmail-oauth-controls",
  ]) {
    assert.equal(
      layers.filter((l) => l.id === id).length,
      1,
      "Missing/duplicate Gmail layer",
    );
    assert.deepEqual(
      layers.find((l) => l.id === id),
      { id, command: "node", args: [`tools/${id}.mjs`] },
      "Incorrect Gmail gate command",
    );
  }
}
export function assertGmailMutationTargets(production, properties) {
  for (const config of [production, properties]) {
    assert(Array.isArray(config?.mutate), "Missing Gmail mutation inventory");
    for (const file of gmailSecretModules)
      assert(
        config.mutate.includes(file),
        `Missing Gmail mutation target: ${file}`,
      );
  }
}
export function assertGmailCapabilities(files) {
  const origins = new Set([
    "https://oauth2.googleapis.com/token",
    "https://openidconnect.googleapis.com/v1/userinfo",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
  ]);
  for (const file of gmailSecretModules) {
    const source = files.get(file);
    assert(source, "Missing Gmail server boundary");
    if (!file.endsWith("gmail-authorization.ts"))
      assert(
        source.includes('import "server-only"'),
        "Missing Gmail server marker",
      );
    assert(
      !/NEXT_PUBLIC_GMAIL|tokeninfo|gmail\.readonly|gmail\.modify|mail\.google\.com/.test(
        source,
      ),
      "Unexpected Gmail access capability",
    );
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isStringLiteral(node) && node.text.startsWith("https://"))
        assert(origins.has(node.text), "Unexpected Gmail network origin");
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  const auth = files.get("src/lib/reminders/gmail-authorization.ts");
  for (const endpoint of [...origins].slice(0, 3))
    assert(auth.includes(endpoint), "Missing fixed Gmail endpoint");
}
async function controls() {
  await fixtureGuard();
  mkdirSync("reports", { recursive: true });
  const db = new Client({ connectionString: localConfig().DB_URL });
  await db.connect();
  const results = [];
  const faults = [
    [
      "gmail-subject-binding",
      "private.begin_gmail_reminder_at(uuid,uuid,jsonb,text,integer,timestamptz)",
      "authority.subject is distinct from p_subject",
      "false",
      "GM06 mismatched",
    ],
    [
      "gmail-record-token",
      "private.record_gmail_reminder_at(uuid,uuid,text,text,text,timestamptz)",
      "attempt.token is distinct from p_token",
      "false",
      "GM04 wrong result token",
    ],
    [
      "gmail-recipient-authority",
      "private.email_reminder_context(uuid,uuid,text,timestamptz)",
      "result->>'email' is distinct from authority.allowed_recipient",
      "false",
      "GM06 durable allowlist",
    ],
  ];
  try {
    const before = await catalog(db);
    for (const [id, signature, needle, replacement, pattern] of faults) {
      const original = (
        await db.query("select pg_get_functiondef($1::regprocedure) body", [
          signature,
        ])
      ).rows[0].body;
      assert.equal(
        original.split(needle).length,
        2,
        "Gmail SQL fault must apply exactly once",
      );
      try {
        await db.query(original.replace(needle, replacement));
        assert.notEqual(
          (
            await db.query("select pg_get_functiondef($1::regprocedure) body", [
              signature,
            ])
          ).rows[0].body,
          original,
        );
        const path = `reports/${id}.json`,
          r = spawnSync(
            "npm",
            [
              "run",
              "test:integration",
              "--",
              "tests/integration/practice-gmail-reminders.test.ts",
              "--testNamePattern",
              pattern,
              "--reporter=json",
              `--outputFile=${path}`,
            ],
            { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
          );
        if (r.error) throw r.error;
        writeFileSync(`reports/${id}.log`, `${r.stdout}\n${r.stderr}`);
        assert.equal(r.status, 1, "Gmail SQL fault survived");
        const report = JSON.parse(readFileSync(path, "utf8"));
        assert(
          report.testResults.some((t) =>
            t.assertionResults.some(
              (a) =>
                a.status === "failed" &&
                a.failureMessages.some(assertionFailure),
            ),
          ),
          "Fault did not produce a behavioral assertion",
        );
        results.push({
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
    "reports/gmail-controls.json",
    JSON.stringify(results, null, 2),
  );
  console.log(
    `${results.length} applied Gmail SQL faults killed; catalog restored exactly.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await controls();
