import { z } from "zod";

export const credentialTypeSchema = z.enum([
  "state_license",
  "dea_registration",
  "malpractice_policy",
  "pci_compliance_certificate",
  "insurance_payer_provider_directory",
]);
export type CredentialType = z.infer<typeof credentialTypeSchema>;
export const typeLabels = {
  state_license: "State license",
  dea_registration: "DEA registration",
  malpractice_policy: "Malpractice policy",
  pci_compliance_certificate: "PCI compliance certificate",
  insurance_payer_provider_directory: "Insurance payer provider directory",
} as const satisfies Record<CredentialType, string>;
