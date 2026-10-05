"use server";
import type { JoinState } from "@/components/auth/join-form";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { joinPractice } from "@/lib/team/operations";
import {
  accessMessage,
  formInput,
  unavailableMessage,
} from "@/lib/team/messages";
export async function joinAction(
  _state: JoinState,
  form: FormData,
): Promise<JoinState> {
  const intent = form.get("intent");
  if (intent !== "preview" && intent !== "accept")
    return {
      status: "invalid-invitation",
      message: accessMessage("invalid-invitation"),
    };
  let result;
  try {
    result = await joinPractice(
      await createClient(),
      formInput(form),
      intent === "accept",
    );
  } catch {
    return { status: "unavailable", message: unavailableMessage };
  }
  if (result.status === "auth-required") redirect("/join");
  const message =
    result.status === "success"
      ? intent === "accept"
        ? "Practice access granted."
        : "Review the practice and role, then accept."
      : accessMessage(result.status);
  return { ...result, message };
}
