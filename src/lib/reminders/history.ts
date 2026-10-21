import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const recoverySummarySchema = z.strictObject({
  disposition: z.enum([
    "legacy",
    "submitting",
    "retry-pending",
    "accepted",
    "permanent",
    "uncertain",
    "review-needed",
    "canceled",
    "exhausted",
    "expired",
  ]),
  version: z.number().int().positive().max(2147483647),
  postCount: z.number().int().min(0).max(3),
  retryDue: z.string().nullable(),
  retryExpires: z.string().nullable(),
  checkCount: z.number().int().min(0).max(6),
  checkDue: z.string().nullable(),
  canCheck: z.boolean(),
});
const historyRowSchema = z.strictObject({
  id: z.uuid(),
  attemptId: z.uuid().nullable(),
  recipient: z.enum(["selected", "former"]),
  dueDate: z.string(),
  timezone: z.string(),
  scheduleKind: z.enum(["normal", "catch-up"]),
  nominalTarget: z.string(),
  dispatchTarget: z.string(),
  state: z.enum([
    "pending",
    "blocked",
    "queued",
    "claimed",
    "submitting",
    "accepted",
    "failed",
    "suppressed",
    "canceled",
    "uncertain",
  ]),
  delivery: z.string().nullable(),
  reason: z.string().nullable(),
  startedAt: z.string().nullable(),
  recovery: recoverySummarySchema.nullable(),
});
const notFoundSchema = z.strictObject({ status: z.literal("not-found") });
export const reminderHistorySchema = z.union([
  z.strictObject({
    status: z.literal("success"),
    credential: z.strictObject({
      id: z.uuid(),
      title: z.string(),
      archived: z.boolean(),
      currentDueDate: z.string().nullable(),
      currentTimezone: z.string(),
    }),
    rows: z.array(historyRowSchema).max(50),
    nextCursor: z.uuid().nullable(),
  }),
  notFoundSchema,
]);
const sourceSchema = z.enum(["job", "submission", "delivery", "check"]);
export const timelineCursorSchema = z.strictObject({
  observedAt: z.string(),
  source: sourceSchema,
  id: z.uuid(),
});
export const reminderTimelineSchema = z.union([
  z.strictObject({
    status: z.literal("success"),
    rows: z
      .array(
        timelineCursorSchema.extend({
          operation: z.string(),
          anomaly: z.boolean(),
        }),
      )
      .max(50),
    nextCursor: timelineCursorSchema.nullable(),
  }),
  notFoundSchema,
]);
export const providerCapabilitySchema = z.union([
  z.strictObject({
    kind: z.literal("gmail"),
    maxPosts: z.literal(1),
    deliveryChecks: z.literal(false),
    automaticResend: z.literal(false),
  }),
  z.strictObject({
    kind: z.literal("resend"),
    maxPosts: z.literal(3),
    deliveryChecks: z.literal(true),
    automaticResend: z.literal(true),
  }),
]);
export const reminderHistoryV2Schema = z.union([
  reminderHistorySchema.options[0].extend({
    rows: z
      .array(
        historyRowSchema.extend({
          provider: providerCapabilitySchema.nullable(),
        }),
      )
      .max(50),
  }),
  notFoundSchema,
]);
export const reminderTimelineV2Schema = z.union([
  reminderTimelineSchema.options[0].extend({
    provider: providerCapabilitySchema,
  }),
  notFoundSchema,
]);
export type ReminderHistoryV2 = z.infer<typeof reminderHistoryV2Schema>;
export const checkInputSchema = z.strictObject({
  attemptId: z.uuid(),
  requestId: z.uuid(),
  expectedVersion: z.number().int().positive().max(2147483647),
});
export const checkOutcomeSchema = z.strictObject({
  status: z.enum([
    "queued",
    "not-found",
    "invalid",
    "conflict",
    "unknown-id",
    "exhausted",
    "complete",
    "cooldown",
    "request-conflict",
  ]),
});
const formSchema = z
  .strictObject({
    requestId: z.uuid(),
    attemptId: z.uuid(),
    expectedVersion: z
      .string()
      .regex(/^[1-9][0-9]*(?![^])/)
      .transform(Number),
  })
  .pipe(checkInputSchema);

