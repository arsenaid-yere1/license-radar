import { z } from "zod";
import { renewalCycleSchema } from "@/lib/renewals/history";
export const evidenceId = z.uuid().transform((v) => v.toLowerCase());
export const evidenceState = z.enum([
  "pending",
  "available",
  "deleting",
  "deleted",
  "abandoned",
]);
export const mimeSchema = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
export const fileSchema = z
  .object({
    id: evidenceId,
    filename: z.string().min(1).max(120).nullable(),
    mime: mimeSchema,
    byteCount: z.number().int().min(1).max(3145728),
    state: evidenceState,
    version: z.number().int().min(1).max(2147483647),
    createdAt: z.iso.datetime({ offset: true }),
    requestId: evidenceId.nullable(),
  })
  .refine(
    (v) =>
      v.filename !== null || v.state === "deleted" || v.state === "abandoned",
  );
export const pageSchema = z
  .object({
    status: z.literal("success"),
    credentialId: evidenceId,
    cycleId: evidenceId,
    title: z.string().min(1).max(240),
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
    current: z.boolean(),
    cycle: renewalCycleSchema,
    files: z.array(fileSchema).max(20),
    notices: z.array(fileSchema).max(20),
  })
  .refine(
    (v) =>
      v.cycleId === v.cycle.id &&
      v.files.every((f) => f.state === "pending" || f.state === "available") &&
      v.notices.every((f) =>
        ["deleting", "deleted", "abandoned"].includes(f.state),
      ) &&
      new Set([...v.files, ...v.notices].map((f) => f.id)).size ===
        v.files.length + v.notices.length,
  );
export type EvidencePage = z.infer<typeof pageSchema>;
export type EvidenceFile = z.infer<typeof fileSchema>;
export const terminalSchema = z.object({
  status: z.enum([
    "invalid",
    "not-found",
    "archived",
    "quota",
    "request-conflict",
    "conflict",
    "busy",
    "available",
    "pending",
    "deleting",
    "deleted",
    "abandoned",
    "forbidden",
    "unavailable",
  ]),
});
export const resultSchema = z.union([
  z.object({ status: z.literal("success"), evidenceId, state: evidenceState }),
  terminalSchema,
]);
export type EvidenceResult = z.infer<typeof resultSchema>;
const uuidPart = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const objectPath = z
  .string()
  .regex(new RegExp(`^(?:${uuidPart}/){4}${uuidPart}\\.(?:pdf|jpg|png)$`));
const objectMetadata = {
  path: objectPath,
  mime: mimeSchema,
  byteCount: z.number().int().min(1).max(3145728),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
};
export const uploadClaimSchema = z.object({
  status: z.literal("upload"),
  evidenceId,
  objectId: evidenceId,
  token: evidenceId,
  ...objectMetadata,
});
export const downloadSchema = z.object({
  status: z.literal("download"),
  accessId: evidenceId,
  filename: z.string().min(1).max(120),
  ...objectMetadata,
});
export const cleanupClaimSchema = z.object({
  objectId: evidenceId,
  token: evidenceId,
  path: objectPath,
});
export const removeInputSchema = z
  .object({
    requestId: evidenceId,
    expectedVersion: z.number().int().min(1).max(2147483647),
    confirmed: z.literal(true),
  })
  .strict();
