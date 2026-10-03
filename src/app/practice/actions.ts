"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { savePractice } from "@/lib/practice/save";
import type { FormState } from "@/components/practice/practice-form";
function actionInput(form: FormData) {
  const input: Record<string, unknown> = {};
  for (const [key, value] of form) {
    if (!key.startsWith("$ACTION_")) input[key] = value;
  }
  if ("expectedVersion" in input) {
    const raw = input.expectedVersion;
    input.expectedVersion =
      typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
  }
  return input;
}
async function save(form: FormData, editing: boolean): Promise<FormState> {
  let result;
  try {
    result = await savePractice(
      await createClient(),
      actionInput(form),
      editing,
    );
  } catch {
    return {
      status: "unavailable",
      message: "We could not complete this request. Try again.",
    };
  }
  if (result.status === "auth-required") redirect("/login");
  if (result.status === "success") {
    if (!editing) redirect("/practice");
    return { ...result, message: "Practice settings saved." };
  }
  if (result.status === "invalid")
    return { ...result, message: "Check the highlighted fields." };
  return {
    ...result,
    message:
      result.status === "conflict"
        ? "These settings changed. Reload before saving."
        : "We could not complete this request. Try again.",
  };
}
export async function createPracticeAction(_state: FormState, form: FormData) {
  return save(form, false);
}
export async function updatePracticeAction(_state: FormState, form: FormData) {
  return save(form, true);
}
