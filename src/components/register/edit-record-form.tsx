"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { CredentialFields } from "./credential-fields";
import { maintenanceMessage } from "@/lib/register/messages";
import { typeLabels } from "@/lib/register/schema";
import type {
  Clinician,
  MaintenanceAction,
  MaintenanceCredential,
  MaintenanceState,
} from "@/lib/register/schema";
import { RecordDates } from "./register-panel";
export type RecordFormProps = {
  record: MaintenanceCredential;
  clinicians: Clinician[];
  action: MaintenanceAction;
  onSaved: (state: MaintenanceState) => void;
  onCancel: () => void;
  onLock: (locked: boolean) => void;
};
export function EditRecordForm(props: RecordFormProps) {
  return <RecordChangeForm {...props} intent="update" />;
}
export function RecordChangeForm(
  props: RecordFormProps & { intent: "update" | "archive" },
) {
  const [baseline, setBaseline] = useState(props.record);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  return (
    <section
      className="panel"
      aria-label={`${props.intent === "update" ? "Edit" : "Archive"} ${props.record.title}`}
    >
      <h4>{props.intent === "update" ? "Edit record" : "Archive record"}</h4>
      <ChangeForm
        {...props}
        key={requestKey}
        record={baseline}
        requestKey={requestKey}
        onReload={(current) => {
          setBaseline(current);
          setRequestKey(crypto.randomUUID());
        }}
      />
    </section>
  );
}
function ChangeForm({
  record,
  clinicians,
  action,
  intent,
  onSaved,
  onCancel,
  onLock,
  requestKey,
  onReload,
}: RecordFormProps & {
  intent: "update" | "archive";
  requestKey: string;
  onReload: (record: MaintenanceCredential) => void;
}) {
  const frozen = useRef<FormData | null>(null),
    feedback = useRef<HTMLParagraphElement>(null);
  const [state, submit, pending] = useActionState<MaintenanceState, FormData>(
    async (previous, form) => {
      const payload = frozen.current ?? form;
      frozen.current = payload;
      let next: MaintenanceState;
      try {
        next = await action(previous, payload);
      } catch {
        next = {
          status: "unavailable",
          message: maintenanceMessage("unavailable"),
        };
      }
      if (next.status !== "unavailable") frozen.current = null;
      if (next.status === "success") onSaved(next);
      return next;
    },
    { status: "idle" },
  );
  const uncertain = state.status === "unavailable";
  const blocked = [
    "conflict",
    "request-conflict",
    "archived",
    "not-found",
    "forbidden",
  ].includes(state.status);
  useEffect(() => {
    onLock(pending || uncertain);
    return () => onLock(false);
  }, [pending, uncertain, onLock]);
  useEffect(() => {
    if (state.message) feedback.current?.focus();
  }, [state]);
  return (
    <form action={submit} onReset={(event) => event.preventDefault()}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="requestId" value={requestKey} />
      <input type="hidden" name="id" value={record.id} />
      <input type="hidden" name="expectedVersion" value={record.version} />
      <input
        type="hidden"
        name="expectedCycleId"
        value={record.current_cycle.id}
      />
      <input
        type="hidden"
        name="expectedDateRevision"
        value={record.current_cycle.date_revision}
      />
      <fieldset disabled={pending || uncertain || blocked}>
        {intent === "update" ? (
          <CredentialFields
            record={record}
            clinicians={clinicians}
            errors={state.errors ?? {}}
          />
        ) : (
          <p>
            Archive “{record.title}”? It will leave active tracking. Its record,
            dates, and history will be retained.
          </p>
        )}
      </fieldset>
      <button disabled={pending || blocked}>
        {changeLabel(pending, uncertain, intent)}
      </button>
      <button type="button" disabled={pending || uncertain} onClick={onCancel}>
        Cancel
      </button>
      {state.message && (
        <p ref={feedback} role="alert" tabIndex={-1} className="error">
          {state.message}
        </p>
      )}
      <ConflictReview state={state} onReload={onReload} />
    </form>
  );
}

function changeLabel(pending: boolean, uncertain: boolean, intent: string) {
  if (pending) return "Saving…";
  if (uncertain) return "Retry this save";
  return intent === "update" ? "Save changes" : "Confirm archive";
}
function ConflictReview({
  state,
  onReload,
}: {
  state: MaintenanceState;
  onReload: (record: MaintenanceCredential) => void;
}) {
  return (
    <>
      {" "}
      {state.status === "conflict" && state.credential && (
        <div className="panel">
          <h4>Saved values for comparison</h4>
          <p>{state.credential.title}</p>
          <p>
            {typeLabels[state.credential.type]} · Owner:{" "}
            {state.credential.owner_name}
          </p>
          <p>
            Covers:{" "}
            {state.credential.covered_clinicians
              .map((person) => person.name)
              .join(", ") || "None"}
          </p>
          <RecordDates record={state.credential} />
          <p>
            Reloading saved values discards your draft. Review them and reenter
            your intended changes.
          </p>
          <button type="button" onClick={() => onReload(state.credential!)}>
            Reload saved values
          </button>
        </div>
      )}
    </>
  );
}
