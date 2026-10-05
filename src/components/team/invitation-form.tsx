"use client";
import type { TeamResult } from "@/lib/team/operations";
import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ResultMessage } from "./result-message";
import { InvitationLink } from "./invitation-link";
export type TeamState = Omit<TeamResult, "status"> & {
  status: TeamResult["status"] | "idle";
  message?: string;
};
export type TeamAction = (
  state: TeamState,
  data: FormData,
) => Promise<TeamState>;
function CreatedInvitation({ state }: { state: TeamState }) {
  return state.token && state.invitation ? (
    <InvitationLink
      token={state.token}
      expiresAt={state.invitation.expires_at}
    />
  ) : null;
}
export function InvitationForm({ action }: { action: TeamAction }) {
  const [state, submit, pending] = useActionState(action, { status: "idle" });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("manager");
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  return (
    <form
      action={submit}
      onReset={(event) => event.preventDefault()}
      noValidate
    >
      <input type="hidden" name="intent" value="create" />
      <div className="field">
        <label htmlFor="staff-email">Staff email</label>
        <input
          id="staff-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={Boolean(state.errors?.email)}
          aria-describedby={
            state.errors?.email ? "staff-email-error" : "staff-email-help"
          }
        />
        <p id="staff-email-help" className="hint">
          They’ll verify this email before joining.
        </p>
        {state.errors?.email && (
          <p id="staff-email-error" className="error">
            {state.errors.email}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="invitation-role">Invitation role</label>
        <select
          id="invitation-role"
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="administrator">Practice administrator</option>
          <option value="manager">Office manager</option>
          <option value="viewer">Viewer</option>
        </select>
        {state.errors?.role && <p className="error">{state.errors.role}</p>}
      </div>
      <ResultMessage state={state} />
      <button disabled={pending}>
        {pending ? "Creating…" : "Create invitation link"}
      </button>
      <CreatedInvitation state={state} />
      <p className="hint">
        Links expire after seven days. Share the link through your chosen
        channel.
      </p>
    </form>
  );
}
