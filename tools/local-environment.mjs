import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
export function assertFixtureTarget(nonFixtureCount) {
  if (nonFixtureCount !== 0)
    throw new Error("Refusing non-fixture database reset");
}
export function assertProject(source) {
  const ids = [...source.matchAll(/^project_id\s*=\s*"([^"]+)"\s*$/gm)];
  if (ids.length !== 1 || ids[0][1] !== "license-radar-e1-s1")
    throw new Error("Refusing unexpected local project");
}
export async function fixtureGuard() {
  const config = localConfig();
  const db = new Client({ connectionString: config.DB_URL });
  await db.connect();
  try {
    const result = await db.query(
      "select count(*)::int n from auth.users where email is null or (email not like 'fixture-%@example.test' and email <> 'sql-fixture@example.test')",
    );
    assertFixtureTarget(result.rows[0]?.n);
  } finally {
    await db.end();
  }
}
export function assertLocal(raw, port, protocol) {
  const u = new URL(raw);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== String(port) ||
    u.protocol !== protocol
  )
    throw new Error("Refusing nonlocal or unexpected endpoint");
  return u;
}
export function localConfig() {
  assertProject(readFileSync("supabase/config.toml", "utf8"));
  const p = JSON.parse(readFileSync(".env.test.json", "utf8"));
  assertLocal(p.API_URL, 55321, "http:");
  assertLocal(p.DB_URL, 55322, "postgresql:");
  assertLocal(p.MAILPIT_URL, 55324, "http:");
  return p;
}
export function run(command, args, options = {}) {
  const r = spawnSync(command, args, { stdio: "inherit", ...options });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} failed: ${r.status}`);
  return r;
}
export function prepare() {
  assertProject(readFileSync("supabase/config.toml", "utf8"));
  const r = run("node_modules/.bin/supabase", ["status", "-o", "json"], {
    stdio: "pipe",
  });
  const c = JSON.parse(r.stdout.toString());
  assertLocal(c.API_URL, 55321, "http:");
  assertLocal(c.DB_URL, 55322, "postgresql:");
  assertLocal(c.MAILPIT_URL, 55324, "http:");
  if (!(c.SECRET_KEY ?? c.SERVICE_ROLE_KEY))
    throw new Error("Missing local service credential");
  const safe = {
    API_URL: c.API_URL,
    DB_URL: c.DB_URL,
    MAILPIT_URL: c.MAILPIT_URL,
    PUBLISHABLE_KEY: c.PUBLISHABLE_KEY,
  };
  writeFileSync(".env.test.json", JSON.stringify(safe), { mode: 0o600 });
  writeFileSync(
    ".env.local",
    `NEXT_PUBLIC_SUPABASE_URL=${c.API_URL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${c.PUBLISHABLE_KEY}\nSUPABASE_SECRET_KEY=${c.SECRET_KEY ?? c.SERVICE_ROLE_KEY}\nSMS_PROVIDER_FIXTURE=local-e4-s1\nSMS_FIXTURE_URL=http://127.0.0.1:55325\nSMS_APP_URL=http://127.0.0.1:3000\nSMS_FIXTURE_TOKEN=local-fixture-only-e4-s1\n`,
    { mode: 0o600 },
  );
  chmodSync(".env.test.json", 0o600);
  chmodSync(".env.local", 0o600);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const mode = process.argv[2];
  if (mode === "prepare") prepare();
  else {
    localConfig();
    if (mode === "reset") {
      await fixtureGuard();
      run("node_modules/.bin/supabase", [
        "db",
        "reset",
        "--local",
        "--no-seed",
        "--yes",
      ]);
    } else if (mode === "test-db") {
      run("node_modules/.bin/supabase", ["test", "db", "--local"]);
      run(process.execPath, ["tools/foreign-key-controls.mjs"]);
    } else throw new Error("Unknown local command");
    if (mode === "reset") {
      prepare();
      const c = localConfig();
      let ready = false;
      for (let attempt = 0; attempt < 450; attempt++) {
        const response = await fetch(
          `${c.API_URL}/rest/v1/practices?select=id&limit=0`,
          { headers: { apikey: c.PUBLISHABLE_KEY } },
        );
        const body = await response.json();
        if (response.ok || body.code === "42501") {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!ready)
        throw new Error("Local Data API did not become ready after replay");
    }
  }
}
