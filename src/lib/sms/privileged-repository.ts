import "server-only";
import { createClient } from "@supabase/supabase-js";
async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return null;
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc(name, args);
    return error ? null : data;
  } catch {
    return null;
  }
}
export async function claimSend(
  practiceId: string,
  actorId: string,
  requestId: string,
) {
  return call("claim_sms_verification_send", {
    p_practice_id: practiceId,
    p_actor_id: actorId,
    p_request_id: requestId,
  });
}
export async function claimCheck(
  practiceId: string,
  actorId: string,
  requestId: string,
  challengeId: string,
  expectedVersion: number,
) {
  return call("claim_sms_verification_check", {
    p_practice_id: practiceId,
    p_actor_id: actorId,
    p_request_id: requestId,
    p_challenge_id: challengeId,
    p_expected_version: expectedVersion,
  });
}
export async function recordSend(
  practiceId: string,
  actorId: string,
  requestId: string,
  token: string,
  outcome: unknown,
) {
  return call("record_sms_verification_send", {
    p_practice_id: practiceId,
    p_actor_id: actorId,
    p_request_id: requestId,
    p_claim_token: token,
    p_outcome: outcome,
  });
}
export async function recordCheck(
  practiceId: string,
  actorId: string,
  requestId: string,
  token: string,
  outcome: unknown,
) {
  return call("record_sms_verification_check", {
    p_practice_id: practiceId,
    p_actor_id: actorId,
    p_request_id: requestId,
    p_claim_token: token,
    p_outcome: outcome,
  });
}
export async function applyOptOut(
  accountSid: string,
  messagingSid: string,
  phone: string,
  messageSid: string,
  type: string,
) {
  return call("apply_sms_provider_opt_out", {
    p_account_sid: accountSid,
    p_messaging_service_sid: messagingSid,
    p_phone: phone,
    p_message_sid: messageSid,
    p_opt_out_type: type,
  });
}

export function smsStorageConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
  );
}
