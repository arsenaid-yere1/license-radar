import "server-only";
import type { EmailOutcome } from "@/lib/reminders/messages";
import { createClient } from "@supabase/supabase-js";
async function call(
  name: string,
  args: Record<string, unknown>,
  timeout?: number,
): Promise<unknown> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return null;
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const rpc = client.rpc(name, args);
    const { data, error } = await (timeout
      ? rpc.abortSignal(AbortSignal.timeout(timeout))
      : rpc);
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

// Email operations share the constrained client, never an exported raw client/RPC.
export function reminderStorageConfigured() {
  return smsStorageConfigured();
}
export async function drainReminderAccounts() {
  return call("drain_email_reminder_accounts", {}, 5000);
}
export async function reconcileReminderJobs(namespace: string) {
  return call("reconcile_email_reminders", { p_namespace: namespace }, 5000);
}
export async function claimReminderJob() {
  return call("claim_email_reminder", {}, 5000);
}
export async function beginReminderSubmission(
  jobId: string,
  token: string,
  config: { namespace: string; from: string; replyTo: string; appUrl: string },
) {
  return call(
    "begin_email_reminder",
    { p_job_id: jobId, p_claim_token: token, p_config: config },
    5000,
  );
}
export async function recordReminderSubmission(
  attemptId: string,
  token: string,
  outcome: EmailOutcome,
) {
  return call(
    "record_email_reminder",
    {
      p_attempt_id: attemptId,
      p_token: token,
      p_outcome: outcome.outcome,
      p_provider_id: outcome.providerId,
      p_error: outcome.error,
    },
    5000,
  );
}
export async function expireReminderSubmissions() {
  return call("expire_email_submissions", {}, 5000);
}
export async function findReminderBinding(
  namespace: string,
  providerId: string,
  attemptId: string | null,
) {
  return call(
    "email_reminder_binding",
    {
      p_namespace: namespace,
      p_provider_id: providerId,
      p_attempt_id: attemptId,
    },
    5000,
  );
}
export async function applyReminderEvent(
  namespace: string,
  eventId: string,
  providerId: string,
  attemptId: string,
  status: string,
  from: string,
  to: string,
) {
  return call(
    "apply_email_reminder_event",
    {
      p_namespace: namespace,
      p_event_id: eventId,
      p_provider_id: providerId,
      p_attempt_id: attemptId,
      p_status: status,
      p_from: from,
      p_to: to,
    },
    5000,
  );
}
export async function startReminderRun() {
  return call("start_email_reminder_run", {}, 5000);
}
export async function finishReminderRun(
  runId: string,
  success: boolean,
  counts: Record<string, number>,
) {
  return call(
    "finish_email_reminder_run",
    { p_run_id: runId, p_success: success, p_counts: counts },
    5000,
  );
}
