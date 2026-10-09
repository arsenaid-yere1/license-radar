"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveEmailPreference } from "@/lib/reminders/operations";
import type { PreferenceState } from "@/lib/reminders/schema";
import { preferenceFormInput } from "@/lib/reminders/messages";
export async function emailPreferenceAction(
  _state: PreferenceState,
  form: FormData,
): Promise<PreferenceState> {
  const input = preferenceFormInput(form);
  let result: PreferenceState;
  if (!input) result = { status: "invalid" };
  else {
    try {
      result = await saveEmailPreference(await createClient(), input);
    } catch {
      result = { status: "unavailable" };
    }
  }
  if (result.status === "auth-required") redirect("/login");
  return {
    ...result,
    message:
      result.status === "success"
        ? "Email reminder preference saved."
        : "We could not confirm this change. Reload before trying again.",
  };
}
