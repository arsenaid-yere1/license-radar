import {
  assertSmsCapabilities,
  applicationSources,
} from "./sms-capabilities.mjs";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const result = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file) && !file.includes(".test.")) {
      const source = readFileSync(file, "utf8");
      if (
        /user_metadata/.test(source) ||
        (/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/.test(source) &&
          file !== "src/lib/sms/privileged-repository.ts")
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
assertSmsCapabilities(applicationSources());
walk("src");
const report = {
  capabilities: result,
  scope:
    "Application source uses configured Supabase Auth/Data API and authenticated RPCs, cryptography, tab-scoped session storage, clipboard copying and cookies. Test/tool scripts additionally use loopback HTTP, dedicated local Postgres, Docker, filesystem and verification subprocesses. SMS verification/STOP and email reminder dispatch/events share one constrained server-only privileged client. Email sends use one fixed Resend origin or an explicit loopback fixture; callbacks verify official Svix signatures. Live email is opt-in and independent of optional SMS. No hosting or renewal portal actions.",
  limits:
    "Text inspection detects listed spellings; it is not a complete transitive capability proof. Schema fingerprint and dependency inventory provide separate evidence.",
};
writeFileSync("reports/capabilities.json", JSON.stringify(report, null, 2));
console.log(report.scope);
