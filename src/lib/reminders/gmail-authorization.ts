import { createHash } from "node:crypto";
import { z } from "zod";
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
] as const;
export function canonicalGmailScopes(value: unknown): string[] | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const scopes = [
    ...new Set(
      value
        .split(/\s/)
        .filter(Boolean)
        .map((s) => (s === "email" ? GMAIL_SCOPES[1] : s)),
    ),
  ].sort();
  return scopes.length === GMAIL_SCOPES.length &&
    scopes.every((s, i) => s === GMAIL_SCOPES[i])
    ? scopes
    : null;
}
export function refreshDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export type GmailBinding = {
  version: 1;
  email: string;
  subject: string;
  clientId: string;
  scopes: string[];
  authorizedAt: string;
  publishingStatus: "testing" | "production";
  testingExpiresAt: string | null;
  refreshTokenSha256: string;
};
const bindingSchema = z.strictObject({
  version: z.literal(1),
  email: z.email().max(254),
  subject: z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/),
  clientId: z.string().max(255),
  scopes: z.array(z.string().max(256)).length(3),
  authorizedAt: z.iso.datetime(),
  publishingStatus: z.enum(["testing", "production"]),
  testingExpiresAt: z.iso.datetime().nullable(),
  // The exact SHA-256 comparison below also enforces its length and encoding.
  refreshTokenSha256: z.string(),
});
function bindingLifetime(b: GmailBinding, now: number) {
  const authorized = Date.parse(b.authorizedAt),
    expires =
      b.testingExpiresAt === null ? null : Date.parse(b.testingExpiresAt);
  if (authorized > now + 60000) return false;
  if (b.publishingStatus === "production") return expires === null;
  return (
    expires !== null &&
    expires > now &&
    expires > authorized &&
    expires - authorized <= 7 * 86400000
  );
}
export function gmailBinding(
  raw: unknown,
  clientId: string,
  email: string,
  refresh: string,
  now = Date.now(),
): GmailBinding | null {
  const parsed = bindingSchema.safeParse(raw);
  if (!parsed.success) return null;
  const b = parsed.data;
  if (
    b.clientId !== clientId ||
    b.email !== email ||
    b.email !== b.email.toLowerCase() ||
    b.refreshTokenSha256 !== refreshDigest(refresh) ||
    !canonicalGmailScopes(b.scopes.join(" ")) ||
    !bindingLifetime(b, now)
  )
    return null;
  return b;
}
const GOOGLE_ENDPOINTS = {
  token: "https://oauth2.googleapis.com/token",
  identity: "https://openidconnect.googleapis.com/v1/userinfo",
  send: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
} as const;
// One deadline covers headers AND body. No redirects, arbitrary origins or hidden retries.
export async function googleJson(
  endpoint: keyof typeof GOOGLE_ENDPOINTS,
  options: RequestInit,
  milliseconds: number,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Google request unavailable"));
    }, milliseconds);
  });
  try {
    return await Promise.race([
      expired,
      (async () => {
        const response = await fetch(GOOGLE_ENDPOINTS[endpoint], {
          ...options,
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        });
        if ((response.status >= 300 && response.status < 400) || !response.body)
          throw new Error("Google request unavailable");
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65536) throw new Error("Google response unavailable");
          chunks.push(part.value);
        }
        const body: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        return { ok: response.ok, status: response.status, body };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
const accessSchema = z.object({
  access_token: z.string().regex(/^[\x21-\x7e]{1,4096}$/),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().min(60).max(86400),
  scope: z.string().optional(),
});
export function gmailAccessToken(raw: unknown) {
  const token = accessSchema.parse(raw);
  if (token.scope !== undefined && !canonicalGmailScopes(token.scope))
    throw new Error("Gmail authorization unavailable");
  return token;
}
export function verifiedGmailIdentity(
  raw: unknown,
  email: string,
  subject?: string,
) {
  const identity = z
    .object({
      email: z.email().max(254),
      email_verified: z.literal(true),
      sub: z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/),
    })
    .parse(raw);
  if (
    identity.email.toLowerCase() !== email ||
    (subject !== undefined && identity.sub !== subject)
  )
    throw new Error("Gmail identity unavailable");
  return { email: identity.email.toLowerCase(), subject: identity.sub };
}
