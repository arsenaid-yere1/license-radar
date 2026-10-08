import "server-only";
import { z } from "zod";
const sid = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}[0-9a-fA-F]{32}$`));
const shared = z.object({
  accountSid: sid("AC"),
  messagingServiceSid: sid("MG"),
  verifyServiceSid: sid("VA"),
  supportEmail: z.email(),
});
export type SmsConfig = z.infer<typeof shared> &
  (
    | {
        mode: "fixture";
        fixtureURL: "http://127.0.0.1:55325";
        fixtureToken: string;
      }
    | { mode: "live"; apiKeySid: string; apiKeySecret: string }
  );
export type CallbackConfig = {
  accountSid: string;
  messagingServiceSid: string;
  authToken: string;
  url: string;
  senders: string[];
};
export function fixtureAllowed(
  env: Readonly<Record<string, string | undefined>>,
) {
  const required = {
    SMS_PROVIDER_FIXTURE: "local-e4-s1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
    SMS_FIXTURE_URL: "http://127.0.0.1:55325",
    SMS_APP_URL: "http://127.0.0.1:3000",
    SMS_FIXTURE_TOKEN: "local-fixture-only-e4-s1",
  };
  const forbidden = [
    "VERCEL",
    "VERCEL_ENV",
    "CI_DEPLOYMENT",
    "TWILIO_API_KEY_SID",
    "TWILIO_API_KEY_SECRET",
    "TWILIO_AUTH_TOKEN",
  ];
  return (
    Object.entries(required).every(([key, value]) => env[key] === value) &&
    forbidden.every((key) => !env[key]) &&
    env.SMS_LIVE_ENABLED !== "true"
  );
}
export function smsConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SmsConfig | null {
  if (env.SMS_PROVIDER_FIXTURE) {
    if (!fixtureAllowed(env)) return null;
    return {
      mode: "fixture",
      accountSid: `AC${"1".repeat(32)}`,
      messagingServiceSid: `MG${"2".repeat(32)}`,
      verifyServiceSid: `VA${"3".repeat(32)}`,
      supportEmail: "sms-support@example.test",
      fixtureURL: "http://127.0.0.1:55325",
      fixtureToken: env.SMS_FIXTURE_TOKEN!,
    };
  }
  const parsed = shared
    .extend({ apiKeySid: sid("SK"), apiKeySecret: z.string().min(16) })
    .safeParse({
      accountSid: env.TWILIO_ACCOUNT_SID,
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
      verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID,
      supportEmail: env.SMS_SUPPORT_EMAIL,
      apiKeySid: env.TWILIO_API_KEY_SID,
      apiKeySecret: env.TWILIO_API_KEY_SECRET,
    });
  if (
    !parsed.success ||
    env.SMS_LIVE_ENABLED !== "true" ||
    env.SMS_TERMS_REVIEWED !== disclosureApproval ||
    !callbackConfig(env)
  )
    return null;
  return { ...parsed.data, mode: "live" };
}
const disclosureApproval = "e4-s1-v1";
export function callbackConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CallbackConfig | null {
  if (env.SMS_PROVIDER_FIXTURE) {
    if (!fixtureAllowed(env)) return null;
    return {
      accountSid: `AC${"1".repeat(32)}`,
      messagingServiceSid: `MG${"2".repeat(32)}`,
      authToken: "local-callback-fixture-only",
      url: "http://127.0.0.1:3000/api/sms/twilio/inbound",
      senders: ["+12025550000"],
    };
  }
  const parsed = z
    .object({
      accountSid: sid("AC"),
      messagingServiceSid: sid("MG"),
      authToken: z.string().min(16),
      url: z.url(),
      senders: z
        .array(z.string().regex(/^\+[1-9][0-9]{1,14}$/))
        .min(1)
        .max(20),
    })
    .safeParse({
      accountSid: env.TWILIO_ACCOUNT_SID,
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      url: env.SMS_WEBHOOK_URL,
      senders: env.SMS_SENDER_ALLOWLIST?.split(","),
    });
  if (!parsed.success) return null;
  const url = new URL(parsed.data.url);
  if (!canonicalWebhook(url)) return null;
  return parsed.data;
}

function canonicalWebhook(url: URL) {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === "/api/sms/twilio/inbound"
  );
}
