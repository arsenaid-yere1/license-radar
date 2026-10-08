import { z } from "zod";
import { versionSchema } from "@/lib/team/schema";
import { recipientSchema } from "@/lib/recipients/schema";
export const phoneSchema = z
  .string()
  .transform((value) => value.replace(/^[\t\n\r\f\v ]+|[\t\n\r\f\v ]+$/g, ""))
  .pipe(z.string().regex(/^\+[1-9][0-9]{1,14}$/));
export const codeSchema = z.string().regex(/^[0-9]{6}$/);
const request = { requestId: z.uuid() };
export const smsInputSchema = z.union([
  z.strictObject({
    ...request,
    intent: z.literal("send"),
    phone: phoneSchema,
    expectedVersion: versionSchema,
    otpPermission: z.literal(true),
    changeConfirmed: z.boolean(),
  }),
  z.strictObject({
    ...request,
    intent: z.literal("check"),
    code: codeSchema,
    challengeId: z.uuid(),
    expectedVersion: versionSchema,
  }),
  z.strictObject({
    ...request,
    intent: z.literal("consent"),
    consent: z.literal(true),
    expectedVersion: versionSchema,
  }),
  z.strictObject({ ...request, intent: z.literal("withdraw") }),
]);
export const reasonSchema = z.enum([
  "no-recipient",
  "member-unavailable",
  "not-started",
  "verification-pending",
  "verification-uncertain",
  "consent-required",
  "withdrawn",
  "provider-opted-out",
  "enrolled",
]);
export const enrollmentSchema = z
  .object({
    version: versionSchema,
    phoneRevision: z.number().int().min(0).max(2147483647),
    phoneSuffix: z
      .string()
      .regex(/^[0-9]{4}$/)
      .nullable(),
    verified: z.boolean(),
    consented: z.boolean(),
    canEdit: z.boolean(),
    reason: reasonSchema,
    challengeId: z.uuid().nullable(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    retryAfter: z.iso.datetime({ offset: true }).nullable(),
    deliveryActive: z.literal(false),
  })
  .refine(
    (value) =>
      value.consented === (value.reason === "enrolled") &&
      (!value.consented || value.verified) &&
      (!value.verified ||
        (value.phoneRevision > 0 && value.phoneSuffix !== null)),
  );
export const readinessSchema = z
  .object({
    reason: reasonSchema,
    enrollmentReady: z.boolean(),
    deliveryActive: z.literal(false),
  })
  .refine((value) => value.enrollmentReady === (value.reason === "enrolled"));
export const detailedRecipientSchema = z.object({
  recipient: recipientSchema,
  enrollment: readinessSchema,
});
export const databaseStatusSchema = z.enum([
  "success",
  "conflict",
  "blocked",
  "confirmation-required",
  "busy",
  "uncertain",
  "verification-required",
  "rate-limited",
  "wrong-code",
]);
export const databaseResultSchema = z.object({
  status: databaseStatusSchema,
  enrollment: enrollmentSchema,
});
export type SmsInput = z.infer<typeof smsInputSchema>;
export type Enrollment = z.infer<typeof enrollmentSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
export type SmsResult =
  | z.infer<typeof databaseResultSchema>
  | {
      status:
        "auth-required" | "forbidden" | "unavailable" | "setup-unavailable";
    }
  | { status: "invalid"; errors: Record<string, string> };
export type SmsState = {
  status: "idle" | SmsResult["status"];
  enrollment?: Enrollment;
  message?: string;
  errors?: Record<string, string>;
};
export type SmsAction = (state: SmsState, form: FormData) => Promise<SmsState>;
