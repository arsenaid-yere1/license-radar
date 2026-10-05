import type { SupabaseClient } from "@supabase/supabase-js";
export type Practice = {
  id: string;
  owner_user_id: string;
  name: string;
  timezone: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export type PracticeResult =
  | { status: "success"; practice: Practice }
  | { status: "conflict" | "forbidden" | "unavailable" | "auth-required" };
export async function getCurrentPractice(
  client: SupabaseClient,
): Promise<
  { status: "success"; practice: Practice | null } | { status: "unavailable" }
> {
  try {
    const { data, error } = await client
      .from("practices")
      .select("*")
      .maybeSingle();
    return error
      ? { status: "unavailable" }
      : { status: "success", practice: data };
  } catch {
    return { status: "unavailable" };
  }
}
export async function createPractice(
  client: SupabaseClient,
  input: { name: string; timezone: string },
): Promise<PracticeResult> {
  try {
    const { data, error } = await client.rpc("create_practice", {
      p_name: input.name,
      p_timezone: input.timezone,
    });
    if (!error && data) return { status: "success", practice: data };
    return { status: error?.code === "42501" ? "forbidden" : "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
export async function updatePractice(
  client: SupabaseClient,
  id: string,
  input: { name: string; timezone: string; expectedVersion: number },
): Promise<PracticeResult> {
  try {
    const { data, error } = await client.rpc("update_practice", {
      p_practice_id: id,
      p_name: input.name,
      p_timezone: input.timezone,
      p_expected_version: input.expectedVersion,
    });
    if (error?.code === "42501") return { status: "forbidden" };
    if (error?.code === "PT409") return { status: "conflict" };
    if (error) return { status: "unavailable" };
    return data
      ? { status: "success", practice: data }
      : { status: "conflict" };
  } catch {
    return { status: "unavailable" };
  }
}
