import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticationRequired } from "@/lib/auth/operations";
import { getPracticeAccess } from "@/lib/practice/access";
import { inputErrors } from "@/lib/team/schema";
import { recipientInputSchema, type RecipientResult } from "./schema";
import { setRecipient } from "./repository";
export async function saveRecipient(
  client: SupabaseClient,
  raw: unknown,
): Promise<RecipientResult> {
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
  const parsed = recipientInputSchema.safeParse(raw);
  if (!parsed.success)
    return { status: "invalid", errors: inputErrors(parsed.error) };
  return setRecipient(
    client,
    access.access.practice.id,
    parsed.data.intent === "assign" ? parsed.data.membershipId : null,
    parsed.data.expectedVersion,
  );
}
