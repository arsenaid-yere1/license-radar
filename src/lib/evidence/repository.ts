import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { pageSchema, resultSchema, type EvidenceResult } from "./schema";
async function request(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    const { data, error } = await client.rpc(name, args);
    if (error)
      return {
        status: error.code === "42501" ? "forbidden" : "unavailable",
      } as const;
    return { status: "reply", data } as const;
  } catch {
    return { status: "unavailable" } as const;
  }
}
export async function readEvidence(
  client: SupabaseClient,
  practiceId: string,
  credentialId: string,
  cycleId: string,
) {
  const reply = await request(client, "get_renewal_evidence", {
    p_practice_id: practiceId,
    p_credential_id: credentialId,
    p_cycle_id: cycleId,
  });
  if (reply.status !== "reply") return reply;
  const parsed = z
    .union([
      pageSchema,
      z.object({
        status: z.enum(["not-found", "invalid", "forbidden", "unavailable"]),
      }),
    ])
    .safeParse(reply.data);
  if (!parsed.success) return { status: "unavailable" } as const;
  if (
    parsed.data.status === "success" &&
    (parsed.data.credentialId !== credentialId ||
      parsed.data.cycleId !== cycleId)
  )
    return { status: "unavailable" } as const;
  return parsed.data;
}
export async function reserveEvidence(
  client: SupabaseClient,
  practiceId: string,
  credentialId: string,
  cycleId: string,
  requestId: string,
  file: { filename: string; mime: string; byteCount: number; digest: string },
): Promise<EvidenceResult> {
  const reply = await request(client, "reserve_renewal_evidence", {
    p_practice_id: practiceId,
    p_credential_id: credentialId,
    p_cycle_id: cycleId,
    p_request_id: requestId,
    p_filename: file.filename,
    p_mime: file.mime,
    p_byte_count: file.byteCount,
    p_digest: file.digest,
  });
  if (reply.status !== "reply") return reply;
  const parsed = resultSchema.safeParse(reply.data);
  return parsed.success ? parsed.data : { status: "unavailable" };
}
export async function removeEvidence(
  client: SupabaseClient,
  practiceId: string,
  credentialId: string,
  cycleId: string,
  evidenceId: string,
  input: { requestId: string; expectedVersion: number; confirmed: true },
): Promise<EvidenceResult> {
  const reply = await request(client, "remove_renewal_evidence", {
    p_practice_id: practiceId,
    p_credential_id: credentialId,
    p_cycle_id: cycleId,
    p_evidence_id: evidenceId,
    p_request_id: input.requestId,
    p_expected_version: input.expectedVersion,
    p_confirmed: input.confirmed,
  });
  if (reply.status !== "reply") return reply;
  const parsed = resultSchema.safeParse(reply.data);
  return parsed.success ? parsed.data : { status: "unavailable" };
}