export type ReminderHistory = z.infer<typeof reminderHistorySchema>;
export type ReminderTimeline = z.infer<typeof reminderTimelineSchema>;
export type ReminderTimelineCursor = z.infer<typeof timelineCursorSchema>;
export type ReminderCheckInput = z.infer<typeof checkInputSchema>;
export type RecoverySummary = z.infer<typeof recoverySummarySchema>;
type ReadFailure = { status: "forbidden" | "unavailable" };
export type ReminderHistoryState = ReminderHistory | ReadFailure;
export type ReminderTimelineState = ReminderTimeline | ReadFailure;
export type ReminderCheckState =
  z.infer<typeof checkOutcomeSchema> | ReadFailure;

function parsedResult<T>(
  result: { data: unknown; error: { code: string } | null },
  schema: z.ZodType<T>,
): T | ReadFailure {
  if (result.error)
    return {
      status: result.error.code === "42501" ? "forbidden" : "unavailable",
    };
  const parsed = schema.safeParse(result.data);
  return parsed.success ? parsed.data : { status: "unavailable" };
}

export async function getReminderHistory(
  client: SupabaseClient,
  practiceId: string,
  credentialId: string,
  after: string | null = null,
): Promise<ReminderHistoryState> {
  try {
    return parsedResult(
      await client.rpc("get_email_reminder_history", {
        p_practice_id: practiceId,
        p_credential_id: credentialId,
        p_after: after,
      }),
      reminderHistorySchema,
    );
  } catch {
    return { status: "unavailable" };
  }
}
export async function getReminderTimeline(
  client: SupabaseClient,
  practiceId: string,
  attemptId: string,
  after: ReminderTimelineCursor | null = null,
  credentialId?: string,
): Promise<ReminderTimelineState> {
  try {
    return parsedResult(
      await client.rpc("get_email_reminder_timeline", {
        p_practice_id: practiceId,
        p_attempt_id: attemptId,
        p_after: after,
        ...(credentialId ? { p_credential_id: credentialId } : {}),
      }),
      reminderTimelineSchema,
    );
  } catch {
    return { status: "unavailable" };
  }
}
export async function requestReminderCheck(
  client: SupabaseClient,
  practiceId: string,
  input: ReminderCheckInput,
): Promise<ReminderCheckState> {
  const parsed = checkInputSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  try {
    return parsedResult(
      await client.rpc("request_email_reminder_check", {
        p_practice_id: practiceId,
        p_attempt_id: parsed.data.attemptId,
        p_request_id: parsed.data.requestId,
        p_expected_version: parsed.data.expectedVersion,
      }),
      checkOutcomeSchema,
    );
  } catch {
    return { status: "unavailable" };
  }
}
export function checkFormInput(form: FormData): ReminderCheckInput | null {
  const raw: Record<string, unknown> = {};
  for (const key of ["requestId", "attemptId", "expectedVersion"]) {
    const values = form.getAll(key);
    if (values.length !== 1) return null;
    raw[key] = values[0];
  }
  const parsed = formSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function getReminderHistoryV2(
  client: SupabaseClient,
  practiceId: string,
  credentialId: string,
  after: string | null = null,
): Promise<ReminderHistoryV2 | ReadFailure> {
  try {
    return parsedResult(
      await client.rpc("get_email_reminder_history_v2", {
        p_practice_id: practiceId,
        p_credential_id: credentialId,
        p_after: after,
      }),
      reminderHistoryV2Schema,
    );
  } catch {
    return { status: "unavailable" };
  }
}
export async function getReminderTimelineV2(
  client: SupabaseClient,
  practiceId: string,
  attemptId: string,
  after: ReminderTimelineCursor | null = null,
  credentialId?: string,
): Promise<z.infer<typeof reminderTimelineV2Schema> | ReadFailure> {
  try {
    return parsedResult(
      await client.rpc("get_email_reminder_timeline_v2", {
        p_practice_id: practiceId,
        p_attempt_id: attemptId,
        p_after: after,
        ...(credentialId ? { p_credential_id: credentialId } : {}),
      }),
      reminderTimelineV2Schema,
    );
  } catch {
    return { status: "unavailable" };
  }
}
