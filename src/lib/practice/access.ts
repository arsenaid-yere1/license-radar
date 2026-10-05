import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentPractice, type Practice } from "./repository";
export type Role = "administrator" | "manager" | "viewer";
export type PracticeAccess = {
  practice: Practice;
  role: Role;
  membershipVersion: number;
};
export async function getPracticeAccess(
  client: SupabaseClient,
): Promise<
  | { status: "success"; access: PracticeAccess | null }
  | { status: "unavailable" }
> {
  const result = await getCurrentPractice(client);
  if (result.status !== "success") return result;
  if (!result.practice) return { status: "success", access: null };
  try {
    const { data, error } = await client
      .from("practice_memberships")
      .select("practice_id,role,version")
      .eq("practice_id", result.practice.id)
      .eq("state", "active")
      .maybeSingle();
    if (
      error ||
      !data ||
      data.practice_id !== result.practice.id ||
      !["administrator", "manager", "viewer"].includes(data.role)
    )
      return { status: "unavailable" };
    return {
      status: "success",
      access: {
        practice: result.practice,
        role: data.role,
        membershipVersion: data.version,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
