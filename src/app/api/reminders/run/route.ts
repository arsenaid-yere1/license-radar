import { emailConfig, reminderWorkerSecret } from "@/lib/reminders/config";
import { createEmailProvider } from "@/lib/reminders/email-provider";
import { handleReminderRun } from "@/lib/reminders/worker";
import {
  reminderStorageConfigured,
  startReminderRun,
  expireReminderSubmissions,
  drainReminderAccounts,
  reconcileReminderJobs,
  claimReminderJob,
  beginReminderSubmission,
  recordReminderSubmission,
  finishReminderRun,
} from "@/lib/sms/privileged-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  return handleReminderRun(request, {
    secret: reminderWorkerSecret(),
    sendingEnabled: process.env.EMAIL_REMINDERS_ENABLED === "true",
    config: () => emailConfig(),
    storageConfigured: reminderStorageConfigured,
    provider: createEmailProvider,
    start: startReminderRun,
    expire: expireReminderSubmissions,
    drain: drainReminderAccounts,
    reconcile: reconcileReminderJobs,
    claim: claimReminderJob,
    begin: beginReminderSubmission,
    record: recordReminderSubmission,
    finish: finishReminderRun,
  });
}
