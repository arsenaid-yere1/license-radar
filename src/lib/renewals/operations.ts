import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticationRequired } from "@/lib/auth/operations";
import { getPracticeAccess } from "@/lib/practice/access";
import { inputErrors } from "@/lib/team/schema";
import { renewalInputSchema, type RenewalResult } from "./schema";
import { saveRenewal } from "./repository";
export async function changeRenewal(
  client: SupabaseClient,
  raw: unknown,
  credentialId: string,
): Promise<RenewalResult> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error)
      return {
        status: authenticationRequired(error.status)
          ? "auth-required"
          : "unavailable",
      };
    if (!data.user) return { status: "auth-required" };
  } catch {
    return { status: "unavailable" };
  }
  const access = await getPracticeAccess(client);
  if (access.status !== "success") return access;
  if (!access.access || access.access.role === "viewer")
    return { status: "forbidden" };
  const parsed = renewalInputSchema.safeParse(raw);
  if (!parsed.success)
    return { status: "invalid", errors: inputErrors(parsed.error) };
  if (parsed.data.id !== credentialId.toLowerCase())
    return {
      status: "invalid",
      errors: { id: "This record is unavailable. Reload the register." },
    };
  return saveRenewal(client, access.access.practice.id, parsed.data);
}
