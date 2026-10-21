// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleEvidence, type EvidenceDeps } from "@/lib/evidence/operations";
import { bytesDigest } from "@/lib/evidence/validation";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  cycle = "bbbbbbbb-0000-4000-8000-000000000002",
  fileId = "cccccccc-0000-4000-8000-000000000003",
  objectId = "dddddddd-0000-4000-8000-000000000004";
const params = { credentialId: id, cycleId: cycle },
  path = `${id}/${id}/${cycle}/${fileId}/${objectId}.pdf`,
  bytes = new TextEncoder().encode("%PDF-1.7\nfixture\n%%EOF\n");
const rpc = vi.fn(),
  auth = vi.fn(),
  from = vi.fn();
let deps: EvidenceDeps;
function request(
  body: BodyInit | null = null,
  method = "POST",
  headers: HeadersInit = { origin: "http://app.test" },
) {
  return new Request("http://app.test/api", { method, body, headers });
}
function form() {
  const f = new FormData();
  f.set("requestId", id);
  f.set("file", new File([bytes], "proof.pdf", { type: "application/pdf" }));
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ data: { user: { id } }, error: null });
  from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: () =>
        Promise.resolve({
          data:
            table === "practices"
              ? { id, name: "Practice", timezone: "UTC" }
              : { practice_id: id, role: "manager", version: 1 },
          error: null,
        }),
    };
    return query;
  });
  rpc.mockResolvedValue({
    data: { status: "success", evidenceId: fileId, state: "pending" },
    error: null,
  });
  deps = {
    client: async () =>
      ({ auth: { getUser: auth }, from, rpc }) as unknown as SupabaseClient,
    configured: () => true,
    ready: vi.fn().mockResolvedValue(true),
    gateway: {
      evidenceStorageReady: vi.fn().mockResolvedValue(true),
      claimUpload: vi.fn().mockResolvedValue({
        status: "upload",
        evidenceId: fileId,
        objectId,
        token: id,
        path,
        mime: "application/pdf",
        byteCount: bytes.length,
        digest: bytesDigest(bytes),
      }),
      readObject: vi.fn().mockResolvedValue(bytes),
      writeObject: vi.fn().mockResolvedValue(true),
      finalizeUpload: vi.fn().mockResolvedValue({
        status: "success",
        evidenceId: fileId,
        state: "available",
      }),
      authorizeDownload: vi.fn().mockResolvedValue({
        status: "download",
        accessId: id,
        path,
        filename: "proof.pdf",
        mime: "application/pdf",
        byteCount: bytes.length,
        digest: bytesDigest(bytes),
      }),
      recordDownloadFailure: vi.fn().mockResolvedValue(true),
      claimCleanup: vi.fn().mockResolvedValue([]),
      purgeObject: vi.fn().mockResolvedValue(true),
      recordCleanup: vi.fn().mockResolvedValue(true),
    },
  };
});
it("EV03 EV04 upload binds computed metadata reconciles existing bytes and exact identity", async () => {
  const r = await handleEvidence(request(form()), params, deps);
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ state: "available" });
  expect(rpc).toHaveBeenCalledWith(
    "reserve_renewal_evidence",
    expect.objectContaining({
      p_practice_id: id,
      p_credential_id: id,
      p_cycle_id: cycle,
      p_digest: bytesDigest(bytes),
      p_byte_count: bytes.length,
    }),
  );
  expect(deps.gateway.writeObject).not.toHaveBeenCalled();
  expect(deps.gateway.finalizeUpload).toHaveBeenCalledWith(
    id,
    id,
    fileId,
    id,
    bytes.length,
    bytesDigest(bytes),
  );
  vi.mocked(deps.gateway.readObject)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(bytes);
  expect((await handleEvidence(request(form()), params, deps)).status).toBe(
    200,
  );
  expect(deps.gateway.writeObject).toHaveBeenCalledWith(
    path,
    bytes,
    "application/pdf",
  );
});
it("EV05 download verifies bytes and sends safe private attachment", async () => {
  const r = await handleEvidence(
    request(null, "GET", {}),
    { ...params, evidenceId: fileId },
    deps,
  );
  expect(r.status).toBe(200);
  expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(r.headers.get("vary")).toBe("Cookie");
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  expect(r.headers.get("content-disposition")).toContain("attachment;");
  expect(deps.gateway.authorizeDownload).toHaveBeenCalledWith(
    id,
    id,
    id,
    cycle,
    fileId,
  );
  expect(
    vi.mocked(deps.gateway.authorizeDownload).mock.invocationCallOrder[0],
  ).toBeLessThan(
    vi.mocked(deps.gateway.readObject).mock.invocationCallOrder[0],
  );
});
it("EV02 EV05 failed audit authorization unavailable objects and hostile binding never release bytes", async () => {
  vi.mocked(deps.gateway.authorizeDownload).mockResolvedValue({
    status: "forbidden",
  });
  expect(
    (
      await handleEvidence(
        request(null, "GET", {}),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(403);
  expect(deps.gateway.readObject).not.toHaveBeenCalled();
  vi.mocked(deps.gateway.authorizeDownload).mockResolvedValue({
    status: "download",
    accessId: id,
    path,
    filename: "proof.pdf",
    mime: "application/pdf",
    byteCount: bytes.length,
    digest: "a".repeat(64),
  });
  expect(
    (
      await handleEvidence(
        request(null, "GET", {}),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(503);
  expect(deps.gateway.recordDownloadFailure).toHaveBeenCalledWith(id);
  vi.mocked(deps.gateway.claimUpload).mockResolvedValue({ status: "busy" });
  expect((await handleEvidence(request(form()), params, deps)).status).toBe(
    409,
  );
});
it("EV02 EV03 configuration identity origin malformed and duplicate inputs fail closed", async () => {
  for (const raw of [
    { ...params, credentialId: "bad" },
    { credentialId: id, cycleId: cycle, evidenceId: fileId },
  ])
    expect((await handleEvidence(request(form()), raw, deps)).status).toBe(404);
  expect(
    (await handleEvidence(request(form(), "POST", {}), params, deps)).status,
  ).toBe(403);
  expect(
    (
      await handleEvidence(
        request(form(), "POST", { origin: "https://foreign.test" }),
        params,
        deps,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleEvidence(
        request(null, "HEAD", {}),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(405);
  expect(
    (
      await handleEvidence(
        request(null, "GET", { range: "bytes=0-1" }),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(400);
  for (const change of [
    (f: FormData) => f.append("file", new File([bytes], "other.pdf")),
    (f: FormData) => f.append("requestId", id),
    (f: FormData) => f.append("actor", id),
    (f: FormData) => f.set("file", "fake"),
    (f: FormData) => f.set("requestId", "bad"),
  ]) {
    const f = form();
    change(f);
    expect((await handleEvidence(request(f), params, deps)).status).toBe(400);
  }
  auth.mockResolvedValue({ data: { user: null }, error: null });
  const unsigned = await handleEvidence(request(form()), params, deps);
  expect(unsigned.status).toBe(401);
  expect(await unsigned.json()).toEqual({
    status: "auth-required",
    message: "Sign in to access renewal evidence.",
  });
  auth.mockResolvedValue({ data: { user: null }, error: { status: 500 } });
  expect((await handleEvidence(request(form()), params, deps)).status).toBe(
    503,
  );
  auth.mockResolvedValue({ data: { user: { id } }, error: null });
  deps.configured = () => false;
  expect((await handleEvidence(request(form()), params, deps)).status).toBe(
    503,
  );
  expect(deps.gateway.writeObject).not.toHaveBeenCalled();
});
it("EV06 removal refreshes authoritative state after bounded cleanup", async () => {
  rpc
    .mockResolvedValueOnce({
      data: { status: "success", evidenceId: fileId, state: "deleting" },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { status: "success", evidenceId: fileId, state: "deleted" },
      error: null,
    });
  const r = await handleEvidence(
    request(
      JSON.stringify({ requestId: id, expectedVersion: 2, confirmed: true }),
      "DELETE",
    ),
    { ...params, evidenceId: fileId },
    deps,
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ state: "deleted" });
  expect(deps.gateway.claimCleanup).toHaveBeenCalledWith(fileId);
  expect(
    (
      await handleEvidence(
        request("not-json", "DELETE"),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handleEvidence(
        request(
          JSON.stringify({
            requestId: id,
            expectedVersion: 2,
            confirmed: false,
          }),
          "DELETE",
        ),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(400);
});
it("EV03 incoming host defines same origin when Next uses an internal request URL", async () => {
  const real = new Request("http://localhost:3000/api", {
    method: "POST",
    body: form(),
    headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
  });
  expect((await handleEvidence(real, params, deps)).status).toBe(200);
  const hostile = new Request("http://localhost:3000/api", {
    method: "POST",
    body: form(),
    headers: { origin: "https://foreign.test", host: "127.0.0.1:3000" },
  });
  expect((await handleEvidence(hostile, params, deps)).status).toBe(403);
});
it("EV04 a concurrent completed upload returns its authoritative receipt", async () => {
  vi.mocked(deps.gateway.claimUpload).mockResolvedValue({
    status: "available",
  });
  rpc
    .mockResolvedValueOnce({
      data: { status: "success", evidenceId: fileId, state: "pending" },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { status: "success", evidenceId: fileId, state: "available" },
      error: null,
    });
  const result = await handleEvidence(request(form()), params, deps);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    status: "success",
    evidenceId: fileId,
    state: "available",
  });
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
  expect(deps.gateway.writeObject).not.toHaveBeenCalled();
});
it("EV03 EV04 every mismatched upload claim or object fails before finalization", async () => {
  const claim = await deps.gateway.claimUpload(id, id, fileId);
  expect(claim.status).toBe("upload");
  for (const patch of [
    { evidenceId: id },
    { path: path.replace(cycle, id) },
    { byteCount: bytes.length + 1 },
    { digest: "a".repeat(64) },
    { mime: "image/png" },
  ]) {
    vi.mocked(deps.gateway.claimUpload).mockResolvedValue({
      ...claim,
      ...patch,
    } as Awaited<ReturnType<typeof deps.gateway.claimUpload>>);
    expect((await handleEvidence(request(form()), params, deps)).status).toBe(
      503,
    );
  }
  expect(deps.gateway.readObject).not.toHaveBeenCalled();
  vi.mocked(deps.gateway.claimUpload).mockResolvedValue(claim);
  for (const stored of [null, bytes.slice(1), new Uint8Array(bytes.length)]) {
    vi.mocked(deps.gateway.readObject).mockResolvedValue(stored);
    expect((await handleEvidence(request(form()), params, deps)).status).toBe(
      503,
    );
  }
  expect(deps.gateway.finalizeUpload).not.toHaveBeenCalled();
  vi.mocked(deps.gateway.readObject).mockResolvedValue(bytes);
  vi.mocked(deps.gateway.finalizeUpload).mockResolvedValue({
    status: "success",
    evidenceId: id,
    state: "available",
  });
  expect((await handleEvidence(request(form()), params, deps)).status).toBe(
    503,
  );
});
it("EV02 EV03 unavailable practice viewer writes malformed media and oversized streams fail closed", async () => {
  from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return query;
  });
  expect((await handleEvidence(request(form()), params, deps)).status).toBe(
    403,
  );
  from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data:
          table === "practices"
            ? { id, name: "Practice", timezone: "UTC" }
            : { practice_id: id, role: "viewer", version: 1 },
        error: null,
      }),
    };
    return query;
  });
  expect((await handleEvidence(request(form()), params, deps)).status).toBe(
    403,
  );
  expect(rpc).not.toHaveBeenCalled();
  expect(
    (
      await handleEvidence(
        request(null, "GET", {}),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(200);
  from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: null, error: { message: "offline" } }),
    };
    return query;
  });
  expect((await handleEvidence(request(form()), params, deps)).status).toBe(
    503,
  );
  auth.mockRejectedValue(new Error("auth offline"));
  expect((await handleEvidence(request(form()), params, deps)).status).toBe(
    503,
  );
});
it("EV05 unbound grants missing bytes and wrong sizes never produce attachments", async () => {
  const grant = await deps.gateway.authorizeDownload(id, id, id, cycle, fileId);
  expect(grant.status).toBe("download");
  vi.mocked(deps.gateway.readObject).mockClear();
  vi.mocked(deps.gateway.authorizeDownload).mockResolvedValue({
    ...grant,
    path: path.replace(cycle, id),
  } as Awaited<ReturnType<typeof deps.gateway.authorizeDownload>>);
  expect(
    (
      await handleEvidence(
        request(null, "GET", {}),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(503);
  expect(deps.gateway.readObject).not.toHaveBeenCalled();
  vi.mocked(deps.gateway.authorizeDownload).mockResolvedValue(grant);
  for (const stored of [null, bytes.slice(1)]) {
    vi.mocked(deps.gateway.readObject).mockResolvedValue(stored);
    expect(
      (
        await handleEvidence(
          request(null, "GET", {}),
          { ...params, evidenceId: fileId },
          deps,
        )
      ).status,
    ).toBe(503);
  }
  expect(deps.gateway.recordDownloadFailure).toHaveBeenCalledTimes(2);
  vi.mocked(deps.gateway.readObject).mockResolvedValue(bytes);
  vi.mocked(deps.gateway.authorizeDownload).mockResolvedValue({
    ...grant,
    byteCount: bytes.length + 1,
  } as Awaited<ReturnType<typeof deps.gateway.authorizeDownload>>);
  expect(
    (
      await handleEvidence(
        request(null, "GET", {}),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(503);
  expect(
    (await handleEvidence(request(null, "GET", {}), params, deps)).status,
  ).toBe(404);
});
it("EV06 failed or unrelated removal receipts never start physical cleanup", async () => {
  const body = JSON.stringify({
    requestId: id,
    expectedVersion: 2,
    confirmed: true,
  });
  rpc
    .mockResolvedValueOnce({ data: { status: "conflict" }, error: null })
    .mockResolvedValueOnce({
      data: { status: "success", evidenceId: id, state: "deleting" },
      error: null,
    });
  expect(
    (
      await handleEvidence(
        request(body, "DELETE"),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await handleEvidence(
        request(body, "DELETE"),
        { ...params, evidenceId: fileId },
        deps,
      )
    ).status,
  ).toBe(503);
  expect(deps.gateway.claimCleanup).not.toHaveBeenCalled();
});
it("EV04 available exact replay and terminal reservations never claim or rewrite files", async () => {
  for (const data of [
    { status: "success", evidenceId: fileId, state: "available" },
    { status: "quota" },
  ]) {
    rpc.mockResolvedValue({ data, error: null });
    const response = await handleEvidence(request(form()), params, deps);
    expect(response.status).toBe(data.status === "success" ? 200 : 409);
    expect(await response.json()).toMatchObject(data);
  }
  expect(deps.gateway.claimUpload).not.toHaveBeenCalled();
  expect(deps.gateway.writeObject).not.toHaveBeenCalled();
});
it("EV03 actual body bounds and malformed media never reserve evidence", async () => {
  const untyped = request(form());
  untyped.headers.delete("content-type");
  expect((await handleEvidence(untyped, params, deps)).status).toBe(400);
  for (const [body, status] of [
    ["not multipart", 400],
    ["a".repeat(3670017), 413],
  ] as const)
    expect((await handleEvidence(request(body), params, deps)).status).toBe(
      status,
    );
  const f = form();
  f.set("file", new File(["<html>"], "proof.pdf", { type: "application/pdf" }));
  expect((await handleEvidence(request(f), params, deps)).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  vi.mocked(deps.ready).mockResolvedValue(false);
  expect((await handleEvidence(request(form()), params, deps)).status).toBe(
    503,
  );
});
