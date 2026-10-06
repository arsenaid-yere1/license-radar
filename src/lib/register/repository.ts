import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  clinicianSchema,
  credentialSchema,
  registerSchema,
  type RegisterInput,
  type RegisterResult,
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
export async function getRegister(client: SupabaseClient, practiceId: string) {
  const reply = await request(client, "list_practice_register", {
    p_practice_id: practiceId,
  });
  if (reply.status !== "reply") return reply;
  const parsed = registerSchema.safeParse(reply.data);
  return parsed.success
    ? ({ status: "success", register: parsed.data } as const)
    : ({ status: "unavailable" } as const);
}
export async function createRecord(
  client: SupabaseClient,
  practiceId: string,
  input: RegisterInput,
): Promise<RegisterResult> {
  const clinician = input.intent === "clinician";
  const reply = await request(
    client,
    clinician
      ? "create_practice_clinician"
      : "create_practice_credential_with_details",
    {
      p_practice_id: practiceId,
      p_request_id: input.requestId,
      ...(input.intent === "clinician"
        ? { p_name: input.name }
        : {
            p_title: input.title,
            p_issuer: input.issuer,
            p_jurisdiction: input.jurisdiction,
            p_end_date: input.endDate,
            p_action_deadline: input.actionDeadline,
            p_type: input.type,
            p_owner_kind: input.ownerKind,
            p_owner_clinician_id: input.ownerClinicianId ?? null,
            p_covered_clinician_ids: input.coveredClinicianIds,
          }),
    },
  );
  if (reply.status !== "reply") return reply;
  const failure = z
    .object({
      status: z.enum(["invalid", "invalid-reference", "request-conflict"]),
      errors: z
        .object({
          issuer: z.literal("Use 1 to 120 characters.").optional(),
          jurisdiction: z.literal("Use 1 to 120 characters.").optional(),
          endDate: z.literal("Enter a valid date (YYYY-MM-DD).").optional(),
          actionDeadline: z
            .enum([
              "Enter a valid date (YYYY-MM-DD).",
              "The action deadline must be earlier than the end date.",
            ])
            .optional(),
        })
        .optional(),
    })
    .safeParse(reply.data);
  if (failure.success) return failure.data;
  const parsed = (
    clinician
      ? z.object({ status: z.literal("success"), clinician: clinicianSchema })
      : z.object({ status: z.literal("success"), credential: credentialSchema })
  ).safeParse(reply.data);
  return parsed.success ? parsed.data : { status: "unavailable" };
}
