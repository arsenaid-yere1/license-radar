import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
export type AuthResult = {
  status:
    "sent" | "verified" | "signed-out" | "invalid" | "retry" | "unavailable";
};
export async function requestCode(
  client: SupabaseClient,
  email: string,
): Promise<AuthResult> {
  if (!z.email().safeParse(email).success) return { status: "invalid" };
  try {
    const { error } = await client.auth.signInWithOtp({ email });
    if (!error) return { status: "sent" };
    return {
      status:
        error.code === "over_email_send_rate_limit" ? "retry" : "unavailable",
    };
  } catch {
    return { status: "unavailable" };
  }
}
export async function verifyCode(
  client: SupabaseClient,
  email: string,
  token: string,
): Promise<AuthResult> {
  if (!z.email().safeParse(email).success || !/^\d{6}$/.test(token))
    return { status: "invalid" };
  try {
    const { error } = await client.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (!error) return { status: "verified" };
    return { status: error.code === "otp_expired" ? "invalid" : "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
export async function endSession(client: SupabaseClient): Promise<AuthResult> {
  try {
    const { error } = await client.auth.signOut();
    return { status: error ? "unavailable" : "signed-out" };
  } catch {
    return { status: "unavailable" };
  }
}

export function authenticationRequired(status?: number) {
  return [400, 401, 403].includes(status ?? 0);
}
