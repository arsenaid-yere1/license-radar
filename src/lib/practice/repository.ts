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
  | { status: "conflict" | "unavailable" | "auth-required" };
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
    const { data, error } = await client
      .from("practices")
      .insert({ name: input.name, timezone: input.timezone })
      .select("*")
      .maybeSingle();
    if (!error && data) return { status: "success", practice: data };
    if (
      error?.code !== "23505" ||
      !error.message.includes("practices_owner_user_id_key")
    )
      return { status: "unavailable" };
    const existing = await getCurrentPractice(client);
    return existing.status === "success" && existing.practice
      ? { status: "success", practice: existing.practice }
      : { status: "unavailable" };
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
    const { data, error } = await client
      .from("practices")
      .update({ name: input.name, timezone: input.timezone })
      .eq("id", id)
      .eq("version", input.expectedVersion)
      .select("*")
      .maybeSingle();
    if (error) return { status: "unavailable" };
    return data
      ? { status: "success", practice: data }
      : { status: "conflict" };
  } catch {
    return { status: "unavailable" };
  }
}
