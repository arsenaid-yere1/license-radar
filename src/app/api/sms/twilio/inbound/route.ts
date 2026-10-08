import { callbackConfig } from "@/lib/sms/config";
import { applyOptOut } from "@/lib/sms/privileged-repository";
import { handleSmsWebhook } from "@/lib/sms/webhook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleSmsWebhook(request, callbackConfig(), applyOptOut);
}
