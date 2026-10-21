import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPracticeAccess } from "@/lib/practice/access";
import { authenticationRequired } from "@/lib/auth/operations";
import { z } from "zod";
import { evidenceId, removeInputSchema, type EvidenceResult } from "./schema";
import {
  evidenceFile,
  boundedBody,
  EvidenceInputError,
  MAX_REQUEST_BYTES,
  bytesDigest,
  attachmentDisposition,
} from "./validation";
import { reserveEvidence, removeEvidence } from "./repository";
import { evidenceMessage, evidenceStatus } from "./messages";
import { cleanEvidence } from "./cleanup";
import type * as storage from "./storage";
export type EvidenceGateway = typeof storage;
export type EvidenceDeps = {
  client: () => Promise<SupabaseClient>;
  configured: () => boolean;
  ready: () => Promise<boolean>;
  gateway: EvidenceGateway;
};
export type EvidenceParams = {
  credentialId: string;
  cycleId: string;
  evidenceId?: string;
};
const paramsSchema = z.object({
  credentialId: evidenceId,
  cycleId: evidenceId,
  evidenceId: evidenceId.optional(),
});
const headers = {
  "cache-control": "private, no-store",
  vary: "Cookie",
  "x-content-type-options": "nosniff",
};
function reply(result: EvidenceResult, code = evidenceStatus(result)) {
  const state = result.status === "success" ? result.state : result.status;
  return Response.json(
    { ...result, message: evidenceMessage(state) },
    { status: code, headers },
  );
}
async function identity(client: SupabaseClient, write: boolean) {
  const { data, error } = await client.auth.getUser();
  if (error && !authenticationRequired(error.status)) throw new Error();
  if (error || !data.user) return null;
  const access = await getPracticeAccess(client);
  if (access.status !== "success") throw new Error();
  if (!access.access || (write && access.access.role === "viewer"))
    return { status: "forbidden" } as const;
  return {
    status: "success",
    actorId: data.user.id,
    practiceId: access.access.practice.id,
  } as const;
}
function boundPath(
  path: string,
  practiceId: string,
  params: EvidenceParams,
  evidenceId: string,
) {
  return path.startsWith(
    `${practiceId}/${params.credentialId}/${params.cycleId}/${evidenceId}/`,
  );
}
function sameOrigin(request: Request) {
  const target = new URL(request.url);
  target.host = request.headers.get("host") ?? target.host;
  return request.headers.get("origin") === target.origin;
}
async function upload(
  request: Request,
  client: SupabaseClient,
  practiceId: string,
  actorId: string,
  params: EvidenceParams,
  gateway: EvidenceGateway,
) {
  const input = await uploadInput(request);
  if (input === null) return reply({ status: "invalid" });
  const checked = await evidenceFile(input.file),
    reserved = await reserveEvidence(
      client,
      practiceId,
      params.credentialId,
      params.cycleId,
      input.key,
      checked,
    );
  if (reserved.status !== "success" || reserved.state !== "pending")
    return reply(reserved);
  const claim = await gateway.claimUpload(
    practiceId,
    actorId,
    reserved.evidenceId,
  );
  if (claim.status === "available")
    return reply(
      await reserveEvidence(
        client,
        practiceId,
        params.credentialId,
        params.cycleId,
        input.key,
        checked,
      ),
    );
  if (claim.status !== "upload") return reply(claim);
  if (!matchingUpload(claim, checked, practiceId, params, reserved.evidenceId))
    return reply({ status: "unavailable" });
  const stored = await reconcileObject(claim.path, checked, gateway);
  if (stored === null) return reply({ status: "unavailable" });
  const final = await gateway.finalizeUpload(
    practiceId,
    actorId,
    reserved.evidenceId,
    claim.token,
    stored.length,
    bytesDigest(stored),
  );
  if (final.status === "success" && final.evidenceId !== reserved.evidenceId)
    return reply({ status: "unavailable" });
  return reply(final);
}
async function uploadInput(request: Request) {
  const contentType = request.headers.get("content-type");
  if (!contentType) throw new EvidenceInputError();
  const bytes = await boundedBody(request, MAX_REQUEST_BYTES);
  const form = await new Response(bytes as BodyInit, {
    headers: { "content-type": contentType },
  })
    .formData()
    .catch(() => {
      throw new EvidenceInputError();
    });
  if (
    [...form.keys()].some((k) => !["file", "requestId"].includes(k)) ||
    form.getAll("file").length !== 1 ||
    form.getAll("requestId").length !== 1
  )
    return null;
  const file = form.get("file"),
    key = evidenceId.safeParse(form.get("requestId"));
  if (!file || typeof file === "string" || !key.success) return null;
  return { file, key: key.data };
}
function matchingUpload(
  claim: {
    evidenceId: string;
    path: string;
    byteCount: number;
    digest: string;
    mime: string;
  },
  checked: { byteCount: number; digest: string; mime: string },
  practiceId: string,
  params: EvidenceParams,
  id: string,
) {
  return (
    claim.evidenceId === id &&
    claim.byteCount === checked.byteCount &&
    claim.digest === checked.digest &&
    claim.mime === checked.mime &&
    boundPath(claim.path, practiceId, params, id)
  );
}
async function reconcileObject(
  path: string,
  checked: {
    bytes: Uint8Array;
    mime: string;
    digest: string;
  },
  gateway: EvidenceGateway,
) {
  // Reconcile an uncertain prior write; an existing object is never overwritten.
  let stored = await gateway.readObject(path);
  if (stored === null) {
    await gateway.writeObject(path, checked.bytes, checked.mime);
    stored = await gateway.readObject(path);
  }
  if (stored === null || bytesDigest(stored) !== checked.digest) return null;
  return stored;
}
async function download(
  practiceId: string,
  actorId: string,
  params: EvidenceParams,
  gateway: EvidenceGateway,
) {
  const grant = await gateway.authorizeDownload(
    practiceId,
    actorId,
    params.credentialId,
    params.cycleId,
    params.evidenceId!,
  );
  if (grant.status !== "download") return reply(grant);
  if (!boundPath(grant.path, practiceId, params, params.evidenceId!))
    return reply({ status: "unavailable" });
  const bytes = await gateway.readObject(grant.path);
  if (
    bytes === null ||
    bytes.length !== grant.byteCount ||
    bytesDigest(bytes) !== grant.digest
  ) {
    await gateway.recordDownloadFailure(grant.accessId);
    return reply({ status: "unavailable" });
  }
  return new Response(bytes as BodyInit, {
    headers: {
      ...headers,
      "content-type": grant.mime,
      "content-length": String(bytes.length),
      "content-disposition": attachmentDisposition(grant.filename),
    },
  });
}
async function remove(
  request: Request,
  client: SupabaseClient,
  practiceId: string,
  params: EvidenceParams,
  gateway: EvidenceGateway,
) {
  const input = removeInputSchema.safeParse(
    JSON.parse(new TextDecoder().decode(await boundedBody(request, 2048))),
  );
  if (!input.success) return reply({ status: "invalid" });
  const result = await removeEvidence(
    client,
    practiceId,
    params.credentialId,
    params.cycleId,
    params.evidenceId!,
    input.data,
  );
  if (result.status !== "success") return reply(result);
  if (result.evidenceId !== params.evidenceId)
    return reply({ status: "unavailable" });
  await cleanEvidence(result.evidenceId, gateway);
  return reply(
    await removeEvidence(
      client,
      practiceId,
      params.credentialId,
      params.cycleId,
      params.evidenceId!,
      input.data,
    ),
  );
}
export async function handleEvidence(
  request: Request,
  raw: EvidenceParams,
  deps: EvidenceDeps,
) {
  try {
    const parsed = paramsSchema.safeParse(raw);
    if (!parsed.success) return reply({ status: "not-found" });
    const params = parsed.data,
      blocked = requestGuard(request, params);
    if (blocked) return blocked;
    return await authorizedRequest(request, params, deps);
  } catch (error) {
    if (error instanceof EvidenceInputError)
      return reply({ status: "invalid" }, error.status);
    if (error instanceof SyntaxError) return reply({ status: "invalid" });
    return reply({ status: "unavailable" });
  }
}
function requestGuard(request: Request, params: EvidenceParams) {
  if (!["POST", "GET", "DELETE"].includes(request.method))
    return reply({ status: "invalid" }, 405);
  if (
    (request.method !== "POST" && !params.evidenceId) ||
    (request.method === "POST" && params.evidenceId)
  )
    return reply({ status: "not-found" });
  if (request.headers.has("range")) return reply({ status: "invalid" });
  if (request.method !== "GET" && !sameOrigin(request))
    return reply({ status: "forbidden" });
  return null;
}
async function authorizedRequest(
  request: Request,
  params: EvidenceParams,
  deps: EvidenceDeps,
) {
  const client = await deps.client(),
    who = await identity(client, request.method !== "GET");
  if (!who)
    return Response.json(
      {
        status: "auth-required",
        message: "Sign in to access renewal evidence.",
      },
      { status: 401, headers },
    );
  if (who.status !== "success") return reply(who);
  if (!deps.configured() || !(await deps.ready()))
    return reply({ status: "unavailable" });
  if (request.method === "POST")
    return await upload(
      request,
      client,
      who.practiceId,
      who.actorId,
      params,
      deps.gateway,
    );
  if (request.method === "GET")
    return await download(who.practiceId, who.actorId, params, deps.gateway);
  return await remove(request, client, who.practiceId, params, deps.gateway);
}
