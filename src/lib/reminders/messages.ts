import { z } from "zod";
import { preferenceInputSchema } from "./schema";
const formSchema = z
  .object({
    requestId: z.uuid(),
    enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
    expectedVersion: z
      .string()
      .regex(/^[1-9][0-9]*(?![^])/)
      .transform(Number),
  })
  .pipe(preferenceInputSchema);
export function preferenceFormInput(form: FormData) {
  const raw: Record<string, unknown> = {};
  for (const key of ["requestId", "enabled", "expectedVersion"]) {
    const values = form.getAll(key);
    if (values.length !== 1) return null;
    raw[key] = values[0];
  }
  const parsed = formSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
export const emailPayloadSchema = z.strictObject({
  from: z.email().max(254),
  to: z.tuple([z.email().max(254)]),
  reply_to: z.email().max(254),
  subject: z.literal("Credential renewal reminder: 60 days"),
  text: z.string().min(1).max(2000),
  html: z.string().min(1).max(3000),
  tags: z.tuple([
    z.strictObject({ name: z.literal("reminder_attempt"), value: z.uuid() }),
  ]),
});
export const submissionSchema = z
  .strictObject({
    status: z.literal("submit"),
    attemptId: z.uuid(),
    token: z.uuid(),
    payload: emailPayloadSchema,
    key: z.string(),
  })
  .refine(
    (value) =>
      value.key === `reminder-email/${value.attemptId}` &&
      value.payload.tags[0].value === value.attemptId,
  );
export type EmailSubmission = z.infer<typeof submissionSchema>;
export type EmailOutcome = {
  outcome: "accepted" | "failed" | "uncertain";
  providerId: string | null;
  error:
    | "provider-rejected"
    | "provider-unavailable"
    | "invalid-response"
    | "interrupted"
    | null;
};
