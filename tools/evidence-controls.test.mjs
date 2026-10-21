import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertEvidenceCapabilities,
  assertEvidenceLayers,
} from "./evidence-controls.mjs";
import { assertEvidenceBucket } from "./evidence-storage.mjs";
const files = new Map(
  ["config", "storage"].map((name) => [
    `src/lib/evidence/${name}.ts`,
    readFileSync(`src/lib/evidence/${name}.ts`, "utf8"),
  ]),
);
test("EV10 evidence capability controls reject raw export and missing server marker", () => {
  assertEvidenceCapabilities(files);
  for (const patch of [
    "export const leaked=client;",
    "export {createClient};",
    "export function createSignedUrl() {}",
  ]) {
    const changed = new Map(files);
    changed.set(
      "src/lib/evidence/storage.ts",
      files.get("src/lib/evidence/storage.ts") + patch,
    );
    assert.throws(
      () => assertEvidenceCapabilities(changed),
      /raw\/generic|bearer\/public/,
    );
  }
  const changed = new Map(files);
  changed.set(
    "src/lib/evidence/config.ts",
    files
      .get("src/lib/evidence/config.ts")
      .replace('import "server-only";', ""),
  );
  assert.throws(() => assertEvidenceCapabilities(changed), /marker missing/);
});
test("EV10 bucket and layer gates fail on known unsafe inputs", () => {
  const bucket = {
    id: "renewal-evidence",
    public: false,
    file_size_limit: 3145728,
    allowed_mime_types: ["application/pdf", "image/jpeg", "image/png"],
  };
  assertEvidenceBucket(bucket);
  for (const patch of [
    { public: true },
    { file_size_limit: 3145729 },
    { allowed_mime_types: ["text/html"] },
    { id: "other" },
  ])
    assert.throws(() => assertEvidenceBucket({ ...bucket, ...patch }));
  const layers = JSON.parse(readFileSync("tools/layers.json", "utf8"));
  assertEvidenceLayers(layers);
  assert.throws(
    () =>
      assertEvidenceLayers(layers.filter((l) => l.id !== "evidence-storage")),
    /Missing\/duplicate/,
  );
  assert.throws(
    () =>
      assertEvidenceLayers(
        layers.map((l) =>
          l.id === "evidence-storage" ? { ...l, args: [] } : l,
        ),
      ),
    /Wrong evidence/,
  );
});
