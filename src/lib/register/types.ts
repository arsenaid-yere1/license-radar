import { z } from "zod";

export const credentialTypeSchema = z.enum([
  "state_license",
  "dea_registration",
  "malpractice_policy",
  "pci_compliance_certificate",
]);
export type CredentialType = z.infer<typeof credentialTypeSchema>;
export const typeLabels = {
  state_license: "State license",
  dea_registration: "DEA registration",
  malpractice_policy: "Malpractice policy",
  pci_compliance_certificate: "PCI compliance certificate",
} as const satisfies Record<CredentialType, string>;
