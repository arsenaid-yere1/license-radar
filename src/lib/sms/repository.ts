import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  databaseResultSchema,
  detailedRecipientSchema,
  enrollmentSchema,
  type SmsResult,
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
export async function getMyEnrollment(
  client: SupabaseClient,
  practiceId: string,
) {
  const r = await request(client, "get_my_practice_sms_enrollment", {
    p_practice_id: practiceId,
  });
  if (r.status !== "reply") return r;
  const parsed = enrollmentSchema.safeParse(r.data);
  return parsed.success
    ? ({ status: "success", enrollment: parsed.data } as const)
    : ({ status: "unavailable" } as const);
}
export async function getRecipientEnrollment(
  client: SupabaseClient,
  practiceId: string,
) {
  const r = await request(
    client,
    "get_practice_reminder_recipient_with_enrollment",
    { p_practice_id: practiceId },
  );
  if (r.status !== "reply") return r;
  const parsed = detailedRecipientSchema.safeParse(r.data);
  return parsed.success
    ? ({ status: "success", ...parsed.data } as const)
    : ({ status: "unavailable" } as const);
}
export function parseSmsResult(data: unknown): SmsResult {
  const result = databaseResultSchema.safeParse(data);
  return result.success ? result.data : { status: "unavailable" };
}
export async function prepareVerification(
  client: SupabaseClient,
  args: Record<string, unknown>,
): Promise<SmsResult> {
  const r = await request(client, "prepare_my_sms_verification", args);
  return r.status === "reply" ? parseSmsResult(r.data) : r;
}
export async function saveConsent(
  client: SupabaseClient,
  practiceId: string,
  requestId: string,
  expectedVersion: number,
): Promise<SmsResult> {
  const r = await request(client, "consent_my_practice_sms", {
    p_practice_id: practiceId,
    p_request_id: requestId,
    p_expected_version: expectedVersion,
    p_consent: true,
  });
  return r.status === "reply" ? parseSmsResult(r.data) : r;
}
export async function withdrawConsent(
  client: SupabaseClient,
  practiceId: string,
  requestId: string,
): Promise<SmsResult> {
  const r = await request(client, "withdraw_my_practice_sms", {
    p_practice_id: practiceId,
    p_request_id: requestId,
  });
  return r.status === "reply" ? parseSmsResult(r.data) : r;
}
export const claimSchema = z.object({
  status: z.literal("claimed"),
  claimToken: z.uuid(),
  phone: z.string(),
  accountSid: z.string(),
  messagingServiceSid: z.string(),
  verifyServiceSid: z.string(),
  verificationSid: z.string().nullable(),
  challengeId: z.uuid(),
});
export type Claim = z.infer<typeof claimSchema>;
