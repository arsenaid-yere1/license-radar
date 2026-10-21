import { assertPciVerification } from "./pci-controls.mjs";
import {
  assertHeartbeatCapabilities,
  assertHeartbeatMutationTargets,
} from "./heartbeat-controls.mjs";
import { assertRecoveryMutationTargets } from "./recovery-controls.mjs";
import {
  assertGmailCapabilities,
  assertGmailMutationTargets,
} from "./gmail-controls.mjs";
import {
  assertEvidenceCapabilities,
  assertEvidenceMutationTargets,
  evidenceSecretModules,
} from "./evidence-controls.mjs";
import { assertRenewalMutationTargets } from "./renewal-controls.mjs";
import mutationConfig from "../stryker.config.mjs";
import propertiesConfig from "../stryker.properties.config.mjs";
import {
  assertSmsCapabilities,
  applicationSources,
} from "./sms-capabilities.mjs";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
assertPciVerification(
  JSON.parse(readFileSync("tools/layers.json", "utf8")),
  mutationConfig,
  propertiesConfig,
);
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
          file !== "src/lib/sms/privileged-repository.ts" &&
          !evidenceSecretModules.has(file))
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
assertRecoveryMutationTargets(mutationConfig, propertiesConfig);
assertRenewalMutationTargets(mutationConfig, propertiesConfig);
assertSmsCapabilities(applicationSources());
assertEvidenceCapabilities(applicationSources());
assertEvidenceMutationTargets(mutationConfig, propertiesConfig);
assertGmailCapabilities(applicationSources());
assertGmailMutationTargets(mutationConfig, propertiesConfig);
assertHeartbeatCapabilities(applicationSources());
assertHeartbeatMutationTargets(mutationConfig, propertiesConfig);
walk("src");
const report = {
  capabilities: result,
  scope:
    "Application source uses configured Supabase Auth/Data API and authenticated RPCs, cryptography, tab-scoped session storage, clipboard copying and cookies. Test/tool scripts additionally use loopback HTTP, dedicated local Postgres, Docker, filesystem and verification subprocesses. SMS verification/STOP and email reminder dispatch/events share one constrained server-only privileged client. Evidence has a separate server-only gateway with named checked RPCs and immutable paths in one private bucket; no signing or raw client exports. Email sends use one fixed Resend origin or an explicit loopback fixture; callbacks verify official Svix signatures. Live email and evidence are opt-in, independently of SMS. An optional server-only production heartbeat sends an empty POST to fixed hc-ping.com after persisted worker completion. No hosting or renewal portal actions.",
  limits:
    "Text inspection detects listed spellings; it is not a complete transitive capability proof. Schema fingerprint and dependency inventory provide separate evidence.",
};
writeFileSync("reports/capabilities.json", JSON.stringify(report, null, 2));
console.log(report.scope);
