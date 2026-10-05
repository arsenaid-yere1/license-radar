import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import v8toIstanbul from "v8-to-istanbul";
import coverageLibrary from "istanbul-lib-coverage";
const { createCoverageMap } = coverageLibrary;
export function assertCoverage(map, files) {
  const misses = [];
  let lines = 0;
  for (const file of files) {
    const c = map[file];
    if (!c) throw new Error(`Missing coverage: ${file}`);
    const executed = new Map();
    for (const [key, position] of Object.entries(c.statementMap)) {
      if (!Number.isFinite(c.s[key]) || c.s[key] < 0)
        throw new Error(`Incomplete statement coverage: ${file}`);
      const line = position.start.line;
      executed.set(line, Math.max(executed.get(line) ?? 0, c.s[key]));
    }
    if (!executed.size) throw new Error(`Missing coverage statements: ${file}`);
    for (const [line, count] of executed) {
      lines++;
      if (count === 0) misses.push(`${file}:${line}`);
    }
  }
  if (misses.length)
    throw new Error(
      `Uncovered (${misses.length}/${lines}):\n${misses.join("\n")}`,
    );
  return { lines, covered: lines };
}
function owned(path) {
  const normalized = decodeURIComponent(path).replaceAll("\\", "/");
  if (normalized.includes("/node_modules/")) return null;
  const index = normalized.lastIndexOf("/src/");
  if (index < 0) return null;
  const name = normalized.slice(index + 1);
  if (!existsSync(name)) return null;
  if (!/\.tsx?$/.test(name) || /\.test\.|database.types/.test(name))
    return null;
  return name;
}
function mergeOwned(target, raw) {
  let count = 0;
  for (const [path, c] of Object.entries(raw)) {
    const name = owned(path);
    if (name) {
      target.merge({ [name]: { ...c, path: name } });
      count++;
    }
  }
  return count;
}
export function verifyMap(map) {
  for (let i = 0; i < map.sources.length; i++) {
    const name = owned(map.sources[i]);
    if (name && map.sourcesContent?.[i] !== readFileSync(name, "utf8"))
      throw new Error(`Stale or missing source-map content: ${name}`);
  }
}
async function convert(file, source, functions, map) {
  if (map) verifyMap(map);
  const converter = v8toIstanbul(
    file,
    0,
    source ? { source, sourceMap: { sourcemap: map } } : undefined,
  );
  await converter.load();
  converter.applyCoverage(functions);
  return converter.toIstanbul();
}
export async function checkCoverage() {
  const map = createCoverageMap();
  mergeOwned(
    map,
    JSON.parse(readFileSync("coverage/unit/coverage-final.json", "utf8")),
  );
  let browserMapped = 0,
    nodeMapped = 0;
  for (const file of readdirSync("coverage/browser")) {
    for (const entry of JSON.parse(
      readFileSync(`coverage/browser/${file}`, "utf8"),
    )) {
      if (!entry.url.includes("/_next/static/")) continue;
      const compiled = resolve(
        ".next/static",
        new URL(entry.url).pathname.split("/_next/static/")[1],
      );
      const mapPath = `${compiled}.map`;
      if (!existsSync(mapPath))
        throw new Error(`Missing browser source map: ${compiled}`);
      browserMapped += mergeOwned(
        map,
        await convert(
          compiled,
          entry.source,
          entry.functions,
          JSON.parse(readFileSync(mapPath, "utf8")),
        ),
      );
    }
  }
  for (const file of readdirSync("coverage/node")) {
    const raw = JSON.parse(readFileSync(`coverage/node/${file}`, "utf8"));
    for (const entry of raw.result) {
      if (
        !entry.url.startsWith("file:") ||
        !entry.url.includes("/.next/server/")
      )
        continue;
      const compiled = fileURLToPath(entry.url);
      if (!existsSync(`${compiled}.map`)) continue;
      verifyMap(JSON.parse(readFileSync(`${compiled}.map`, "utf8")));
      nodeMapped += mergeOwned(
        map,
        await convert(compiled, undefined, entry.functions),
      );
    }
  }
  if (browserMapped === 0 || nodeMapped === 0)
    throw new Error("Missing remapped browser or real Node coverage");
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(path) && !/\.test\.|database.types/.test(path))
        files.push(path);
    }
  }
  walk("src");
  const raw = map.toJSON();
  writeFileSync("reports/merged-coverage.json", JSON.stringify(raw));
  const summary = assertCoverage(raw, files);
  const report = {
    ...summary,
    files: files.length,
    browserMapped,
    nodeMapped,
    branches: map.getCoverageSummary().branches,
  };
  writeFileSync(
    "reports/coverage-summary.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await checkCoverage();
