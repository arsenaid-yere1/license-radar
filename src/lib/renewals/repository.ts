import { z } from "zod";
import { renewalHistorySchema } from "./history";
const historyReplySchema = z.union([
  renewalHistorySchema,
  z.object({ status: z.enum(["not-found", "invalid"]) }),
]);
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  completionResultSchema,
  renewalRegisterSchema,
  renewalResultSchema,
  type RenewalInput,
  type RenewalResult,
} from "./schema";
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
export async function getRenewalRegister(
  client: SupabaseClient,
  practiceId: string,
  archived = false,
) {
  const reply = await request(client, "list_practice_register_with_renewal", {
    p_practice_id: practiceId,
    p_include_archived: archived,
  });
  if (reply.status !== "reply") return reply;
  const parsed = renewalRegisterSchema.safeParse(reply.data);
  return parsed.success
    ? ({ status: "success", register: parsed.data } as const)
    : ({ status: "unavailable" } as const);
}
export async function saveRenewal(
  client: SupabaseClient,
  practiceId: string,
  input: RenewalInput,
): Promise<RenewalResult> {
  const name =
    input.intent === "complete"
      ? "complete_credential_renewal"
      : input.intent === "link"
        ? "set_credential_renewal_link"
        : input.intent === "progress"
          ? "set_credential_renewal_progress"
          : "acknowledge_credential_renewal";
  const reply = await request(client, name, {
    p_practice_id: practiceId,
    p_request_id: input.requestId,
    p_credential_id: input.id,
    p_expected_version: input.expectedVersion,
    p_expected_cycle_id: input.expectedCycleId,
    p_expected_date_revision: input.expectedDateRevision,
    p_expected_renewal_version: input.expectedRenewalVersion,
    ...(input.intent === "complete"
      ? {
          p_end_date: input.endDate,
          p_action_deadline: input.actionDeadline,
          p_confirmed: input.confirmed,
        }
      : input.intent === "link"
        ? { p_url: input.url }
        : input.intent === "progress"
          ? { p_status: input.progress }
          : {}),
  });
  if (reply.status !== "reply") return reply;
  const parsed = (
    input.intent === "complete" ? completionResultSchema : renewalResultSchema
  ).safeParse(reply.data);
  return parsed.success ? parsed.data : { status: "unavailable" };
}

export async function getRenewalHistory(
  client: SupabaseClient,
  practiceId: string,
  credentialId: string,
  before: number | null = null,
) {
  const reply = await request(client, "get_credential_renewal_history", {
    p_practice_id: practiceId,
    p_credential_id: credentialId,
    p_before_cycle_number: before,
  });
  if (reply.status !== "reply") return reply;
  const parsed = historyReplySchema.safeParse(reply.data);
  if (
    parsed.success &&
    parsed.data.status === "success" &&
    parsed.data.credentialId !== credentialId.toLowerCase()
  )
    return { status: "unavailable" } as const;
  return parsed.success ? parsed.data : ({ status: "unavailable" } as const);
}
