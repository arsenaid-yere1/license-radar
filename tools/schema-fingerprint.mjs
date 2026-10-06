import { catalog } from "./schema-catalog.mjs";
import { Client } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { localConfig } from "./local-environment.mjs";
import { assertSchema } from "./gauntlet-contract.mjs";
const db = new Client({ connectionString: localConfig().DB_URL });
await db.connect();
let result;
try {
  result = await catalog(db);
} finally {
  await db.end();
}
const text = JSON.stringify(result, null, 2) + "\n";
if (["record-upgrade", "record-replay"].includes(process.argv[2]))
  writeFileSync(`reports/${process.argv[2].slice(7)}-schema.json`, text);
else if (process.argv[2] === "record")
  writeFileSync("tools/schema-contract.json", text);
else {
  assertSchema(
    result,
    JSON.parse(readFileSync("tools/schema-contract.json", "utf8")),
  );
  writeFileSync("reports/schema-verified.json", text);
  console.log(
    "Fresh schema, grants, policies, private functions and triggers match contract.",
  );
}
