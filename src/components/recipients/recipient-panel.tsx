"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { roleLabels } from "@/lib/team/schema";
import type {
  Recipient,
  RecipientAction,
  RecipientState,
} from "@/lib/recipients/schema";
export function RecipientPanel({
  recipient,
  action,
}: {
  recipient: Recipient;
  action: RecipientAction;
}) {
  return (
    <section className="panel">
      <h2>Reminder recipient</h2>
      <RecipientControl recipient={recipient} action={action} />
    </section>
  );
}
function RecipientControl({
  recipient,
  action,
}: {
  recipient: Recipient;
  action: RecipientAction;
}) {
  const [choice, setChoice] = useState(recipient.selected?.id ?? "");
  const [committed, setCommitted] = useState(recipient);
  const [source, setSource] = useState(recipient);
  if (recipient !== source) {
    setSource(recipient);
    if (recipient.version >= committed.version) {
      setCommitted(recipient);
      if (recipient.version > committed.version)
        setChoice(recipient.selected?.id ?? "");
    }
  }
  const router = useRouter();
  const [state, submit, pending] = useActionState<RecipientState, FormData>(
    async (previous, form) => {
      const next = await action(previous, form);
      if (next.status === "success" && next.recipient) {
        setCommitted(next.recipient);
        setChoice(next.recipient.selected?.id ?? "");
      }
      return next;
    },
    { status: "idle" },
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  const reloadRequired =
    state.status === "conflict" || state.status === "invalid-recipient";
  return (
    <>
      <RecipientSummary recipient={committed} />
      {committed.canEdit && (
        <RecipientForm
          committed={committed}
          submit={submit}
          choice={choice}
          setChoice={setChoice}
          pending={pending}
          reloadRequired={reloadRequired}
        />
      )}
      <RecipientFeedback state={state} reloadRequired={reloadRequired} />
    </>
  );
}

function RecipientSummary({ recipient }: { recipient: Recipient }) {
  return (
    <>
      <p>
        <strong>Current recipient: </strong>
        {recipient.selected
          ? `${recipient.selected.email} · ${roleLabels[recipient.selected.role]}`
          : "No reminder recipient selected"}
      </p>
      <p className="hint">
        {recipient.readiness === "no-recipient"
          ? "Choose who will be responsible for reminders."
          : recipient.readiness === "sms-setup-pending"
            ? "Recipient assigned. SMS setup pending."
            : "The selected member is unavailable. Choose another recipient."}{" "}
        Text reminders are not active yet.
      </p>
    </>
  );
}

function RecipientForm({
  committed,
  submit,
  choice,
  setChoice,
  pending,
  reloadRequired,
}: {
  committed: Extract<Recipient, { canEdit: true }>;
  submit: (form: FormData) => void;
  choice: string;
  setChoice: (value: string) => void;
  pending: boolean;
  reloadRequired: boolean;
}) {
  return (
    <form
      action={submit}
      onSubmit={(event) => {
        if (
          !choice &&
          !window.confirm(
            "Clear the reminder recipient? This practice will have no reminder recipient.",
          )
        )
          event.preventDefault();
      }}
      onReset={(event) => event.preventDefault()}
    >
      <input type="hidden" name="intent" value={choice ? "assign" : "clear"} />
      <input type="hidden" name="expectedVersion" value={committed.version} />
      {choice && <input type="hidden" name="membershipId" value={choice} />}
      <div className="field">
        <label htmlFor="reminder-recipient">Proposed reminder recipient</label>
        <select
          id="reminder-recipient"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          disabled={pending}
        >
          <option value="">No recipient (clear selection)</option>
          {committed.candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.email} · {roleLabels[candidate.role]}
            </option>
          ))}
        </select>
      </div>
      <button disabled={pending || reloadRequired}>
        {pending ? "Saving…" : choice ? "Save recipient" : "Clear recipient"}
      </button>
    </form>
  );
}

function RecipientFeedback({
  state,
  reloadRequired,
}: {
  state: RecipientState;
  reloadRequired: boolean;
}) {
  const message = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.message) message.current?.focus();
  }, [state]);
  return (
    <>
      {state.message && (
        <p
          ref={message}
          tabIndex={-1}
          role={state.status === "success" ? "status" : "alert"}
          className={state.status === "success" ? "success" : "error"}
        >
          {state.message}
        </p>
      )}
      {reloadRequired && (
        <a href="/practice" className="text-link">
          Reload recipient
        </a>
      )}
    </>
  );
}
