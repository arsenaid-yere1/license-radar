"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveRecipient } from "@/lib/recipients/operations";
import { recipientInput, recipientMessage } from "@/lib/recipients/messages";
import type { RecipientState } from "@/lib/recipients/schema";
export async function recipientAction(
  _state: RecipientState,
  form: FormData,
): Promise<RecipientState> {
  let result;
  try {
    result = await saveRecipient(await createClient(), recipientInput(form));
  } catch {
    return { status: "unavailable", message: recipientMessage("unavailable") };
  }
  if (result.status === "auth-required") redirect("/login");
  return {
    ...result,
    message:
      result.status === "success" && !result.recipient.selected
        ? "Reminder recipient cleared. No recipient is selected."
        : recipientMessage(result.status),
  };
}
