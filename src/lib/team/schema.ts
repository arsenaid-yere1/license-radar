import { z } from "zod";
export const roleSchema = z.enum(["administrator", "manager", "viewer"]);
export const versionSchema = z.number().int().min(1).max(2147483647);
export function normalizeEmail(value: string) {
  return value
    .replace(/^ +| +$/g, "")
    .replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}
export const invitationInputSchema = z.strictObject({
  email: z.string().transform(normalizeEmail).pipe(z.email().max(254)),
  role: roleSchema,
});
export const recordInputSchema = z.strictObject({
  id: z.uuid(),
  expectedVersion: versionSchema,
});
export const memberInputSchema = recordInputSchema.extend({ role: roleSchema });
export function inputErrors(error: z.ZodError) {
  const errors: Record<string, string> = {};
  for (const issue of error.issues)
    errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}
export function validateInvitation(input: unknown) {
  const result = invitationInputSchema.safeParse(input);
  return result.success
    ? { success: true as const, data: result.data }
    : { success: false as const, errors: inputErrors(result.error) };
}
export const roleLabels = {
  administrator: "Practice administrator",
  manager: "Office manager",
  viewer: "Viewer",
} as const;
