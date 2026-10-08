import { expect, test } from "vitest";
import {
  disclosureVersion,
  otpDisclosure,
  reminderDisclosure,
} from "@/lib/sms/disclosures";
test("OTP and reminder disclosures record their exact separately displayed contract", () => {
  expect(disclosureVersion).toBe("e4-s1-v1");
  expect(otpDisclosure).toBe(
    "License Renewal Radar: I request a phone verification text. Message and data rates may apply. SMS terms and privacy: /sms-information.",
  );
  expect(reminderDisclosure("Cedar Clinic")).toBe(
    "License Renewal Radar: I agree to renewal reminder texts for Cedar Clinic. Frequency varies with renewal dates. Message and data rates may apply. Reply STOP or withdraw in settings to stop; HELP for help. SMS terms and privacy: /sms-information. Renewal texts are not active yet.",
  );
});
