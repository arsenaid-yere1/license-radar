import { authenticationRequired } from "@/lib/auth/operations";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPractice,
  getCurrentPractice,
  updatePractice,
  type Practice,
} from "./repository";
import { validatePractice } from "./schema";
export type SaveResult =
  | { status: "success"; practice: Practice }
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "auth-required" | "conflict" | "forbidden" | "unavailable" };
export async function savePractice(
  client: SupabaseClient,
  raw: unknown,
  editing: boolean,
): Promise<SaveResult> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error)
      return {
        status: authenticationRequired(error.status)
          ? "auth-required"
          : "unavailable",
      };
    if (!data.user) return { status: "auth-required" };
    const parsed = validatePractice(raw, editing);
    if (!parsed.success) return { status: "invalid", errors: parsed.errors };
    if (!editing) return createPractice(client, parsed.data);
    const existing = await getCurrentPractice(client);
    if (existing.status !== "success") return existing;
    if (!existing.practice) return { status: "conflict" };
    return updatePractice(client, existing.practice.id, {
      ...parsed.data,
      expectedVersion: parsed.data.expectedVersion!,
    });
  } catch {
    return { status: "unavailable" };
  }
}
