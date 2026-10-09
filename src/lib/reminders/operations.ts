import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticationRequired } from "@/lib/auth/operations";
import { getPracticeAccess } from "@/lib/practice/access";
import { preferenceInputSchema, type PreferenceState } from "./schema";
import { setEmailPreference } from "./repository";
export async function saveEmailPreference(
  client: SupabaseClient,
  raw: unknown,
): Promise<PreferenceState> {
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
  if (!access.access) return { status: "forbidden" };
  const parsed = preferenceInputSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  if (parsed.data.enabled && access.access.role === "viewer")
    return { status: "forbidden" };
  return setEmailPreference(client, access.access.practice.id, parsed.data);
}
