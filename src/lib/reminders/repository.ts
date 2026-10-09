import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  preferenceSchema,
  scheduleSchema,
  type PreferenceState,
} from "./schema";
export async function getReminderSchedule(
  client: SupabaseClient,
  practiceId: string,
  namespace: string,
  after: string | null = null,
) {
  try {
    const { data, error } = await client.rpc("get_email_reminder_schedule", {
      p_practice_id: practiceId,
      p_namespace: namespace,
      p_after: after,
    });
    const parsed = scheduleSchema.safeParse(data);
    return !error && parsed.success
      ? { status: "success" as const, schedule: parsed.data }
      : { status: "unavailable" as const };
  } catch {
    return { status: "unavailable" as const };
  }
}
export async function setEmailPreference(
  client: SupabaseClient,
  practiceId: string,
  input: { requestId: string; enabled: boolean; expectedVersion: number },
): Promise<PreferenceState> {
  try {
    const { data, error } = await client.rpc(
      "set_my_email_reminder_preference",
      {
        p_practice_id: practiceId,
        p_request_id: input.requestId,
        p_enabled: input.enabled,
        p_expected_version: input.expectedVersion,
      },
    );
    if (error)
      return { status: error.code === "42501" ? "forbidden" : "unavailable" };
    const parsed = z
      .union([
        z
          .object({
            status: z.literal("success"),
            preference: preferenceSchema,
          })
          .strict(),
        z
          .object({
            status: z.enum(["invalid", "conflict", "request-conflict"]),
          })
          .strict(),
      ])
      .safeParse(data);
    return parsed.success ? parsed.data : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
