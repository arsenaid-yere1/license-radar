"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPracticeAccess } from "@/lib/practice/access";
import { checkFormInput, requestReminderCheck } from "@/lib/reminders/history";
import type { CheckState } from "@/components/reminders/check-form";
async function saveCheck(
  _state: CheckState,
  form: FormData,
): Promise<CheckState> {
  const input = checkFormInput(form);
  if (!input) return { status: "invalid" };
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (!data.user && !error) return { status: "auth-required" };
    if (error) return { status: "unavailable" };
    const access = await getPracticeAccess(client);
    if (access.status !== "success") return { status: "unavailable" };
    if (!access.access || access.access.role === "viewer")
      return { status: "forbidden" };
    return await requestReminderCheck(client, access.access.practice.id, input);
  } catch {
    return { status: "unavailable" };
  }
}

export async function emailCheckAction(
  state: CheckState,
  form: FormData,
): Promise<CheckState> {
  const result = await saveCheck(state, form);
  if (result.status === "auth-required") redirect("/login");
  return result;
}
