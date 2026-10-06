import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recipientSchema, type RecipientResult } from "./schema";
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
export async function getRecipient(
  client: SupabaseClient,
  practiceId: string,
): Promise<RecipientResult> {
  const reply = await request(client, "get_practice_reminder_recipient", {
    p_practice_id: practiceId,
  });
  if (reply.status !== "reply") return reply;
  const parsed = recipientSchema.safeParse(reply.data);
  return parsed.success
    ? { status: "success", recipient: parsed.data }
    : { status: "unavailable" };
}
export async function setRecipient(
  client: SupabaseClient,
  practiceId: string,
  membershipId: string | null,
  version: number,
): Promise<RecipientResult> {
  const reply = await request(client, "set_practice_reminder_recipient", {
    p_practice_id: practiceId,
    p_membership_id: membershipId,
    p_expected_version: version,
  });
  if (reply.status !== "reply") return reply;
  const failure = z
    .object({ status: z.enum(["conflict", "invalid-recipient"]) })
    .safeParse(reply.data);
  if (failure.success) return failure.data;
  const parsed = z
    .object({ status: z.literal("success"), recipient: recipientSchema })
    .safeParse(reply.data);
  return parsed.success ? parsed.data : { status: "unavailable" };
}
