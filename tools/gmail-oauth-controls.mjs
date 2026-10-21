import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const file = "tools/gmail-oauth-helper.mjs",
  original = readFileSync(file, "utf8"),
  hash = createHash("sha256").update(original).digest("hex");
mkdirSync("reports", { recursive: true });
const results = [];
for (const [id, needle, replacement, pattern] of [
  [
    "gmail-oauth-state",
    'params.get("state") !== session.state',
    "false",
    "GM02 callback",
  ],
  [
    "gmail-oauth-issuer",
    'params.get("iss") !== "https://accounts.google.com"',
    "false",
    "GM02 callback issuer",
  ],
  [
    "gmail-oauth-private-output",
    "    info.mode & 0o077 ||",
    "    false ||",
    "GM08 credentials",
  ],
]) {
  const index = original.indexOf(needle);
  assert(index >= 0, "Missing exact OAuth defense");
  try {
    writeFileSync(
      file,
      original.slice(0, index) +
        replacement +
        original.slice(index + needle.length),
    );
    assert.notEqual(readFileSync(file, "utf8"), original);
    const r = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-reporter=tap",
        `--test-name-pattern=${pattern}`,
        "tools/gmail-oauth.test.mjs",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (r.error) throw r.error;
    writeFileSync(`reports/${id}.log`, `${r.stdout}\n${r.stderr}`);
    assert.equal(r.status, 1, "OAuth fault survived");
    assert.match(`${r.stdout}\n${r.stderr}`, /ERR_ASSERTION/);
    results.push({
      id,
      applied: true,
      executed: true,
      killed: true,
      restored: true,
    });
  } finally {
    writeFileSync(file, original);
    assert.equal(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
      hash,
    );
  }
}
const restored = spawnSync(
  process.execPath,
  ["--test", "tools/gmail-oauth.test.mjs"],
  { encoding: "utf8" },
);
if (restored.error) throw restored.error;
assert.equal(restored.status, 0, "Restored OAuth suite failed");
writeFileSync(
  "reports/gmail-oauth-controls.json",
  JSON.stringify({ results, restoredPassed: true }, null, 2),
);
console.log(
  `${results.length} applied OAuth defense faults killed; exact source restored and suite passed.`,
);
