import { z } from "zod";
import { versionSchema } from "@/lib/team/schema";
import { isCredentialDate } from "@/lib/register/dates";
import { progressSchema } from "./state";
import { credentialTypeSchema } from "@/lib/register/types";
const uuid = z.uuid().transform((v) => v.toLowerCase());
const date = z.string().refine(isCredentialDate);
export const renewalCycleSchema = z
  .object({
    id: uuid,
    cycleNumber: versionSchema,
    dateRevision: versionSchema,
    type: credentialTypeSchema,
    endDate: date.nullable(),
    actionDeadline: date.nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    successorId: uuid.nullable(),
    progress: progressSchema,
    acknowledgedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine(
    (v) =>
      (!v.endDate || !v.actionDeadline || v.actionDeadline < v.endDate) &&
      (!v.successorId || (v.completedAt !== null && v.successorId !== v.id)),
  );
export const renewalHistorySchema = z
  .object({
    status: z.literal("success"),
    credentialId: uuid,
    title: z.string().min(1).max(240),
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
    currentCycleId: uuid,
    cycles: z.array(renewalCycleSchema).max(20),
    nextBeforeCycleNumber: versionSchema.nullable(),
  })
  .refine(
    (v) =>
      v.cycles.every(
        (c, i) => i === 0 || c.cycleNumber < v.cycles[i - 1].cycleNumber,
      ) &&
      (v.nextBeforeCycleNumber === null ||
        (v.cycles.length === 20 &&
          v.nextBeforeCycleNumber === v.cycles[19].cycleNumber)) &&
      new Set(v.cycles.map((c) => c.id)).size === v.cycles.length,
  );
export type RenewalHistory = z.infer<typeof renewalHistorySchema>;
export function historyCursor(
  value: unknown,
): { valid: true; value: number | null } | { valid: false } {
  if (value === undefined) return { valid: true, value: null };
  if (typeof value !== "string" || !/^[1-9][0-9]*(?![^])/.test(value))
    return { valid: false };
  const p = versionSchema.safeParse(Number(value));
  return p.success ? { valid: true, value: p.data } : { valid: false };
}
