import "server-only";
import { gmailBinding, type GmailBinding } from "./gmail-authorization";
import { z } from "zod";
export type GmailConfig = {
  kind: "gmail";
  namespace: string;
  from: string;
  replyTo: string;
  appUrl: string;
  allowedRecipient: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  binding: GmailBinding;
};
export function selectedEmailProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): "gmail" | "resend" | null {
  return env.EMAIL_PROVIDER === "gmail"
    ? "gmail"
    : env.EMAIL_PROVIDER === undefined || env.EMAIL_PROVIDER === "resend"
      ? "resend"
      : null;
}
const secret = z.string().regex(/^[\x21-\x7e]{8,4096}$/);
const configSchema = z.object({
  namespace: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  from: z.email().max(254),
  replyTo: z.email().max(254),
  allowedRecipient: z.email().max(254),
  clientId: z.string().regex(/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/),
  clientSecret: secret,
  refreshToken: secret,
  appUrl: z.url(),
});
function validPilot(p: z.infer<typeof configSchema>) {
  return (
    p.from === p.replyTo &&
    p.from === p.allowedRecipient &&
    p.from.endsWith("@gmail.com")
  );
}
function validOrigin(raw: string) {
  const url = new URL(raw);
  return (
    url.protocol === "https:" &&
    url.origin === raw &&
    url.hostname.includes(".") &&
    !/(?:\.test|\.invalid|\.local)$/.test(url.hostname)
  );
}
function bindingInput(raw: string | undefined) {
  if (!raw || raw.length > 4096) throw new Error();
  return JSON.parse(raw) as unknown;
}
function gmailEnvironment(env: Readonly<Record<string, string | undefined>>) {
  return (
    selectedEmailProvider(env) === "gmail" &&
    env.EMAIL_REMINDERS_ENABLED === "true" &&
    ![
      env.EMAIL_PROVIDER_FIXTURE,
      env.EMAIL_FIXTURE_URL,
      env.EMAIL_FIXTURE_TOKEN,
    ].some(Boolean)
  );
}
export function gmailConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GmailConfig | null {
  if (!gmailEnvironment(env)) return null;
  try {
    const p = configSchema.parse({
      namespace: env.GMAIL_PROVIDER_NAMESPACE,
      from: env.GMAIL_SENDER_EMAIL,
      replyTo: env.GMAIL_REPLY_TO,
      allowedRecipient: env.GMAIL_ALLOWED_RECIPIENT,
      clientId: env.GMAIL_OAUTH_CLIENT_ID,
      clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET,
      refreshToken: env.GMAIL_OAUTH_REFRESH_TOKEN,
      appUrl: env.REMINDER_APP_URL,
    });
    if (!validPilot(p) || !validOrigin(p.appUrl)) return null;
    const binding = gmailBinding(
      bindingInput(env.GMAIL_OAUTH_BINDING),
      p.clientId,
      p.from,
      p.refreshToken,
    );
    return binding ? { ...p, kind: "gmail", binding } : null;
  } catch {
    return null;
  }
}
