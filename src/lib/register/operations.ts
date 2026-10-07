import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticationRequired } from "@/lib/auth/operations";
import { getPracticeAccess } from "@/lib/practice/access";
import { inputErrors } from "@/lib/team/schema";
import {
  maintenanceInputSchema,
  type MaintenanceResult,
  registerInputSchema,
  type RegisterResult,
} from "./schema";
import { changeRecord, createRecord } from "./repository";
export async function createRegisterRecord(
  client: SupabaseClient,
  raw: unknown,
): Promise<RegisterResult> {
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
  const parsed = registerInputSchema.safeParse(raw);
  if (!parsed.success)
    return { status: "invalid", errors: inputErrors(parsed.error) };
  return createRecord(client, access.access.practice.id, parsed.data);
}

export async function changeRegisterRecord(
  client: SupabaseClient,
  raw: unknown,
): Promise<MaintenanceResult> {
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
  const parsed = maintenanceInputSchema.safeParse(raw);
  if (!parsed.success)
    return { status: "invalid", errors: inputErrors(parsed.error) };
  return changeRecord(client, access.access.practice.id, parsed.data);
}
