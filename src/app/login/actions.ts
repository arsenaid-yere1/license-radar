"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requestCode, verifyCode, endSession } from "@/lib/auth/operations";
export type LoginState = { status: string; email?: string; message?: string };
export async function loginAction(
  state: LoginState,
  form: FormData,
): Promise<LoginState> {
  const email = String(form.get("email") ?? state.email ?? "").trim();
  const token = String(form.get("token")).trim();
  const verify = form.get("intent") === "verify";
  let result;
  try {
    const client = await createClient();
    result = verify
      ? await verifyCode(client, email, token)
      : await requestCode(client, email);
  } catch {
    return {
      status: "unavailable",
      email,
      message: "We could not complete this request. Try again.",
    };
  }
  if (result.status === "verified")
    redirect(form.get("destination") === "/join" ? "/join" : "/");
  if (result.status === "sent")
    return {
      status: "sent",
      email,
      message: "Check your email for a six-digit code.",
    };
  const messages = {
    retry: "Please wait 60 seconds before requesting another code.",
    invalid: verify
      ? "That code is invalid or expired. Request a new code and try again."
      : "Enter a valid email address.",
    unavailable: "We could not complete this request. Try again.",
  };
  return {
    status: verify ? "sent" : result.status,
    email,
    message: messages[result.status as keyof typeof messages],
  };
}
export async function signOutAction(): Promise<void> {
  const result = await endSession(await createClient());
  if (result.status !== "signed-out")
    throw new Error("We could not complete this request. Try again.");
  redirect("/login");
}
