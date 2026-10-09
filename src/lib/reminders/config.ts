import "server-only";
import { z } from "zod";
export type EmailConfig = {
  mode: "fixture" | "live";
  namespace: string;
  from: string;
  replyTo: string;
  appUrl: string;
  baseUrl: string;
  apiKey: string;
  webhookSecret: string;
};
type Environment = Readonly<Record<string, string | undefined>>;
const bareAddress = z
  .email()
  .max(254)
  .refine((value) => !/[\r\n]/.test(value));
const liveAddress = bareAddress.refine(
  (value) => !/@resend\.dev$|\.test$/i.test(value),
);
const secret = z.string().regex(/^whsec_[A-Za-z0-9+/]{20,}={0,2}$/);
const workerSecret = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[a-zA-Z0-9_-]+$/);
const liveSchema = z.object({
  namespace: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  from: liveAddress,
  replyTo: liveAddress,
  appUrl: z.url(),
  apiKey: z.string().regex(/^re_[a-zA-Z0-9_-]{12,}$/),
  webhookSecret: secret,
});
function fixtureAllowed(env: Environment) {
  const required = {
    EMAIL_PROVIDER_FIXTURE: "local-e4-s2",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
    EMAIL_FIXTURE_URL: "http://127.0.0.1:55326",
    EMAIL_FIXTURE_TOKEN: "local-fixture-only-e4-s2",
    REMINDER_APP_URL: "http://127.0.0.1:3000",
  };
  return (
    Object.entries(required).every(([key, value]) => env[key] === value) &&
    [
      "VERCEL",
      "VERCEL_ENV",
      "CI_DEPLOYMENT",
      "RESEND_API_KEY",
      "RESEND_WEBHOOK_SECRET",
    ].every((key) => !env[key])
  );
}
function publicOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !url.hostname.includes(".") ||
    /(?:\.test|\.invalid|\.local)$/.test(url.hostname)
  )
    return null;
  return url.origin;
}
export function emailWebhookConfig(
  env: Environment = process.env,
): EmailConfig | null {
  if (env.EMAIL_PROVIDER_FIXTURE) {
    if (!fixtureAllowed(env)) return null;
    return {
      mode: "fixture",
      namespace: "fixture-reminders",
      from: "reminders@example.test",
      replyTo: "support@example.test",
      appUrl: "http://127.0.0.1:3000",
      baseUrl: "http://127.0.0.1:55326",
      apiKey: "local-fixture-only-e4-s2",
      webhookSecret:
        "whsec_" +
        Buffer.from("fixture-signing-secret-e4-s2-only!").toString("base64"),
    };
  }
  const parsed = liveSchema.safeParse({
    namespace: env.EMAIL_PROVIDER_NAMESPACE,
    from: env.EMAIL_FROM,
    replyTo: env.EMAIL_REPLY_TO,
    appUrl: env.REMINDER_APP_URL,
    apiKey: env.RESEND_API_KEY,
    webhookSecret: env.RESEND_WEBHOOK_SECRET,
  });
  if (!parsed.success) return null;
  const appUrl = publicOrigin(parsed.data.appUrl);
  if (!appUrl) return null;
  return {
    ...parsed.data,
    mode: "live",
    appUrl,
    baseUrl: "https://api.resend.com",
  };
}
export function emailConfig(
  env: Environment = process.env,
): EmailConfig | null {
  return env.EMAIL_REMINDERS_ENABLED === "true"
    ? emailWebhookConfig(env)
    : null;
}
export function reminderWorkerSecret(
  env: Environment = process.env,
): string | null {
  if (env.EMAIL_PROVIDER_FIXTURE)
    return fixtureAllowed(env)
      ? "local-worker-fixture-only-e4-s2-authorization"
      : null;
  const parsed = workerSecret.safeParse(env.REMINDER_WORKER_SECRET);
  return parsed.success ? parsed.data : null;
}
