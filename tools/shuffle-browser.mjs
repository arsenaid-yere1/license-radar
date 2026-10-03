import { spawnSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
const list = spawnSync(
  "node_modules/.bin/playwright",
  ["test", "--list", "--reporter=json"],
  { encoding: "utf8" },
);
if (list.error || list.status !== 0)
  throw new Error("Browser test inventory failed");
const inventory = JSON.parse(list.stdout);
const names = [];
function walk(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) names.push(spec.title);
    walk(suite.suites ?? []);
  }
}
walk(inventory.suites);
let seed = 20261017;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
for (let i = names.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [names[i], names[j]] = [names[j], names[i]];
}
copyFileSync(
  "reports/browser-results.json",
  "reports/browser-results-full.json",
);
const results = [];
for (const name of names) {
  const exact = RegExp.escape(name) + "$";
  const r = spawnSync(
    "node_modules/.bin/playwright",
    ["test", "--grep", exact],
    { encoding: "utf8", env: process.env },
  );
  writeFileSync(
    `reports/shuffled-browser-${results.length}.log`,
    r.stdout + "\n" + r.stderr,
  );
  if (r.error || r.status !== 0)
    throw new Error(`Shuffled browser test failed: ${name}`);
  copyFileSync(
    "reports/browser-results.json",
    `reports/shuffled-browser-${results.length}.json`,
  );
  results.push({ name, exitCode: r.status });
}
if (results.length !== 10)
  throw new Error("Incomplete browser shuffled inventory");
writeFileSync(
  "reports/browser-order.json",
  JSON.stringify({ seed: 20261017, order: results }, null, 2),
);
console.log(
  "10 browser tests passed in recorded shuffled order, each in fresh contexts.",
);
