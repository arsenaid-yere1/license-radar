import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { authenticationRequired } from "@/lib/auth/operations";
import { getPracticeAccess } from "@/lib/practice/access";
import { hashInvitationToken, generateInvitation } from "./invitations";
import {
  invitationInputSchema,
  memberInputSchema,
  recordInputSchema,
  inputErrors,
  roleSchema,
} from "./schema";
import {
  invitationRecordSchema,
  rpcBoundary,
  type Invitation,
  type TeamFailure,
} from "./repository";
export type TeamIntent = "create" | "reissue" | "cancel" | "role" | "revoke";
export type TeamResult = {
  status: "success" | "invalid" | TeamFailure;
  errors?: Record<string, string>;
  token?: string;
  invitation?: Invitation;
};
async function authenticated(
  client: SupabaseClient,
): Promise<"authenticated" | "auth-required" | "unavailable"> {
  try {
    const { data, error } = await client.auth.getUser();
    if (error)
      return authenticationRequired(error.status)
        ? "auth-required"
        : "unavailable";
    return data.user ? "authenticated" : "auth-required";
  } catch {
    return "unavailable";
  }
}
async function createInvitation(
  client: SupabaseClient,
  practiceId: string,
  raw: unknown,
): Promise<TeamResult> {
  const parsed = invitationInputSchema.safeParse(raw);
  if (!parsed.success)
    return { status: "invalid", errors: inputErrors(parsed.error) };
  const link = generateInvitation();
  const reply = await rpcBoundary(client, "create_practice_invitation", {
    p_practice_id: practiceId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_token_digest: link.digest,
  });
  return invitationReply(reply, link.token);
}
function invitationReply(
  reply: Awaited<ReturnType<typeof rpcBoundary>>,
  token?: string,
): TeamResult {
  if (reply.status !== "reply") return reply;
  const parsed = z
    .object({
      status: z.literal("success"),
      invitation: invitationRecordSchema,
    })
    .safeParse(reply.data);
  return parsed.success
    ? {
        status: "success",
        invitation: parsed.data.invitation,
        ...(token ? { token } : {}),
      }
    : { status: "unavailable" };
}
function mutationArgs(
  intent: Exclude<TeamIntent, "create">,
  input: { id: string; expectedVersion: number; role?: string },
  digest?: string,
) {
  if (intent === "role")
    return {
      p_membership_id: input.id,
      p_expected_version: input.expectedVersion,
      p_role: input.role,
    };
  const targetKey = intent === "revoke" ? "p_membership_id" : "p_invitation_id";
  return {
    [targetKey]: input.id,
    p_expected_version: input.expectedVersion,
    ...(digest ? { p_token_digest: digest } : {}),
  };
}
async function mutateAccess(
  client: SupabaseClient,
  intent: Exclude<TeamIntent, "create">,
  raw: unknown,
): Promise<TeamResult> {
  const parsed = (
    intent === "role" ? memberInputSchema : recordInputSchema
  ).safeParse(raw);
  if (!parsed.success)
    return { status: "invalid", errors: inputErrors(parsed.error) };
  const names = {
    reissue: "reissue_practice_invitation",
    cancel: "cancel_practice_invitation",
    role: "change_practice_member_role",
    revoke: "revoke_practice_member",
  };
  const link = intent === "reissue" ? generateInvitation() : undefined;
  const reply = await rpcBoundary(
    client,
    names[intent],
    mutationArgs(intent, parsed.data, link?.digest),
  );
  if (intent === "reissue" || intent === "cancel")
    return invitationReply(reply, link?.token);
  if (reply.status !== "reply") return reply;
  return z.object({ status: z.literal("success") }).safeParse(reply.data)
    .success
    ? { status: "success" }
    : { status: "unavailable" };
}
export async function manageTeam(
  client: SupabaseClient,
  intent: TeamIntent,
  raw: unknown,
): Promise<TeamResult> {
  const auth = await authenticated(client);
  if (auth !== "authenticated") return { status: auth };
  const access = await getPracticeAccess(client);
  if (access.status !== "success") return access;
  if (access.access?.role !== "administrator") return { status: "forbidden" };
  return intent === "create"
    ? createInvitation(client, access.access.practice.id, raw)
    : mutateAccess(client, intent, raw);
}
const joinSchema = z.strictObject({ token: z.string() });
const previewSchema = z.object({
  status: z.literal("success"),
  name: z.string(),
  role: roleSchema,
  expires_at: z.iso.datetime({ offset: true }),
});
const acceptedSchema = z.object({
  status: z.enum(["success", "already-member"]),
  practiceId: z.uuid(),
  role: roleSchema,
});
export type JoinResult =
  | { status: TeamFailure }
  | z.infer<typeof previewSchema>
  | z.infer<typeof acceptedSchema>;
export async function joinPractice(
  client: SupabaseClient,
  raw: unknown,
  accept: boolean,
): Promise<JoinResult> {
  const auth = await authenticated(client);
  if (auth !== "authenticated") return { status: auth };
  const parsed = joinSchema.safeParse(raw);
  const digest = parsed.success ? hashInvitationToken(parsed.data.token) : null;
  if (!digest) return { status: "invalid-invitation" };
  const reply = await rpcBoundary(
    client,
    accept ? "accept_practice_invitation" : "preview_practice_invitation",
    { p_token_digest: digest },
  );
  if (reply.status !== "reply") return reply;
  const result = (accept ? acceptedSchema : previewSchema).safeParse(
    reply.data,
  );
  return result.success ? result.data : { status: "unavailable" };
}
