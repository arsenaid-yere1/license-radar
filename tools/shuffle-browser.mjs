import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { assertInventory, browserCases } from "./gauntlet-contract.mjs";
const list = spawnSync(
  "node_modules/.bin/playwright",
  ["test", "--list", "--reporter=json"],
  { encoding: "utf8" },
);
if (list.error || list.status !== 0)
  throw new Error("Browser test inventory failed");
const names = browserCases(JSON.parse(list.stdout), true).map((r) => r.name);
const full = existsSync("reports/browser-results-full.json")
  ? "reports/browser-results-full.json"
  : "reports/browser-results.json";
assertInventory(names, browserCases(JSON.parse(readFileSync(full, "utf8"))));
let seed = 20261017;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
for (let i = names.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [names[i], names[j]] = [names[j], names[i]];
}
const results = [];
for (const name of names) {
  rmSync("reports/browser-results.json", { force: true });
  const r = spawnSync(
    "node_modules/.bin/playwright",
    ["test", "--grep", RegExp.escape(name) + "$"],
    { encoding: "utf8", env: process.env, maxBuffer: 32 * 1024 * 1024 },
  );
  writeFileSync(
    `reports/shuffled-browser-${results.length}.log`,
    `${r.stdout ?? ""}\n${r.stderr ?? ""}`,
  );
  if (r.error || r.status !== 0)
    throw new Error(`Shuffled browser execution failed: ${name}`);
  const report = readFileSync("reports/browser-results.json", "utf8");
  assertInventory([name], browserCases(JSON.parse(report)));
  writeFileSync(`reports/shuffled-browser-${results.length}.json`, report);
  results.push({ name, status: "passed", exitCode: r.status });
}
assertInventory(names, results);
writeFileSync(
  "reports/browser-order.json",
  JSON.stringify({ seed: 20261017, order: results }, null, 2),
);
console.log(
  `${results.length} discovered browser tests passed in recorded shuffled order, each in fresh contexts.`,
);
