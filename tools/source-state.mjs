import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export function sourceState() {
  const changes = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter((line) => line && !line.slice(3).startsWith("thoughts/"));
  if (changes.length)
    throw new Error(`Untested dirty source inputs:\n${changes.join("\n")}`);
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((f) => !f.startsWith("thoughts/"));
  const hash = createHash("sha256");
  for (const f of files.sort()) {
    hash.update(f);
    hash.update(readFileSync(f));
  }
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    sourceHash: hash.digest("hex"),
    files: files.length,
  };
}
