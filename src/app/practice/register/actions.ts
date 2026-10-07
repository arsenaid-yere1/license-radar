"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  changeRegisterRecord,
  createRegisterRecord,
} from "@/lib/register/operations";
import {
  maintenanceFormInput,
  maintenanceMessage,
  registerInput,
  registerMessage,
} from "@/lib/register/messages";
import type { MaintenanceState, RegisterState } from "@/lib/register/schema";
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

export async function maintenanceAction(
  _state: MaintenanceState,
  form: FormData,
): Promise<MaintenanceState> {
  let result;
  try {
    result = await changeRegisterRecord(
      await createClient(),
      maintenanceFormInput(form),
    );
  } catch {
    return {
      status: "unavailable",
      message: maintenanceMessage("unavailable"),
    };
  }
  if (result.status === "auth-required") redirect("/login");
  return {
    ...result,
    message: maintenanceMessage(
      result.status,
      form.get("intent") === "archive",
    ),
  };
}
