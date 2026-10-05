import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { roleSchema, versionSchema } from "./schema";
export const invitationRecordSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: roleSchema,
  state: z.enum(["pending", "accepted", "canceled"]),
  version: versionSchema,
  expires_at: z.iso.datetime({ offset: true }),
});
const memberSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: roleSchema,
  state: z.enum(["active", "revoked"]),
  version: versionSchema,
});
const teamSchema = z.object({
  members: z.array(memberSchema),
  invitations: z.array(invitationRecordSchema),
});
export type Invitation = z.infer<typeof invitationRecordSchema>;
export type Team = z.infer<typeof teamSchema>;
export type TeamFailure =
  | "forbidden"
  | "conflict"
  | "unavailable"
  | "auth-required"
  | "last-administrator"
  | "invite-exists"
  | "other-practice"
  | "invalid-invitation";
const failureSchema = z.enum([
  "forbidden",
  "conflict",
  "unavailable",
  "auth-required",
  "last-administrator",
  "invite-exists",
  "other-practice",
  "invalid-invitation",
]);
export async function rpcBoundary(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: "reply"; data: unknown } | { status: TeamFailure }> {
  try {
    const { data, error } = await client.rpc(name, args);
    if (error)
      return {
        status:
          error.code === "42501"
            ? "forbidden"
            : error.code === "PT409"
              ? "conflict"
              : "unavailable",
      };
    const failure = z.object({ status: failureSchema }).safeParse(data);
    return failure.success
      ? { status: failure.data.status }
      : { status: "reply", data };
  } catch {
    return { status: "unavailable" };
  }
}
export async function getTeam(
  client: SupabaseClient,
  practiceId: string,
): Promise<{ status: "success"; team: Team } | { status: TeamFailure }> {
  const reply = await rpcBoundary(client, "list_practice_team", {
    p_practice_id: practiceId,
  });
  if (reply.status !== "reply") return reply;
  const parsed = teamSchema.safeParse(reply.data);
  return parsed.success
    ? { status: "success", team: parsed.data }
    : { status: "unavailable" };
}
