"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { changeRenewal } from "@/lib/renewals/operations";
import {
  renewalFormInput,
  renewalMessage,
  unavailableMessage,
} from "@/lib/renewals/messages";
import type { RenewalFormState } from "@/lib/renewals/schema";
export async function renewalAction(
  id: string,
  _state: RenewalFormState,
  form: FormData,
): Promise<RenewalFormState> {
  let result;
  try {
    result = await changeRenewal(
      await createClient(),
      renewalFormInput(form),
      id,
    );
  } catch {
    return { status: "unavailable", message: unavailableMessage };
  }
  if (result.status === "auth-required") redirect("/login");
  return {
    ...result,
    message: renewalMessage(result.status, form.get("intent") as string | null),
  };
}
