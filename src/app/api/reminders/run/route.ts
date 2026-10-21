import { reminderHeartbeat } from "@/lib/reminders/heartbeat";
import {
  emailConfig,
  emailWebhookConfig,
  reminderWorkerSecret,
} from "@/lib/reminders/config";
import { createEmailProvider } from "@/lib/reminders/email-provider";
import { handleReminderRun } from "@/lib/reminders/worker";
import {
  gmailConfig,
  selectedEmailProvider,
} from "@/lib/reminders/gmail-config";
import { authorizeGmail } from "@/lib/reminders/gmail-provider";
import {
  gmailReminderReadiness,
  beginGmailReminder,
  recordGmailReminder,
  expireGmailReminders,
} from "@/lib/sms/privileged-repository";
import { z } from "zod";
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
  claimReminderRecovery,
  beginReminderRecovery,
  recordReminderRecovery,
  recordReminderCheck,
  expireReminderRecovery,
} from "@/lib/sms/privileged-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (selectedEmailProvider() === "gmail") {
    let version: number | null = null;
    return handleReminderRun(request, {
      secret: reminderWorkerSecret(),
      sendingEnabled: process.env.EMAIL_REMINDERS_ENABLED === "true",
      config: gmailConfig,
      storageConfigured: reminderStorageConfigured,
      prepare: async (config) => {
        const provider = await authorizeGmail(config);
        version = z
          .number()
          .int()
          .positive()
          .max(2147483647)
          .parse(await gmailReminderReadiness(config));
        return provider;
      },
      directDispatch: true,
      submissionDeadline: true,
      start: startReminderRun,
      expire: async () => {
        const legacy = await expireReminderSubmissions(),
          recovery = await expireReminderRecovery(),
          gmail = await expireGmailReminders();
        return typeof legacy === "number" &&
          typeof recovery === "number" &&
          typeof gmail === "number"
          ? legacy + recovery + gmail
          : null;
      },
      drain: drainReminderAccounts,
      reconcile: reconcileReminderJobs,
      claim: claimReminderJob,
      begin: (jobId, token, config) => {
        const current = gmailConfig();
        return current && version !== null
          ? beginGmailReminder(
              jobId,
              token,
              config,
              current.binding.subject,
              version,
            )
          : Promise.resolve(null);
      },
      record: recordGmailReminder,
      finish: finishReminderRun,
      heartbeat: reminderHeartbeat,
      recoveryConfig: emailWebhookConfig,
      recovery: {
        sendingEnabled: false,
        provider: (config) => {
          const provider = createEmailProvider(config);
          return {
            retrieve: provider.retrieve,
            sendRecovery: provider.sendRecovery!,
          };
        },
        claim: claimReminderRecovery,
        begin: beginReminderRecovery,
        record: recordReminderRecovery,
        recordCheck: recordReminderCheck,
      },
    });
  }
  return handleReminderRun(request, {
    secret: reminderWorkerSecret(),
    sendingEnabled: process.env.EMAIL_REMINDERS_ENABLED === "true",
    config: () => (selectedEmailProvider() === "resend" ? emailConfig() : null),
    storageConfigured: reminderStorageConfigured,
    provider: createEmailProvider,
    start: startReminderRun,
    expire: async () => {
      const legacy = await expireReminderSubmissions(),
        recovery = await expireReminderRecovery();
      return typeof legacy === "number" && typeof recovery === "number"
        ? legacy + recovery
        : null;
    },
    drain: drainReminderAccounts,
    reconcile: reconcileReminderJobs,
    claim: claimReminderJob,
    begin: beginReminderSubmission,
    record: recordReminderSubmission,
    finish: finishReminderRun,
    heartbeat: reminderHeartbeat,
    recoveryConfig: () => emailWebhookConfig(),
    recovery: {
      sendingEnabled:
        selectedEmailProvider() === "resend" &&
        process.env.EMAIL_REMINDERS_ENABLED === "true",
      provider: (config) => {
        const provider = createEmailProvider(config);
        return {
          retrieve: provider.retrieve,
          sendRecovery: provider.sendRecovery!,
        };
      },
      claim: claimReminderRecovery,
      begin: beginReminderRecovery,
      record: recordReminderRecovery,
      recordCheck: recordReminderCheck,
    },
  });
}
