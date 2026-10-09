import { z } from "zod";
export const preferenceSchema = z
  .object({
    enabled: z.boolean(),
    version: z.number().int().positive().max(2147483647),
    canEnable: z.boolean(),
  })
  .strict();
export const preferenceInputSchema = z
  .object({
    requestId: z.uuid(),
    enabled: z.boolean(),
    expectedVersion: z.number().int().positive().max(2147483647),
  })
  .strict();
export const scheduleSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            id: z.uuid(),
            title: z.string(),
            cycleId: z.uuid(),
            dueDate: z.string().nullable(),
            datePurpose: z.enum(["action-deadline", "end-date"]),
            timezone: z.string(),
            target: z.string().nullable(),
            nextSendAt: z.string().nullable(),
            scheduleKind: z.enum(["normal", "catch-up"]).nullable(),
            dispatchTarget: z.string().nullable(),
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
          })
          .strict(),
      )
      .max(100),
    nextCursor: z.uuid().nullable(),
    emailReadiness: z.enum([
      "no-recipient",
      "member-unavailable",
      "email-unconfirmed",
      "email-disabled",
      "email-suppressed",
      "ready",
    ]),
    smsOptional: z.literal(true),
    lastSuccessAt: z.string().nullable(),
    oldestDueAt: z.string().nullable(),
    preference: preferenceSchema,
  })
  .strict();
export type Schedule = z.infer<typeof scheduleSchema>;
export type Preference = z.infer<typeof preferenceSchema>;
export type PreferenceState = {
  status:
    | "idle"
    | "success"
    | "auth-required"
    | "forbidden"
    | "unavailable"
    | "invalid"
    | "conflict"
    | "request-conflict";
  preference?: Preference;
  message?: string;
};
