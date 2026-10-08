export const disclosureVersion = "e4-s1-v1";
export const otpDisclosure =
  "License Renewal Radar: I request a phone verification text. Message and data rates may apply. SMS terms and privacy: /sms-information.";
export function reminderDisclosure(practiceName: string) {
  return `License Renewal Radar: I agree to renewal reminder texts for ${practiceName}. Frequency varies with renewal dates. Message and data rates may apply. Reply STOP or withdraw in settings to stop; HELP for help. SMS terms and privacy: /sms-information. Renewal texts are not active yet.`;
}
