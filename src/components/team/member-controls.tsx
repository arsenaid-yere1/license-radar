"use client";
import type { TeamAction } from "./invitation-form";
import type { Team } from "@/lib/team/repository";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ResultMessage } from "./result-message";
type Member = Team["members"][number];
function RoleControl({
  member,
  action,
}: {
  member: Member;
  action: TeamAction;
}) {
  const [state, submit, pending] = useActionState(action, { status: "idle" });
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  return (
    <form
      action={submit}
      onSubmit={(event) => {
        const role = new FormData(event.currentTarget).get("role");
        if (
          member.role === "administrator" &&
          role !== "administrator" &&
          !window.confirm("Remove this person's administrator role?")
        )
          event.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="role" />
      <input type="hidden" name="id" value={member.id} />
      <input type="hidden" name="expectedVersion" value={member.version} />
      <label htmlFor={`role-${member.id}`}>Role for {member.email}</label>
      <select id={`role-${member.id}`} name="role" defaultValue={member.role}>
        <option value="administrator">Practice administrator</option>
        <option value="manager">Office manager</option>
        <option value="viewer">Viewer</option>
      </select>
      <button disabled={pending} className="secondary">
        {pending ? "Saving…" : "Save role"}
      </button>
      <ResultMessage state={state} />
    </form>
  );
}
function RevokeControl({
  member,
  action,
}: {
  member: Member;
  action: TeamAction;
}) {
  const [state, submit, pending] = useActionState(action, { status: "idle" });
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  return (
    <form
      action={submit}
      onSubmit={(event) => {
        if (!window.confirm("Revoke this person's practice access?"))
          event.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="revoke" />
      <input type="hidden" name="id" value={member.id} />
      <input type="hidden" name="expectedVersion" value={member.version} />
      <button disabled={pending} className="secondary">
        {pending ? "Revoking…" : "Revoke access"}
      </button>
      <ResultMessage state={state} />
    </form>
  );
}
export function MemberControls({
  member,
  action,
  recipient = false,
}: {
  recipient?: boolean;
  member: Member;
  action: TeamAction;
}) {
  return member.state === "active" ? (
    <div className="member-controls">
      {recipient && (
        <p className="hint">
          This person is the reminder recipient. Revoking access or changing
          their role to Viewer will clear the assignment.
        </p>
      )}
      <RoleControl member={member} action={action} />
      <RevokeControl member={member} action={action} />
    </div>
  ) : (
    <p className="hint">
      Access revoked. Create a new invitation to grant access again.
    </p>
  );
}
