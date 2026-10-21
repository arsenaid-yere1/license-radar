import type { CredentialType } from "./types";
/** A calendar day, kept as text so a timezone cannot change it. */
export function isCredentialDate(value: string): boolean {
  // The final lookahead requires absolute end, including after line terminators.
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}(?![^])/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && day >= 1 && day <= days[month - 1];
}
export function formatCredentialDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[month - 1]} ${day}, ${year}`;
}
export function trackingDate(
  end: string | null,
  action: string | null,
  type: string,
): { date: string; purpose: string } | null {
  if (action) return { date: action, purpose: "earlier action deadline" };
  if (end)
    return {
      date: end,
      purpose: endDatePurpose(type),
    };
  return null;
}
export function endDatePurpose(type: string): string {
  if (type === "malpractice_policy") return "coverage end";
  if (type === "insurance_payer_provider_directory")
    return "directory update due";
  return "expiration";
}
export function cycleEndLabel(type: string): string {
  if (type === "malpractice_policy") return "Coverage end";
  if (type === "insurance_payer_provider_directory")
    return "Next directory update due";
  return "Expiration";
}
/** Keep canonical validation contracts intact; adapt only directory presentation. */
export function directoryDateError(
  type: string,
  message: string | undefined,
): string | undefined {
  if (type !== "insurance_payer_provider_directory") return message;
  switch (message) {
    case "Enter an end date after today in the practice timezone.":
      return "Enter a next directory update due date after today in the practice timezone.";
    case "The action deadline must be earlier than the end date.":
      return "The action deadline must be earlier than the next directory update due date.";
    default:
      return message;
  }
}
export const detailLabels = {
  insurance_payer_provider_directory: {
    issuer: "Payer name",
    jurisdiction: "Jurisdiction",
    end: "Next directory update due date",
  },
  pci_compliance_certificate: {
    issuer: "Certificate issuer",
    jurisdiction: "Jurisdiction",
    end: "Expiration date",
  },
  state_license: {
    issuer: "Licensing board",
    jurisdiction: "State or territory",
    end: "Expiration date",
  },
  dea_registration: {
    issuer: "Issuing authority",
    jurisdiction: "Registration jurisdiction",
    end: "Expiration date",
  },
  malpractice_policy: {
    issuer: "Insurer",
    jurisdiction: "Coverage jurisdiction",
    end: "Coverage end date",
  },
} as const satisfies Record<
  CredentialType,
  { issuer: string; jurisdiction: string; end: string }
>;
