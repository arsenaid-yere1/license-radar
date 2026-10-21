import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { fixtureGuard, localConfig } from "./local-environment.mjs";
export const evidenceBucket = "renewal-evidence";
export const evidenceTypes = ["application/pdf", "image/jpeg", "image/png"];
export function assertEvidenceBucket(bucket) {
  assert.equal(bucket.id, evidenceBucket, "Unexpected evidence bucket");
  assert.equal(bucket.public, false, "Evidence bucket must be private");
  assert.equal(
    Number(bucket.file_size_limit),
    3145728,
    "Evidence file limit mismatch",
  );
  assert.deepEqual(
    [...bucket.allowed_mime_types].sort(),
    [...evidenceTypes].sort(),
    "Evidence MIME restrictions mismatch",
  );
}
export async function localEvidenceClient() {
  await fixtureGuard();
  const config = localConfig();
  const env = readFileSync(".env.local", "utf8");
  const url = /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(env)?.[1];
  const secret = /^SUPABASE_SECRET_KEY=(.+)$/m.exec(env)?.[1];
  assert.equal(
    url,
    config.API_URL,
    "Secret credential target differs from guarded local API",
  );
  assert(secret, "Missing guarded local evidence credential");
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
}
export async function provisionEvidenceStorage() {
  const client = await localEvidenceClient();
  const buckets = await client.storage.listBuckets();
  if (buckets.error) throw new Error("Local Storage API is unavailable");
  const existing = buckets.data.find((b) => b.id === evidenceBucket);
  if (existing) assertEvidenceBucket(existing);
  else {
    const created = await client.storage.createBucket(evidenceBucket, {
      public: false,
      fileSizeLimit: 3145728,
      allowedMimeTypes: evidenceTypes,
    });
    if (created.error)
      throw new Error("Could not provision private evidence bucket");
  }
  const read = await client.storage.getBucket(evidenceBucket);
  if (read.error) throw new Error("Could not verify evidence bucket");
  assertEvidenceBucket(read.data);
  return client;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await provisionEvidenceStorage();
  console.log(
    "Guarded local evidence bucket is private with exact size/type restrictions.",
  );
}
