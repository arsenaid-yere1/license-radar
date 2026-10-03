import { Client } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { localConfig } from "./local-environment.mjs";
const db = new Client({ connectionString: localConfig().DB_URL });
await db.connect();
const result = {};
try {
  for (const [name, sql] of Object.entries({
    columns:
      "select table_schema,table_name,column_name,data_type,column_default,is_nullable from information_schema.columns where (table_schema='public' and table_name='practices') or table_schema='private' order by table_schema,table_name,ordinal_position",
    policies:
      "select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='private' or tablename='practices' order by schemaname,tablename,policyname",
    functions:
      "select proname,pg_get_functiondef(oid) definition from pg_proc where pronamespace='private'::regnamespace order by proname",
    triggers:
      "select tgname,pg_get_triggerdef(oid) definition from pg_trigger where tgrelid='public.practices'::regclass and not tgisinternal order by tgname",
    grants:
      "select grantee,table_schema,table_name,column_name,privilege_type from information_schema.column_privileges where table_name='practices' or table_schema='private' order by grantee,table_schema,table_name,column_name,privilege_type",
    rls: "select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on c.relnamespace=n.oid where (n.nspname='public' and c.relname='practices') or (n.nspname='private' and c.relkind='r') order by n.nspname,c.relname",
  })) {
    result[name] = (await db.query(sql)).rows;
  }
} finally {
  await db.end();
}
const text = JSON.stringify(result, null, 2) + "\n";
if (process.argv[2] === "record")
  writeFileSync("tools/schema-contract.json", text);
else {
  if (text !== readFileSync("tools/schema-contract.json", "utf8"))
    throw new Error("Fresh schema drift from recorded contract");
  writeFileSync("reports/schema-verified.json", text);
  console.log(
    "Fresh schema, grants, policies, private functions and triggers match contract.",
  );
}
