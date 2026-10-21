import { z } from "zod";
import type { CredentialType } from "./types";

export const recordNumberError =
  "Use up to 120 characters without control characters.";
export const recordNumberLabels = {
  state_license: "License number",
  dea_registration: "DEA registration number",
  malpractice_policy: "Policy number",
  pci_compliance_certificate: "Certificate number",
} as const satisfies Record<CredentialType, string>;

export const recordNumberSchema = z
  .string()
  .refine(
    (value) =>
      value === value.trim() &&
      Array.from(value).length >= 1 &&
      Array.from(value).length <= 120 &&
      !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(value),
    recordNumberError,
  )
  .nullable();

export const recordNumberInputSchema = z
  .string()
  .trim()
  .nullable()
  .transform((value) => value || null)
  .pipe(recordNumberSchema);
