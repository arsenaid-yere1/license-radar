// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const b = vi.hoisted(() => ({
  create: vi.fn(),
  rpc: vi.fn(),
  bucket: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  info: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: b.create }));
import * as gateway from "@/lib/evidence/storage";
import {
  evidenceConfigured,
  evidenceEnabled,
  cleanupSecret,
} from "@/lib/evidence/config";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  path = Array(5).fill(id).join("/") + ".pdf";
const meta = {
    path,
    mime: "application/pdf",
    byteCount: 8,
    digest: "a".repeat(64),
  },
  claim = {
    status: "upload",
    evidenceId: id,
    objectId: id,
    token: id,
    ...meta,
  };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "local-fixture-only-evidence-secret");
  vi.stubEnv("RENEWAL_EVIDENCE_ENABLED", "true");
  vi.stubEnv("EVIDENCE_CLEANUP_SECRET", "local-fixture-only-evidence-cleanup");
  b.from.mockReturnValue({
    upload: b.upload,
    download: b.download,
    remove: b.remove,
    info: b.info,
  });
  b.create.mockReturnValue({
    rpc: b.rpc,
    storage: { getBucket: b.bucket, from: b.from },
  });
  b.bucket.mockResolvedValue({
    data: {
      public: false,
      file_size_limit: 3145728,
      allowed_mime_types: ["application/pdf", "image/jpeg", "image/png"],
    },
    error: null,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("EV10 Storage requests keep the bounded network timeout and request options", async () => {
  const network = vi.fn().mockResolvedValue(new Response("fixture"));
  vi.stubGlobal("fetch", network);
  await gateway.evidenceStorageReady();
  const options = b.create.mock.calls[0][2];
  expect(options.auth).toEqual({
    persistSession: false,
    autoRefreshToken: false,
  });
  await options.global.fetch("http://127.0.0.1/fixture", {
    method: "GET",
    headers: { "x-fixture": "true" },
  });
  expect(network).toHaveBeenCalledWith("http://127.0.0.1/fixture", {
    method: "GET",
    headers: { "x-fixture": "true" },
    signal: expect.any(AbortSignal),
  });
});
it("EV02 EV10 independent config and exact private bucket readiness", async () => {
  expect(evidenceEnabled()).toBe(true);
  expect(evidenceConfigured()).toBe(true);
  expect(cleanupSecret()).toBe("local-fixture-only-evidence-cleanup");
  expect(await gateway.evidenceStorageReady()).toBe(true);
  expect(b.bucket).toHaveBeenCalledWith("renewal-evidence");
  b.bucket.mockResolvedValue({
    data: {
      public: false,
      file_size_limit: 3145728,
      allowed_mime_types: ["image/png", "image/jpeg", "application/pdf"],
    },
    error: null,
  });
  expect(await gateway.evidenceStorageReady()).toBe(true);
  vi.stubEnv("RENEWAL_EVIDENCE_ENABLED", "false");
  expect(evidenceEnabled()).toBe(false);
  expect(evidenceConfigured()).toBe(true);
  for (const data of [
    {
      public: true,
      file_size_limit: 3145728,
      allowed_mime_types: ["application/pdf", "image/jpeg", "image/png"],
    },
    {
      public: false,
      file_size_limit: 3145729,
      allowed_mime_types: ["application/pdf", "image/jpeg", "image/png"],
    },
    { public: false, file_size_limit: 3145728, allowed_mime_types: null },
  ]) {
    b.bucket.mockResolvedValue({ data, error: null });
    expect(await gateway.evidenceStorageReady()).toBe(false);
  }
  b.bucket.mockResolvedValue({ data: null, error: { message: "private" } });
  expect(await gateway.evidenceStorageReady()).toBe(false);
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  b.bucket.mockResolvedValue({
    data: {
      public: false,
      file_size_limit: 3145728,
      allowed_mime_types: ["application/pdf", "image/jpeg", "image/png"],
    },
    error: null,
  });
  expect(evidenceConfigured()).toBe(false);
  expect(await gateway.evidenceStorageReady()).toBe(false);
  expect(await gateway.claimUpload(id, id, id)).toEqual({
    status: "unavailable",
  });
});
it("EV04 EV05 exact named service calls validate reply contracts", async () => {
  b.rpc.mockResolvedValue({ data: claim, error: null });
  expect(await gateway.claimUpload(id, id, id)).toEqual(claim);
  expect(b.rpc).toHaveBeenLastCalledWith("claim_renewal_evidence_upload", {
    p_practice_id: id,
    p_actor_id: id,
    p_evidence_id: id,
  });
  const final = { status: "success", evidenceId: id, state: "available" };
  b.rpc.mockResolvedValue({ data: final, error: null });
  expect(await gateway.finalizeUpload(id, id, id, id, 8, meta.digest)).toEqual(
    final,
  );
  expect(b.rpc).toHaveBeenLastCalledWith("finalize_renewal_evidence_upload", {
    p_practice_id: id,
    p_actor_id: id,
    p_evidence_id: id,
    p_token: id,
    p_byte_count: 8,
    p_digest: meta.digest,
  });
  const download = {
    status: "download",
    accessId: id,
    filename: "proof.pdf",
    ...meta,
  };
  b.rpc.mockResolvedValue({ data: download, error: null });
  expect(await gateway.authorizeDownload(id, id, id, id, id)).toEqual(download);
  expect(b.rpc).toHaveBeenLastCalledWith(
    "authorize_renewal_evidence_download",
    {
      p_practice_id: id,
      p_actor_id: id,
      p_credential_id: id,
      p_cycle_id: id,
      p_evidence_id: id,
    },
  );
  b.rpc.mockResolvedValue({ data: true, error: null });
  expect(await gateway.recordDownloadFailure(id)).toBe(true);
  expect(b.rpc).toHaveBeenLastCalledWith("record_renewal_evidence_download", {
    p_access_id: id,
  });
  expect(await gateway.recordCleanup(id, id, true)).toBe(true);
  expect(b.rpc).toHaveBeenLastCalledWith("record_renewal_evidence_cleanup", {
    p_object_id: id,
    p_token: id,
    p_purged: true,
  });
  const cleanup = [{ objectId: id, token: id, path }];
  b.rpc.mockResolvedValue({ data: cleanup, error: null });
  expect(await gateway.claimCleanup()).toEqual(cleanup);
  expect(b.rpc).toHaveBeenLastCalledWith("claim_renewal_evidence_cleanup", {
    p_evidence_id: null,
  });
  expect(await gateway.claimCleanup(id)).toEqual(cleanup);
  expect(b.rpc).toHaveBeenLastCalledWith("claim_renewal_evidence_cleanup", {
    p_evidence_id: id,
  });
  for (const data of [{ status: "bad" }, null, { status: "upload", ...meta }]) {
    b.rpc.mockResolvedValue({ data, error: null });
    expect(await gateway.claimUpload(id, id, id)).toEqual({
      status: "unavailable",
    });
    expect(
      await gateway.finalizeUpload(id, id, id, id, 8, meta.digest),
    ).toEqual({ status: "unavailable" });
    expect(await gateway.authorizeDownload(id, id, id, id, id)).toEqual({
      status: "unavailable",
    });
    expect(await gateway.claimCleanup(id)).toBeNull();
    expect(await gateway.recordCleanup(id, id, false)).toBe(false);
    expect(await gateway.recordDownloadFailure(id)).toBe(false);
  }
  b.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect(await gateway.claimUpload(id, id, id)).toEqual({
    status: "forbidden",
  });
  expect(await gateway.finalizeUpload(id, id, id, id, 8, meta.digest)).toEqual({
    status: "forbidden",
  });
  expect(await gateway.authorizeDownload(id, id, id, id, id)).toEqual({
    status: "forbidden",
  });
  expect(await gateway.recordCleanup(id, id, true)).toBe(false);
  expect(await gateway.recordDownloadFailure(id)).toBe(false);
  expect(await gateway.claimCleanup(id)).toBeNull();
  b.rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
  expect(await gateway.claimUpload(id, id, id)).toEqual({
    status: "unavailable",
  });
  b.rpc.mockRejectedValue(new Error("private"));
  expect(await gateway.claimUpload(id, id, id)).toEqual({
    status: "unavailable",
  });
});
it("EV04 EV06 immutable writes bounded reads and verified API purge", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  b.upload.mockResolvedValue({ error: null });
  expect(await gateway.writeObject(path, bytes, "application/pdf")).toBe(true);
  expect(b.from).toHaveBeenCalledWith("renewal-evidence");
  expect(b.upload).toHaveBeenCalledWith(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
    cacheControl: "0",
  });
  b.upload.mockResolvedValue({ error: { message: "private" } });
  expect(await gateway.writeObject(path, bytes, "application/pdf")).toBe(false);
  b.upload.mockResolvedValue({ error: null });
  expect(await gateway.writeObject("../unsafe", bytes, "application/pdf")).toBe(
    false,
  );
  b.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
  expect(await gateway.readObject("../unsafe")).toBeNull();
  expect(await gateway.readObject(path)).toEqual(bytes);
  expect(b.download).toHaveBeenCalledWith(path);
  b.download.mockResolvedValue({ data: null, error: { message: "private" } });
  expect(await gateway.readObject(path)).toBeNull();
  b.download.mockRejectedValue(new Error("offline"));
  expect(await gateway.readObject(path)).toBeNull();
  b.remove.mockResolvedValue({ error: null });
  b.info.mockResolvedValue({ error: { code: "NoSuchKey" } });
  expect(await gateway.purgeObject(path)).toBe(true);
  expect(b.remove).toHaveBeenCalledWith([path]);
  expect(b.info).toHaveBeenCalledWith(path);
  b.info.mockResolvedValue({ error: null, data: { size: 3 } });
  expect(await gateway.purgeObject(path)).toBe(false);
  b.info.mockResolvedValue({ error: { code: "NoSuchBucket" } });
  expect(await gateway.purgeObject(path)).toBe(false);
  b.info.mockResolvedValue({ error: { code: "NoSuchKey" } });
  b.remove.mockResolvedValue({ error: { message: "offline" } });
  expect(await gateway.purgeObject(path)).toBe(false);
  b.remove.mockResolvedValue({ error: null });
  expect(await gateway.purgeObject("../unsafe")).toBe(false);
  b.remove.mockRejectedValue(new Error("offline"));
  expect(await gateway.purgeObject(path)).toBe(false);
});
