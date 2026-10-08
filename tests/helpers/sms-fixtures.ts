import twilio from "twilio";
export async function fixtureMode(phone: string, mode: string) {
  const response = await fetch("http://127.0.0.1:55325/test/mode", {
    method: "POST",
    headers: {
      Authorization: "Bearer local-fixture-only-e4-s1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone, mode }),
  });
  if (!response.ok) throw new Error("SMS fixture unavailable");
}
export async function fixtureCode(phone: string) {
  const r = await fetch("http://127.0.0.1:55325/test/state", {
    method: "POST",
    headers: {
      Authorization: "Bearer local-fixture-only-e4-s1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone }),
  });
  if (!r.ok) throw new Error("SMS fixture unavailable");
  const rows = await r.json();
  return rows.at(-1).code as string;
}
export function signedOptOut(
  phone: string,
  type = "STOP",
  message = `SM${crypto.randomUUID().replaceAll("-", "")}`,
) {
  const fields = {
    AccountSid: `AC${"1".repeat(32)}`,
    MessagingServiceSid: `MG${"2".repeat(32)}`,
    MessageSid: message,
    From: phone,
    To: "+12025550000",
    OptOutType: type,
    Body: type,
  };
  return {
    body: new URLSearchParams(fields).toString(),
    signature: twilio.getExpectedTwilioSignature(
      "local-callback-fixture-only",
      "http://127.0.0.1:3000/api/sms/twilio/inbound",
      fields,
    ),
  };
}
