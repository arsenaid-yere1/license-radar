import { z } from "zod";
import { isCredentialDate } from "@/lib/register/dates";
import { renewalCycleSchema } from "./history";
import {
  clinicianSchema,
  listedCredentialSchema,
  maintenanceCredentialSchema,
} from "@/lib/register/schema";
import { versionSchema } from "@/lib/team/schema";
import {
  parseRenewalUrl,
  progressSchema,
  renewalStateSchema,
  urlMessage,
} from "./state";
const uuid = z.uuid().transform((value) => value.toLowerCase());
const expectedVersion = z.preprocess(
  (value) =>
    typeof value === "string" && /^[1-9][0-9]*$/.test(value)
      ? Number(value)
      : value,
  versionSchema,
);
const tokens = {
  requestId: uuid,
  id: uuid,
  expectedVersion,
  expectedCycleId: uuid,
  expectedDateRevision: expectedVersion,
  expectedRenewalVersion: expectedVersion,
};
const inputUrl = z
  .string()
  .nullable()
  .transform((value, ctx) => {
    const parsed = parseRenewalUrl(value);
    if (!parsed.valid) {
      ctx.addIssue({ code: "custom", message: urlMessage });
      return z.NEVER;
    }
    return parsed.value;
  });
const newDate = z
  .string()
  .refine(isCredentialDate, "Enter a valid date (YYYY-MM-DD).");
const completionInput = z
  .strictObject({
    ...tokens,
    intent: z.literal("complete"),
    endDate: newDate,
    actionDeadline: z
      .union([z.literal(""), newDate])
      .nullish()
      .transform((v) => v || null),
    confirmed: z
      .union([z.literal(true), z.literal("true")])
      .transform(() => true as const),
  })
  .refine((v) => !v.actionDeadline || v.actionDeadline < v.endDate, {
    path: ["actionDeadline"],
    message: "The action deadline must be earlier than the end date.",
  });
export const renewalInputSchema = z.lazy(() =>
  z.discriminatedUnion("intent", [
    z.strictObject({ ...tokens, intent: z.literal("link"), url: inputUrl }),
    z.strictObject({
      ...tokens,
      intent: z.literal("progress"),
      progress: progressSchema,
    }),
    z.strictObject({ ...tokens, intent: z.literal("review") }),
    completionInput,
  ]),
);
export const renewalCredentialSchema = maintenanceCredentialSchema.safeExtend({
  renewal: renewalStateSchema,
});
export const renewalRegisterSchema = z.object({
  clinicians: z.array(clinicianSchema),
  credentials: z.array(
    listedCredentialSchema.safeExtend({ renewal: renewalStateSchema }),
  ),
});
const invalidResultSchema = z.object({
  status: z.literal("invalid"),
  errors: z
    .strictObject({
      url: z.literal(urlMessage).optional(),
      progress: z.literal("Choose a renewal progress status.").optional(),
    })
    .optional(),
});
const terminalResultSchema = z.object({
  status: z.enum(["request-conflict", "archived", "completed", "not-found"]),
});
export const renewalResultSchema = z.lazy(() =>
  z.discriminatedUnion("status", [
    z.object({
      status: z.literal("success"),
      changed: z.boolean(),
      credential: renewalCredentialSchema,
    }),
    z.object({
      status: z.literal("conflict"),
      credential: renewalCredentialSchema,
    }),
    invalidResultSchema,
    terminalResultSchema,
  ]),
);
export const completionResultSchema = z.lazy(() =>
  z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("success"),
        changed: z.literal(true),
        credential: renewalCredentialSchema,
        completedCycle: renewalCycleSchema,
      })
      .refine(
        (v) =>
          v.completedCycle.successorId === v.credential.current_cycle.id &&
          v.completedCycle.cycleNumber + 1 ===
            v.credential.current_cycle.cycle_number,
      ),
    z.object({
      status: z.literal("conflict"),
      credential: renewalCredentialSchema,
    }),
    z.object({
      status: z.literal("invalid"),
      errors: z
        .strictObject({
          endDate: z
            .enum([
              "Enter a valid date (YYYY-MM-DD).",
              "Enter an end date after today in the practice timezone.",
            ])
            .optional(),
          actionDeadline: z
            .enum([
              "Enter a valid date (YYYY-MM-DD).",
              "Enter an action deadline after today in the practice timezone.",
              "The action deadline must be earlier than the end date.",
            ])
            .optional(),
        })
        .optional(),
    }),
    terminalResultSchema,
  ]),
);
export type RenewalInput = z.infer<typeof renewalInputSchema>;
export type RenewalCredential = z.infer<typeof renewalCredentialSchema>;
export type RenewalRegister = z.infer<typeof renewalRegisterSchema>;
export type RenewalResult =
  | Exclude<z.infer<typeof renewalResultSchema>, { status: "invalid" }>
  | Exclude<z.infer<typeof completionResultSchema>, { status: "invalid" }>
  | { status: "invalid"; errors?: Record<string, string> }
  | { status: "auth-required" | "forbidden" | "unavailable" };
export type RenewalFormState = {
  status: "idle" | RenewalResult["status"];
  message?: string;
  errors?: Record<string, string>;
  credential?: RenewalCredential;
  changed?: boolean;
};
export type RenewalAction = (
  state: RenewalFormState,
  form: FormData,
) => Promise<RenewalFormState>;
