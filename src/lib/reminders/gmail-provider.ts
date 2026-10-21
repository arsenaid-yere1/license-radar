import "server-only";
import type { GmailConfig } from "./gmail-config";
import type { EmailSubmission, EmailOutcome } from "./messages";
import { submissionSchema } from "./messages";
import {
  gmailBinding,
  gmailAccessToken,
  verifiedGmailIdentity,
  googleJson,
} from "./gmail-authorization";
import { z } from "zod";
function uncertain(
  error: EmailOutcome["error"] = "provider-unavailable",
): EmailOutcome {
  return { outcome: "uncertain", providerId: null, error };
}
function rejectedOutcome(
  result: Awaited<ReturnType<typeof googleJson>>,
): EmailOutcome {
  const rejected = z
    .object({
      error: z.object({
        code: z.number().int(),
        message: z.string().max(4096),
        status: z.string().max(80),
      }),
    })
    .safeParse(result.body);
  return rejected.success &&
    rejected.data.error.code === result.status &&
    result.status < 500 &&
    ![408, 409, 429].includes(result.status)
    ? {
        outcome: "failed",
        providerId: null,
        error: "provider-rejected",
      }
    : uncertain();
}
export async function authorizeGmail(
  config: GmailConfig,
): Promise<{ send(s: EmailSubmission): Promise<EmailOutcome> }> {
  if (
    !gmailBinding(
      config.binding,
      config.clientId,
      config.from,
      config.refreshToken,
    )
  )
    throw new Error("Gmail reconnect required");
  try {
    const response = await googleJson(
      "token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: config.refreshToken,
          grant_type: "refresh_token",
        }),
      },
      3000,
    );
    if (!response.ok) throw new Error();
    const token = gmailAccessToken(response.body),
      validUntil = Date.now() + token.expires_in * 1000;
    const identity = await googleJson(
      "identity",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token.access_token}` },
      },
      3000,
    );
    if (!identity.ok) throw new Error();
    verifiedGmailIdentity(identity.body, config.from, config.binding.subject);
    const seen = new Set<string>();
    return {
      async send(submission) {
        let raw: string;
        try {
          raw = gmailMime(submission, config);
        } catch {
          return uncertain("invalid-response");
        }
        if (seen.has(submission.attemptId) || validUntil - Date.now() < 20000)
          return uncertain("interrupted");
        seen.add(submission.attemptId);
        let result: Awaited<ReturnType<typeof googleJson>>;
        try {
          result = await googleJson(
            "send",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token.access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                raw: Buffer.from(raw).toString("base64url"),
              }),
            },
            10000,
          );
        } catch {
          return uncertain();
        }
        if (!result.ok) {
          return rejectedOutcome(result);
        }
        const accepted = z
          .object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) })
          .safeParse(result.body);
        return accepted.success
          ? { outcome: "accepted", providerId: accepted.data.id, error: null }
          : uncertain("invalid-response");
      },
    };
  } catch {
    throw new Error("Gmail reconnect required");
  }
}
function mimePart(kind: "plain" | "html", value: string) {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return [
    `Content-Type: text/${kind}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    encoded.match(/.{1,76}/g)!.join("\r\n"),
  ].join("\r\n");
}
export function gmailMime(raw: EmailSubmission, config: GmailConfig): string {
  const s = submissionSchema.parse(raw),
    p = s.payload;
  if (
    p.from !== config.from ||
    p.reply_to !== config.replyTo ||
    p.to[0] !== config.allowedRecipient ||
    config.from !== config.allowedRecipient
  )
    throw new Error("Gmail message unavailable");
  const boundary = `license-radar-${s.attemptId}`;
  return [
    `From: ${p.from}`,
    `To: ${p.to[0]}`,
    `Reply-To: ${p.reply_to}`,
    `Subject: ${p.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    mimePart("plain", p.text),
    `--${boundary}`,
    mimePart("html", p.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
