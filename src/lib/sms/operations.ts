import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticationRequired } from "@/lib/auth/operations";
import { getPracticeAccess } from "@/lib/practice/access";
import { inputErrors } from "@/lib/team/schema";
import { smsInputSchema, type SmsInput, type SmsResult } from "./schema";
import {
  claimSchema,
  parseSmsResult,
  prepareVerification,
  saveConsent,
  withdrawConsent,
  type Claim,
} from "./repository";
import { matchingOutcome, type Provider } from "./provider";
import type { SmsConfig } from "./config";
export type SmsServices = {
  config: SmsConfig | null;
  provider: Provider | null;
  claimSend(
    practiceId: string,
    actorId: string,
    requestId: string,
  ): Promise<unknown>;
  claimCheck(
    practiceId: string,
    actorId: string,
    requestId: string,
    challengeId: string,
    version: number,
  ): Promise<unknown>;
  recordSend(
    practiceId: string,
    actorId: string,
    requestId: string,
    token: string,
    outcome: unknown,
  ): Promise<unknown>;
  recordCheck(
    practiceId: string,
    actorId: string,
    requestId: string,
    token: string,
    outcome: unknown,
  ): Promise<unknown>;
};
type VerificationInput = Extract<SmsInput, { intent: "send" | "check" }>;
async function identity(client: SupabaseClient) {
  try {
    const { data, error } = await client.auth.getUser();
    if (error)
      return {
        status: authenticationRequired(error.status)
          ? "auth-required"
          : "unavailable",
      } as const;
    if (!data.user) return { status: "auth-required" } as const;
    return { status: "authenticated", actorId: data.user.id } as const;
  } catch {
    return { status: "unavailable" } as const;
  }
}
function claimRequest(
  services: SmsServices,
  practiceId: string,
  actorId: string,
  input: VerificationInput,
) {
  return input.intent === "send"
    ? services.claimSend(practiceId, actorId, input.requestId)
    : services.claimCheck(
        practiceId,
        actorId,
        input.requestId,
        input.challengeId,
        input.expectedVersion,
      );
}
async function providerOutcome(
  services: SmsServices,
  config: SmsConfig,
  claim: Claim,
  input: VerificationInput,
) {
  if (
    claim.accountSid !== config.accountSid ||
    claim.messagingServiceSid !== config.messagingServiceSid ||
    claim.verifyServiceSid !== config.verifyServiceSid
  )
    return { status: "uncertain" };
  try {
    const response = await (input.intent === "send"
      ? services.provider!.send(claim)
      : services.provider!.check(claim, input.code));
    return matchingOutcome(response, claim, input.intent);
  } catch {
    return { status: "uncertain" };
  }
}
async function verifyRequest(
  services: SmsServices,
  config: SmsConfig,
  practiceId: string,
  actorId: string,
  input: VerificationInput,
): Promise<SmsResult> {
  const claimed = await claimRequest(services, practiceId, actorId, input);
  const claim = claimSchema.safeParse(claimed);
  if (!claim.success) return parseSmsResult(claimed);
  const record =
    input.intent === "send" ? services.recordSend : services.recordCheck;
  const outcome = await providerOutcome(services, config, claim.data, input);
  const result = await record(
    practiceId,
    actorId,
    input.requestId,
    claim.data.claimToken,
    outcome,
  );
  if (result !== null) return parseSmsResult(result);
  // Read the durable request before resolving an unknown commit; never repeat provider I/O.
  const recovered = parseSmsResult(
    await claimRequest(services, practiceId, actorId, input),
  );
  if (recovered.status === "success" || recovered.status === "wrong-code")
    return recovered;
  return parseSmsResult(
    await record(practiceId, actorId, input.requestId, claim.data.claimToken, {
      status: "uncertain",
    }),
  );
}
export async function changeEnrollment(
  client: SupabaseClient,
  raw: unknown,
  services: SmsServices,
): Promise<SmsResult> {
  const actor = await identity(client);
  if (actor.status !== "authenticated") return actor;
  const access = await getPracticeAccess(client);
  if (access.status !== "success") return access;
  if (!access.access) return { status: "forbidden" };
  const parsed = smsInputSchema.safeParse(raw);
  if (!parsed.success)
    return { status: "invalid", errors: inputErrors(parsed.error) };
  return authorizedChange(
    client,
    services,
    actor.actorId,
    access.access.practice.id,
    access.access.role,
    parsed.data,
  );
}
async function authorizedChange(
  client: SupabaseClient,
  services: SmsServices,
  actorId: string,
  practiceId: string,
  role: string,
  input: SmsInput,
): Promise<SmsResult> {
  if (input.intent === "withdraw")
    return withdrawConsent(client, practiceId, input.requestId);
  if (role === "viewer") return { status: "forbidden" };
  const config = services.config;
  if (!config || !services.provider) return { status: "setup-unavailable" };
  if (input.intent === "consent")
    return saveConsent(
      client,
      practiceId,
      input.requestId,
      input.expectedVersion,
    );
  if (input.intent === "send") {
    const prepared = await prepareVerification(client, {
      p_practice_id: practiceId,
      p_request_id: input.requestId,
      p_phone: input.phone,
      p_expected_version: input.expectedVersion,
      p_change_confirmed: input.changeConfirmed,
      p_otp_permission: input.otpPermission,
      p_account_sid: config.accountSid,
      p_messaging_service_sid: config.messagingServiceSid,
      p_verify_service_sid: config.verifyServiceSid,
    });
    if (prepared.status !== "success") return prepared;
    if (prepared.enrollment.verified) return prepared;
  }
  return verifyRequest(services, config, practiceId, actorId, input);
}
