import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordNumberError, recordNumberSchema } from "./numbers";
import {
  maintenanceCredentialSchema,
  maintenanceRegisterSchema,
  type MaintenanceInput,
  type MaintenanceResult,
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
function createRpcName(input: RegisterInput) {
  if (input.intent === "clinician") return "create_practice_clinician";
  return input.recordNumber !== undefined
    ? "create_practice_credential_with_number"
    : "create_practice_credential_with_details";
}
export async function createRecord(
  client: SupabaseClient,
  practiceId: string,
  input: RegisterInput,
): Promise<RegisterResult> {
  const clinician = input.intent === "clinician";
  const withNumber =
    input.intent === "credential" && input.recordNumber !== undefined;
  const reply = await request(client, createRpcName(input), {
    p_practice_id: practiceId,
    p_request_id: input.requestId,
    ...(input.intent === "clinician"
      ? { p_name: input.name }
      : {
          p_title: input.title,
          ...(withNumber ? { p_record_number: input.recordNumber } : {}),
          p_issuer: input.issuer,
          p_jurisdiction: input.jurisdiction,
          p_end_date: input.endDate,
          p_action_deadline: input.actionDeadline,
          p_type: input.type,
          p_owner_kind: input.ownerKind,
          p_owner_clinician_id: input.ownerClinicianId ?? null,
          p_covered_clinician_ids: input.coveredClinicianIds,
        }),
  });
  if (reply.status !== "reply") return reply;
  const failure = z
    .object({
      status: z.enum(["invalid", "invalid-reference", "request-conflict"]),
      errors: z
        .object({
          recordNumber: z.literal(recordNumberError).optional(),
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
      : z.object({
          status: z.literal("success"),
          credential: withNumber
            ? credentialSchema.safeExtend({ record_number: recordNumberSchema })
            : credentialSchema,
        })
  ).safeParse(reply.data);
  return parsed.success ? parsed.data : { status: "unavailable" };
}

export async function getMaintenanceRegister(
  client: SupabaseClient,
  practiceId: string,
  includeArchived = false,
) {
  const reply = await request(
    client,
    "list_practice_register_with_maintenance",
    { p_practice_id: practiceId, p_include_archived: includeArchived },
  );
  if (reply.status !== "reply") return reply;
  const parsed = maintenanceRegisterSchema.safeParse(reply.data);
  return parsed.success
    ? ({ status: "success", register: parsed.data } as const)
    : ({ status: "unavailable" } as const);
}
export async function changeRecord(
  client: SupabaseClient,
  practiceId: string,
  input: MaintenanceInput,
): Promise<MaintenanceResult> {
  const withNumber =
    input.intent === "update" && input.recordNumber !== undefined;
  const responseCredential = withNumber
    ? maintenanceCredentialSchema.safeExtend({
        record_number: recordNumberSchema,
      })
    : maintenanceCredentialSchema;
  const reply = await request(
    client,
    input.intent === "update"
      ? withNumber
        ? "update_practice_credential_with_number"
        : "update_practice_credential"
      : "archive_practice_credential",
    {
      p_practice_id: practiceId,
      p_request_id: input.requestId,
      p_credential_id: input.id,
      p_expected_version: input.expectedVersion,
      p_expected_cycle_id: input.expectedCycleId,
      p_expected_date_revision: input.expectedDateRevision,
      ...(input.intent === "update"
        ? {
            p_title: input.title,
            ...(withNumber ? { p_record_number: input.recordNumber } : {}),
            p_type: input.type,
            p_owner_kind: input.ownerKind,
            p_owner_clinician_id: input.ownerClinicianId ?? null,
            p_covered_clinician_ids: input.coveredClinicianIds,
            p_issuer: input.issuer,
            p_jurisdiction: input.jurisdiction,
            p_end_date: input.endDate,
            p_action_deadline: input.actionDeadline,
          }
        : {}),
    },
  );
  if (reply.status !== "reply") return reply;
  const errors = z.object({
    recordNumber: z.literal(recordNumberError).optional(),
    issuer: z.literal("Use 1 to 120 characters.").optional(),
    jurisdiction: z.literal("Use 1 to 120 characters.").optional(),
    endDate: z.literal("Enter a valid date (YYYY-MM-DD).").optional(),
    actionDeadline: z
      .enum([
        "Enter a valid date (YYYY-MM-DD).",
        "The action deadline must be earlier than the end date.",
      ])
      .optional(),
  });
  const parsed = z
    .discriminatedUnion("status", [
      z.object({
        status: z.literal("success"),
        changed: z.boolean(),
        credential: responseCredential,
      }),
      z.object({
        status: z.literal("conflict"),
        credential: responseCredential,
      }),
      z.object({ status: z.literal("invalid"), errors: errors.optional() }),
      z.object({
        status: z.enum([
          "invalid-reference",
          "request-conflict",
          "archived",
          "completed",
          "not-found",
        ]),
      }),
    ])
    .safeParse(reply.data);
  return parsed.success ? parsed.data : { status: "unavailable" };
}
