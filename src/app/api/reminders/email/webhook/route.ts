import { emailWebhookConfig } from "@/lib/reminders/config";
import { createEmailProvider } from "@/lib/reminders/email-provider";
import { reminderReply } from "@/lib/reminders/http";
import { handleEmailWebhook } from "@/lib/reminders/email-webhook";
import {
  findReminderBinding,
  applyReminderEvent,
} from "@/lib/sms/privileged-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  const config = emailWebhookConfig();
  if (!config) return reminderReply(503);
  return handleEmailWebhook(request, config, {
    binding: findReminderBinding,
    retrieve: (id) => createEmailProvider(config).retrieve(id),
    persist: applyReminderEvent,
  });
}
