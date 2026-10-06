"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createRegisterRecord } from "@/lib/register/operations";
import { registerInput, registerMessage } from "@/lib/register/messages";
import type { RegisterState } from "@/lib/register/schema";
export async function registerAction(
  _state: RegisterState,
  form: FormData,
): Promise<RegisterState> {
  let result;
  try {
    result = await createRegisterRecord(
      await createClient(),
      registerInput(form),
    );
  } catch {
    return { status: "unavailable", message: registerMessage("unavailable") };
  }
  if (result.status === "auth-required") redirect("/login");
  return {
    ...result,
    message: registerMessage(result.status, "clinician" in result),
  };
}
