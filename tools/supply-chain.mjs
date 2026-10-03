import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const policy = JSON.parse(
  readFileSync("tools/supply-chain-policy.json", "utf8"),
);
function command(cmd, args, allowed = [0]) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error || !allowed.includes(r.status))
    throw new Error(`${cmd} failed: ${r.status}`);
  return r;
}
const auditRun = command("npm", ["audit", "--json"], [0, 1]);
const audit = JSON.parse(auditRun.stdout);
if (audit.error) throw new Error("npm audit request failed");
const runtimeRun = command("npm", ["audit", "--omit=dev", "--json"], [0, 1]);
const runtime = JSON.parse(runtimeRun.stdout);
if (runtime.error || Object.keys(runtime.vulnerabilities ?? {}).length)
  throw new Error("Unresolved runtime advisory");
for (const [name, issue] of Object.entries(audit.vulnerabilities ?? {})) {
  const accepted = Object.values(policy.advisories).some((p) =>
    p.packages.includes(name),
  );
  if (!accepted) throw new Error(`Unclassified advisory package: ${name}`);
  for (const via of issue.via.filter((v) => typeof v !== "string")) {
    const id = via.url?.split("/").at(-1);
    if (!policy.advisories[id]) throw new Error(`Unclassified advisory: ${id}`);
  }
}
const licenses = JSON.parse(
  command("node_modules/.bin/license-checker-rseidelsohn", ["--json"]).stdout,
);
for (const [name, item] of Object.entries(licenses)) {
  if (policy.permissive.includes(item.licenses)) continue;
  const approved = policy.reviewed[name];
  if (!approved || approved.license !== item.licenses)
    throw new Error(`Unknown or unreviewed license: ${name} ${item.licenses}`);
}
const python = JSON.parse(
  command(".venv-gauntlet/bin/pip", ["list", "--format=json"]).stdout,
);
const response = await fetch("https://api.osv.dev/v1/querybatch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    queries: python.map((p) => ({
      package: { ecosystem: "PyPI", name: p.name },
      version: p.version,
    })),
  }),
  signal: AbortSignal.timeout(30000),
});
if (!response.ok)
  throw new Error(`Python advisory request failed: ${response.status}`);
const pythonAudit = await response.json();
if (
  !Array.isArray(pythonAudit.results) ||
  pythonAudit.results.length !== python.length
)
  throw new Error("Incomplete Python advisory response");
if (pythonAudit.results.some((r) => r.vulns?.length))
  throw new Error(
    `Unresolved Python advisories: ${JSON.stringify(pythonAudit)}`,
  );
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const pinned = JSON.parse(readFileSync("tools/toolchain.json", "utf8"));
for (const key of ["dependencies", "devDependencies"]) {
  if (JSON.stringify(manifest[key]) !== JSON.stringify(pinned[key]))
    throw new Error("Direct dependency drift from recorded approved toolchain");
  for (const version of Object.values(manifest[key]))
    if (!/^\d+\.\d+\.\d+$/.test(version))
      throw new Error("Unpinned direct dependency");
}
writeFileSync(
  "reports/supply-chain.json",
  JSON.stringify(
    { audit, runtime, licenses, python, pythonAudit, policy },
    null,
    2,
  ),
);
console.log(
  `Runtime advisories: 0; classified dev findings: ${Object.keys(audit.vulnerabilities ?? {}).length}; licenses: ${Object.keys(licenses).length}; Python packages: ${python.length}, advisories: 0.`,
);
