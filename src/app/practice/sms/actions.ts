"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { smsConfig } from "@/lib/sms/config";
import { createProvider } from "@/lib/sms/provider";
import {
  claimSend,
  claimCheck,
  recordSend,
  recordCheck,
  smsStorageConfigured,
} from "@/lib/sms/privileged-repository";
import { changeEnrollment } from "@/lib/sms/operations";
import { smsInput, smsMessage } from "@/lib/sms/messages";
import type { SmsState } from "@/lib/sms/schema";
export async function smsAction(
  _state: SmsState,
  form: FormData,
): Promise<SmsState> {
  let result;
  try {
    const config = smsStorageConfigured() ? smsConfig() : null;
    result = await changeEnrollment(await createClient(), smsInput(form), {
      config,
      provider: config ? createProvider(config) : null,
      claimSend,
      claimCheck,
      recordSend,
      recordCheck,
    });
  } catch {
    return { status: "unavailable", message: smsMessage("unavailable") };
  }
  if (result.status === "auth-required") redirect("/login");
  return { ...result, message: smsMessage(result.status) };
}
