"use server";
import type { TeamState } from "@/components/team/invitation-form";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { manageTeam, type TeamIntent } from "@/lib/team/operations";
import {
  accessMessage,
  formInput,
  unavailableMessage,
} from "@/lib/team/messages";
import {
  inputErrors,
  invitationInputSchema,
  memberInputSchema,
  recordInputSchema,
} from "@/lib/team/schema";
function parsedInput(intent: TeamIntent, form: FormData) {
  const schema =
    intent === "create"
      ? invitationInputSchema
      : intent === "role"
        ? memberInputSchema
        : recordInputSchema;
  return schema.safeParse(formInput(form));
}
export async function teamAction(
  _state: TeamState,
  form: FormData,
): Promise<TeamState> {
  const intent = form.get("intent");
  if (
    typeof intent !== "string" ||
    !["create", "reissue", "cancel", "role", "revoke"].includes(intent)
  )
    return {
      status: "invalid",
      message: accessMessage("invalid"),
      errors: { form: "Choose a valid action." },
    };
  const parsed = parsedInput(intent as TeamIntent, form);
  if (!parsed.success)
    return {
      status: "invalid",
      message: accessMessage("invalid"),
      errors: inputErrors(parsed.error),
    };
  let result;
  try {
    result = await manageTeam(
      await createClient(),
      intent as TeamIntent,
      parsed.data,
    );
  } catch {
    return { status: "unavailable", message: unavailableMessage };
  }
  if (result.status === "auth-required") redirect("/login");
  const success = {
    create: "Invitation link created.",
    reissue: "Invitation link created.",
    cancel: "Invitation canceled.",
    role: "Role updated.",
    revoke: "Access revoked.",
  };
  return {
    ...result,
    message:
      result.status === "success"
        ? success[intent as TeamIntent]
        : accessMessage(result.status),
  };
}
