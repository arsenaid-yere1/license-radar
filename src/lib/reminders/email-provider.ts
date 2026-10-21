import "server-only";
import { z } from "zod";
import { boundedReminderBody } from "./http";
import type { EmailConfig } from "./config";
import type { EmailSubmission, EmailOutcome } from "./messages";
import { classifyRejection } from "./recovery";
export type RecoveryOutcome = {
  kind: "accepted" | "rate-limited" | "permanent" | "uncertain";
  providerId: string | null;
  errorCode: string | null;
  retryAfterSeconds: number | null;
};
export type EmailProvider = {
  send(submission: EmailSubmission): Promise<EmailOutcome>;
  sendRecovery?(submission: EmailSubmission): Promise<RecoveryOutcome>;
  retrieve(id: string): Promise<unknown>;
};
const responseSchema = z.object({ id: z.uuid() });
async function responseJson(response: Response) {
  const raw = await boundedReminderBody(response, 65536);
  if ("status" in raw) throw new Error();
  return JSON.parse(raw.body) as unknown;
}
function uncertainRecovery(errorCode: string | null = null): RecoveryOutcome {
  return {
    kind: "uncertain",
    providerId: null,
    errorCode,
    retryAfterSeconds: null,
  };
}
async function recoveryResponse(response: Response): Promise<RecoveryOutcome> {
  try {
    const raw = await responseJson(response);
    if (response.ok) {
      const parsed = responseSchema.safeParse(raw);
      return parsed.success
        ? {
            kind: "accepted",
            providerId: parsed.data.id,
            errorCode: null,
            retryAfterSeconds: null,
          }
        : uncertainRecovery();
    }
    const rejection = classifyRejection(
      response.status,
      raw,
      response.headers.get("retry-after"),
    );
    // A malformed body cannot supply evidence for a recovery disposition.
    return rejection.errorCode === null
      ? uncertainRecovery()
      : { ...rejection, providerId: null };
  } catch {
    return uncertainRecovery();
  }
}
export function createEmailProvider(config: EmailConfig): EmailProvider {
  const origin =
    config.mode === "fixture"
      ? "http://127.0.0.1:55326"
      : "https://api.resend.com";
  async function request(
    path: string,
    method: "GET" | "POST",
    submission?: EmailSubmission,
  ) {
    return fetch(`${origin}${path}`, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(submission
          ? {
              "Content-Type": "application/json",
              "Idempotency-Key": submission.key,
            }
          : {}),
      },
      ...(submission ? { body: JSON.stringify(submission.payload) } : {}),
    });
  }
  async function send(submission: EmailSubmission): Promise<EmailOutcome> {
    let response: Response;
    try {
      response = await request("/emails", "POST", submission);
    } catch {
      return {
        outcome: "uncertain",
        providerId: null,
        error: "provider-unavailable",
      };
    }
    if (!response.ok) {
      const definite =
        response.status >= 400 &&
        response.status < 500 &&
        ![408, 409, 429].includes(response.status);
      return {
        outcome: definite ? "failed" : "uncertain",
        providerId: null,
        error: definite ? "provider-rejected" : "provider-unavailable",
      };
    }
    try {
      const parsed = responseSchema.safeParse(await responseJson(response));
      if (parsed.success)
        return { outcome: "accepted", providerId: parsed.data.id, error: null };
    } catch {
      /* A response without a trustworthy ID cannot authorize another POST. */
    }
    return {
      outcome: "uncertain",
      providerId: null,
      error: "invalid-response",
    };
  }
  async function retrieve(rawId: string) {
    const id = z.uuid().parse(rawId);
    const response = await request(`/emails/${id}`, "GET");
    if (!response.ok) throw new Error();
    return responseJson(response);
  }
  async function sendRecovery(
    submission: EmailSubmission,
  ): Promise<RecoveryOutcome> {
    let response: Response;
    try {
      response = await request("/emails", "POST", submission);
    } catch {
      return uncertainRecovery("provider-unavailable");
    }
    return recoveryResponse(response);
  }
  return { send, retrieve, sendRecovery };
}
