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
      purpose: type === "malpractice_policy" ? "coverage end" : "expiration",
    };
  return null;
}
export const detailLabels = {
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
} as const;
