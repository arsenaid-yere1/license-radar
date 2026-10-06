import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const result = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file) && !file.includes(".test.")) {
      const source = readFileSync(file, "utf8");
      if (
        /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|user_metadata/.test(
          source,
        )
      )
        throw new Error(`Unauthorized app authorization capability: ${file}`);
      for (const [kind, pattern] of Object.entries({
        environment: /process\.env\.[A-Z_]+/g,
        network: /\.auth\.[a-zA-Z]+|client\.(?:from|rpc)\([^)]*\)/g,
        cryptography: /node:crypto|randomBytes\([^)]*\)|createHash\([^)]*\)/g,
        clipboard: /navigator\.clipboard\.[a-zA-Z]+/g,
        sessionStorage: /sessionStorage\.[a-zA-Z]+/g,
        cookies: /\.cookies\.[a-zA-Z]+/g,
        process: /node:child_process/g,
        filesystem: /node:fs/g,
      })) {
        const matches = source.match(pattern);
        if (matches) result.push({ file, kind, matches });
      }
      if (/node:(fs|child_process)/.test(source))
        throw new Error(`Unexpected application host capability: ${file}`);
    }
  }
}
walk("src");
const report = {
  capabilities: result,
  scope:
    "Application source uses configured Supabase Auth/Data API and authenticated RPCs, cryptographic invitation generation/hashing and register request identifiers, tab-scoped session storage, clipboard copying, cookies, and two public configuration values. Test/tool scripts additionally use loopback HTTP, dedicated local Postgres, Docker, filesystem, and verification subprocesses. No hosting or renewal portal actions.",
  limits:
    "Text inspection detects listed spellings; it is not a complete transitive capability proof. Schema fingerprint and dependency inventory provide separate evidence.",
};
writeFileSync("reports/capabilities.json", JSON.stringify(report, null, 2));
console.log(report.scope);
