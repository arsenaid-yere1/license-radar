import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { evidenceConfigured } from "./config";
import {
  uploadClaimSchema,
  downloadSchema,
  terminalSchema,
  resultSchema,
  cleanupClaimSchema,
  objectPath,
} from "./schema";
const bucket = "renewal-evidence";
function client() {
  if (!evidenceConfigured()) throw new Error();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
      },
    },
  );
}
async function rpc(name: string, args: Record<string, unknown>) {
  try {
    const { data, error } = await client().rpc(name, args);
    if (error)
      return {
        status: error.code === "42501" ? "forbidden" : "unavailable",
        data: null,
      } as const;
    return { status: "reply", data } as const;
  } catch {
    return { status: "unavailable", data: null } as const;
  }
}
export async function evidenceStorageReady() {
  try {
    const { data, error } = await client().storage.getBucket(bucket);
    return (
      !error &&
      data.public === false &&
      Number(data.file_size_limit) === 3145728 &&
      JSON.stringify([...data.allowed_mime_types!].sort()) ===
        JSON.stringify(["application/pdf", "image/jpeg", "image/png"])
    );
  } catch {
    return false;
  }
}
export async function claimUpload(
  practiceId: string,
  actorId: string,
  evidenceId: string,
) {
  const reply = await rpc("claim_renewal_evidence_upload", {
    p_practice_id: practiceId,
    p_actor_id: actorId,
    p_evidence_id: evidenceId,
  });
  if (reply.status !== "reply") return { status: reply.status };
  const parsed = z
    .union([uploadClaimSchema, terminalSchema])
    .safeParse(reply.data);
  return parsed.success ? parsed.data : ({ status: "unavailable" } as const);
}
export async function finalizeUpload(
  practiceId: string,
  actorId: string,
  evidenceId: string,
  token: string,
  byteCount: number,
  digest: string,
) {
  const reply = await rpc("finalize_renewal_evidence_upload", {
    p_practice_id: practiceId,
    p_actor_id: actorId,
    p_evidence_id: evidenceId,
    p_token: token,
    p_byte_count: byteCount,
    p_digest: digest,
  });
  if (reply.status !== "reply") return { status: reply.status };
  const parsed = resultSchema.safeParse(reply.data);
  return parsed.success ? parsed.data : ({ status: "unavailable" } as const);
}
export async function authorizeDownload(
  practiceId: string,
  actorId: string,
  credentialId: string,
  cycleId: string,
  evidenceId: string,
) {
  const reply = await rpc("authorize_renewal_evidence_download", {
    p_practice_id: practiceId,
    p_actor_id: actorId,
    p_credential_id: credentialId,
    p_cycle_id: cycleId,
    p_evidence_id: evidenceId,
  });
  if (reply.status !== "reply") return { status: reply.status };
  const parsed = z
    .union([downloadSchema, terminalSchema])
    .safeParse(reply.data);
  return parsed.success ? parsed.data : ({ status: "unavailable" } as const);
}
export async function recordDownloadFailure(accessId: string) {
  const reply = await rpc("record_renewal_evidence_download", {
    p_access_id: accessId,
  });
  return reply.data === true;
}
export async function claimCleanup(evidenceId: string | null = null) {
  const reply = await rpc("claim_renewal_evidence_cleanup", {
    p_evidence_id: evidenceId,
  });
  const parsed = z.array(cleanupClaimSchema).max(20).safeParse(reply.data);
  return parsed.success ? parsed.data : null;
}
export async function recordCleanup(
  objectId: string,
  token: string,
  purged: boolean,
) {
  const reply = await rpc("record_renewal_evidence_cleanup", {
    p_object_id: objectId,
    p_token: token,
    p_purged: purged,
  });
  return reply.data === true;
}
export async function writeObject(
  path: string,
  bytes: Uint8Array,
  mime: string,
) {
  try {
    objectPath.parse(path);
    const { error } = await client().storage.from(bucket).upload(path, bytes, {
      contentType: mime,
      upsert: false,
      cacheControl: "0",
    });
    return !error;
  } catch {
    return false;
  }
}
export async function readObject(path: string) {
  try {
    objectPath.parse(path);
    const { data, error } = await client().storage.from(bucket).download(path);
    return error ? null : new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}
export async function purgeObject(path: string) {
  try {
    objectPath.parse(path);
    const c = client(),
      removed = await c.storage.from(bucket).remove([path]);
    if (removed.error) return false;
    const read = await c.storage.from(bucket).info(path);
    return (
      read.error !== null &&
      "code" in read.error &&
      read.error.code === "NoSuchKey"
    );
  } catch {
    return false;
  }
}
