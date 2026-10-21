import { z } from "zod";
import { versionSchema } from "@/lib/team/schema";
export const progressSchema = z.enum([
  "not-started",
  "in-progress",
  "awaiting-approval",
]);
export const progressLabels = {
  "not-started": "Not started",
  "in-progress": "In progress",
  "awaiting-approval": "Awaiting approval",
} as const;
export const urlMessage =
  "Enter a valid HTTPS renewal link (up to 2,048 characters).";
function validHostname(hostname: string) {
  return (
    hostname.length <= 253 &&
    hostname.includes(".") &&
    !/\.(?:[0-9]+|0x[0-9a-f]+)$/i.test(hostname) &&
    hostname
      .split(".")
      .every(
        (label) =>
          label.length <= 63 &&
          /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label),
      )
  );
}
export function parseRenewalUrl(
  value: string | null,
): { valid: true; value: string | null } | { valid: false } {
  const text = value?.trim();
  if (!text) return { valid: true, value: null };
  if (text.length > 2048) return { valid: false };
  const parts = /^https:\/\/([^/?#]+)(.*)$/i.exec(text);
  if (!parts) return { valid: false };
  const [, hostname, suffix] = parts;
  if (
    !validHostname(hostname) ||
    !/^(?:[a-zA-Z0-9._~!$&()*+,;=:@/?#-]|%[0-9a-fA-F]{2})*$/.test(suffix) ||
    suffix.split("#").length > 2
  )
    return { valid: false };
  return { valid: true, value: `https://${text.slice(8)}` };
}
const storedUrl = z
  .string()
  .nullable()
  .refine((value) => {
    const parsed = parseRenewalUrl(value);
    return parsed.valid && parsed.value === value;
  });
export const renewalStateSchema = z.object({
  link: z.object({ url: storedUrl, version: versionSchema }),
  workflow: z.object({
    cycleId: z.uuid().transform((value) => value.toLowerCase()),
    status: progressSchema,
    version: versionSchema,
    acknowledgedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
});
export type RenewalState = z.infer<typeof renewalStateSchema>;
