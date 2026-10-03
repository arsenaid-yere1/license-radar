import { z } from "zod";
import { getSupportedTimezones } from "./timezones";
const name = z
  .string({ error: "Enter a practice name." })
  .transform((value) => value.trim())
  .refine((value) => Array.from(value).length > 0, "Enter a practice name.")
  .refine(
    (value) => Array.from(value).length <= 120,
    "Use 120 characters or fewer.",
  );
const timezone = z
  .string({ error: "Choose a valid timezone." })
  .refine((value) => getSupportedTimezones().includes(value));
export const practiceInputSchema = z.strictObject({ name, timezone });
const editSchema = practiceInputSchema.extend({
  expectedVersion: z
    .number({ error: "Reload the settings and try again." })
    .int()
    .min(1),
});
export type PracticeInput = z.infer<typeof editSchema>;
export type ValidatedPractice =
  | {
      success: true;
      data: z.infer<typeof practiceInputSchema> & { expectedVersion?: number };
    }
  | { success: false; errors: Record<string, string> };
export function validatePractice(
  input: unknown,
  editing = false,
): ValidatedPractice {
  const result = (editing ? editSchema : practiceInputSchema).safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return { success: false, errors };
}
