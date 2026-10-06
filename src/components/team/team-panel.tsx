"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Team, Invitation } from "@/lib/team/repository";
import { roleLabels } from "@/lib/team/schema";
import { InvitationForm, type TeamAction } from "./invitation-form";
import { MemberControls } from "./member-controls";
import { InvitationLink } from "./invitation-link";
import { ResultMessage } from "./result-message";
function PendingInvitation({
  invitation,
  action,
}: {
  invitation: Invitation;
  action: TeamAction;
}) {
  const [state, submit, pending] = useActionState(action, { status: "idle" });
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  const current = state.invitation ?? invitation;
  return (
    <div className="team-row">
      <h3>{current.email}</h3>
      <p className="hint">
        {roleLabels[current.role]} · {current.state} · Expires{" "}
        {new Date(current.expires_at).toUTCString()}
      </p>
      {current.state === "pending" && (
        <form action={submit}>
          <input type="hidden" name="id" value={current.id} />
          <input type="hidden" name="expectedVersion" value={current.version} />
          <div className="team-buttons">
            <button
              disabled={pending}
              name="intent"
              value="reissue"
              className="secondary"
            >
              Reissue link
            </button>
            <button
              disabled={pending}
              name="intent"
              value="cancel"
              className="secondary"
            >
              Cancel invitation
            </button>
          </div>
        </form>
      )}
      <ResultMessage state={state} />
      {state.token && state.invitation && (
        <InvitationLink
          token={state.token}
          expiresAt={state.invitation.expires_at}
        />
      )}
    </div>
  );
}
export function TeamPanel({
  team,
  action,
  recipientId,
}: {
  recipientId?: string;
  team: Team;
  action: TeamAction;
}) {
  return (
    <div className="team-layout">
      <section className="panel">
        <h2>Invite a staff member</h2>
        <InvitationForm action={action} />
      </section>
      <section className="panel">
        <h2>Practice team</h2>
        {team.members.map((member) => (
          <article className="team-row" key={`${member.id}-${member.version}`}>
            <h3>{member.email}</h3>
            <p className="hint">
              {roleLabels[member.role]} · {member.state}
            </p>
            <MemberControls
              member={member}
              action={action}
              recipient={member.id === recipientId}
            />
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Invitations</h2>
        {team.invitations.length ? (
          team.invitations.map((invitation) => (
            <PendingInvitation
              key={invitation.id}
              invitation={invitation}
              action={action}
            />
          ))
        ) : (
          <p>No invitations yet.</p>
        )}
      </section>
    </div>
  );
}
