import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const mutants = [
  {
    file: "tools/check-coverage.mjs",
    from: "if (!c) throw new Error(`Missing coverage: ${file}`);",
    to: "if(!c)continue;",
    test: "missing coverage hard failure",
  },
  {
    file: "tools/check-coverage.mjs",
    from: "if (count === 0) misses.push",
    to: "if(false)misses.push",
    test: "uncovered changed line hard failure",
  },
  {
    file: "tools/local-environment.mjs",
    from: 'u.hostname !== "127.0.0.1" ||\n    u.port !== String(port) ||\n    u.protocol !== protocol',
    to: "false",
    test: "hosted reset URL hard failure",
  },
  {
    file: "tools/gauntlet-contract.mjs",
    from: "if (!item) throw new Error(`Missing layer: ${id}`);",
    to: "if(!item)continue;",
    test: "missing required layer hard failure",
  },
  {
    file: "tools/gauntlet-contract.mjs",
    from: 'if (result.executed !== true) throw new Error("Mutant not executed");',
    to: "",
    test: "nonexecuted mutant hard failure",
  },
];
const baseline = spawnSync(
  process.execPath,
  ["--test", "tools/gauntlet-controls.test.mjs"],
  { encoding: "utf8" },
);
if (baseline.status !== 0)
  throw new Error("Controls baseline must pass before sensitivity checks");
const results = [];
for (const mutant of mutants) {
  const original = readFileSync(mutant.file, "utf8");
  if (!original.includes(mutant.from))
    throw new Error("Checker mutant not applicable");
  try {
    writeFileSync(mutant.file, original.replace(mutant.from, mutant.to));
    const r = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-reporter=tap",
        `--test-name-pattern=${mutant.test}`,
        "tools/gauntlet-controls.test.mjs",
      ],
      { encoding: "utf8" },
    );
    if (
      r.error ||
      r.status !== 1 ||
      !r.stdout.includes(mutant.test) ||
      !r.stdout.includes("ERR_ASSERTION")
    )
      throw new Error(
        `Control did not fail when defense removed: ${mutant.test}`,
      );
    results.push({ test: mutant.test, exitCode: r.status, output: r.stdout });
  } finally {
    writeFileSync(mutant.file, original);
    if (readFileSync(mutant.file, "utf8") !== original)
      throw new Error("Checker restore failed");
  }
}
writeFileSync(
  "reports/checker-sensitivity.json",
  JSON.stringify(results, null, 2),
);
console.log(
  `${results.length} checker controls failed with their defenses removed; restored.`,
);
