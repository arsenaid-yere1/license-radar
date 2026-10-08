import "server-only";
import twilio from "twilio";
import { z } from "zod";
import type { Claim } from "./repository";
import type { SmsConfig } from "./config";
const outcomeSchema = z.object({
  accountSid: z.string(),
  serviceSid: z.string(),
  sid: z.string().regex(/^VE[0-9a-fA-F]{32}$/),
  to: z.string(),
  channel: z.literal("sms"),
  status: z.enum([
    "pending",
    "approved",
    "canceled",
    "max_attempts_reached",
    "deleted",
    "failed",
    "expired",
  ]),
});
export type Provider = {
  send(claim: Claim): Promise<unknown>;
  check(claim: Claim, code: string): Promise<unknown>;
};
export function matchingOutcome(
  raw: unknown,
  claim: Claim,
  intent: "send" | "check",
) {
  const parsed = outcomeSchema.safeParse(raw);
  if (!parsed.success) return { status: "uncertain" };
  const value = parsed.data;
  if (
    value.accountSid !== claim.accountSid ||
    value.serviceSid !== claim.verifyServiceSid ||
    value.to !== claim.phone ||
    (claim.verificationSid !== null && value.sid !== claim.verificationSid) ||
    (intent === "send" && value.status === "approved")
  )
    return { status: "uncertain" };
  return value;
}
export function createProvider(config: SmsConfig): Provider {
  if (config.mode === "fixture") {
    const { fixtureURL, fixtureToken } = config;
    async function invoke(path: string, payload: unknown) {
      const response = await fetch(`${fixtureURL}/${path}`, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixtureToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Verification unavailable");
      return response.json();
    }
    return {
      send: (claim) => invoke("send", { claim }),
      check: (claim, code) => invoke("check", { claim, code }),
    };
  }
  const client = twilio(config.apiKeySid, config.apiKeySecret, {
    accountSid: config.accountSid,
    autoRetry: false,
    timeout: 10000,
  });
  const service = client.verify.v2.services(config.verifyServiceSid);
  return {
    send: (claim) =>
      service.verifications.create({ to: claim.phone, channel: "sms" }),
    check: (claim, code) =>
      service.verificationChecks.create({
        verificationSid: claim.verificationSid!,
        code,
      }),
  };
}
