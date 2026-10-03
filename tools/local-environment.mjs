import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
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
  const r = run("node_modules/.bin/supabase", ["status", "-o", "json"], {
    stdio: "pipe",
  });
  const c = JSON.parse(r.stdout.toString());
  assertLocal(c.API_URL, 55321, "http:");
  assertLocal(c.DB_URL, 55322, "postgresql:");
  assertLocal(c.MAILPIT_URL, 55324, "http:");
  const safe = {
    API_URL: c.API_URL,
    DB_URL: c.DB_URL,
    MAILPIT_URL: c.MAILPIT_URL,
    PUBLISHABLE_KEY: c.PUBLISHABLE_KEY,
  };
  writeFileSync(".env.test.json", JSON.stringify(safe), { mode: 0o600 });
  writeFileSync(
    ".env.local",
    `NEXT_PUBLIC_SUPABASE_URL=${c.API_URL}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${c.PUBLISHABLE_KEY}\n`,
    { mode: 0o600 },
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const mode = process.argv[2];
  if (mode === "prepare") prepare();
  else {
    localConfig();
    if (mode === "reset")
      run("node_modules/.bin/supabase", [
        "db",
        "reset",
        "--local",
        "--no-seed",
        "--yes",
      ]);
    else if (mode === "test-db")
      run("node_modules/.bin/supabase", ["test", "db", "--local"]);
    else throw new Error("Unknown local command");
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
