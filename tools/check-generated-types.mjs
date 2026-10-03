import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { localConfig } from "./local-environment.mjs";
localConfig();
const raw = spawnSync(
  "node_modules/.bin/supabase",
  ["gen", "types", "--local", "--schema", "public"],
  { encoding: "utf8" },
);
if (raw.error || raw.status !== 0)
  throw new Error("Database type generation failed");
const formatted = spawnSync(
  "node_modules/.bin/prettier",
  ["--stdin-filepath", "src/lib/supabase/database.types.ts"],
  { input: raw.stdout, encoding: "utf8" },
);
if (formatted.error || formatted.status !== 0)
  throw new Error("Generated type formatting failed");
if (
  formatted.stdout !==
  readFileSync("src/lib/supabase/database.types.ts", "utf8")
)
  throw new Error("Generated database types drift");
writeFileSync(
  "reports/generated-types-verified.txt",
  "Fresh schema types match tracked generated types.\n",
);
