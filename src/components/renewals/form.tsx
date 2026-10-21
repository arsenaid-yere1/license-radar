"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Field, errorAttributes } from "@/components/register/create-form";
import { RecordDates } from "@/components/register/record-dates";
import { CompletionFields } from "./completion-fields";
import { RenewalSummary } from "./summary";
import { progressLabels, type RenewalState } from "@/lib/renewals/state";
import { renewalMessage } from "@/lib/renewals/messages";
import type {
  RenewalAction,
  RenewalCredential,
  RenewalFormState,
} from "@/lib/renewals/schema";
export type RenewalIntent = "link" | "progress" | "review" | "complete";
export const formTitles = {
  link: "Edit renewal link",
  progress: "Change renewal progress",
  review: "Acknowledge review",
  complete: "Record confirmed renewal",
};
export function RenewalForm({
  record,
  intent,
  requestKey,
  action,
  onSaved,
  onCancel,
  onLock,
  onReload,
  today,
  timezone = "UTC",
}: {
  today?: string;
  timezone?: string;
  record: RenewalCredential;
  intent: RenewalIntent;
  requestKey: string;
  action: RenewalAction;
  onSaved: (state: RenewalFormState) => void;
  onCancel: () => void;
  onLock: (value: boolean) => void;
  onReload: (record: RenewalCredential) => void;
}) {
  const frozen = useRef<FormData | null>(null),
    feedback = useRef<HTMLParagraphElement>(null);
  const [state, submit, pending] = useActionState<RenewalFormState, FormData>(
    async (previous, form) => {
      const payload = frozen.current ?? form;
      frozen.current = payload;
      let next: RenewalFormState;
      try {
        next = await action(previous, payload);
      } catch {
        next = {
          status: "unavailable",
          message: renewalMessage("unavailable"),
        };
      }
      if (next.status !== "unavailable") frozen.current = null;
      if (next.status === "success") onSaved(next);
      return next;
    },
    { status: "idle" },
  );
  const uncertain = state.status === "unavailable",
    blocked = [
      "conflict",
      "request-conflict",
      "forbidden",
      "archived",
      "completed",
      "not-found",
    ].includes(state.status);
  useEffect(() => {
    onLock(pending || uncertain);
    return () => onLock(false);
  }, [pending, uncertain, onLock]);
  useEffect(() => {
    if (state.message) feedback.current?.focus();
  }, [state]);
  return (
    <section className="renewal-edit" aria-label={formTitles[intent]}>
      <h3>{formTitles[intent]}</h3>
      <form
        action={submit}
        onReset={(event) => event.preventDefault()}
        noValidate
      >
        <RenewalTokens
          record={record}
          intent={intent}
          requestKey={requestKey}
        />
        <fieldset disabled={pending || uncertain || blocked}>
          {intent === "complete" ? (
            <CompletionFields
              record={record}
              errors={state.errors}
              today={today}
              timezone={timezone}
            />
          ) : (
            <RenewalFields
              record={record}
              intent={intent}
              errors={state.errors}
            />
          )}
        </fieldset>
        <div className="renewal-buttons">
          <button disabled={pending || blocked}>
            {saveLabel(pending, uncertain, intent)}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={pending || uncertain}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
        {state.message && (
          <p className="error" ref={feedback} role="alert" tabIndex={-1}>
            {state.message}
          </p>
        )}
        <ConflictReview state={state} onReload={onReload} />
        {blocked && state.status !== "conflict" && (
          <a className="text-link" href={`/practice/register/${record.id}`}>
            Reload record
          </a>
        )}
      </form>
    </section>
  );
}
function RenewalTokens({
  record,
  intent,
  requestKey,
}: {
  record: RenewalCredential;
  intent: RenewalIntent;
  requestKey: string;
}) {
  const tokens = {
    intent,
    requestId: requestKey,
    id: record.id,
    expectedVersion: record.version,
    expectedCycleId: record.current_cycle.id,
    expectedDateRevision: record.current_cycle.date_revision,
    expectedRenewalVersion:
      intent === "link"
        ? record.renewal.link.version
        : record.renewal.workflow.version,
  };
  return Object.entries(tokens).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
}
function RenewalFields({
  record,
  intent,
  errors = {},
}: {
  record: RenewalCredential;
  intent: RenewalIntent;
  errors?: Record<string, string>;
}) {
  const [url, setUrl] = useState(record.renewal.link.url ?? ""),
    [progress, setProgress] = useState<RenewalState["workflow"]["status"]>(
      record.renewal.workflow.status,
    );
  if (intent === "review")
    return (
      <p>
        Acknowledgement does not complete this renewal or change its dates,
        progress or reminders. It records the first review of this cycle for
        your team.
      </p>
    );
  if (intent === "link")
    return (
      <Field
        id="renewal-url"
        label="Renewal link (optional)"
        error={errors.url}
      >
        <input
          id="renewal-url"
          type="url"
          name="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          {...errorAttributes("renewal-url", errors.url)}
        />
        <p className="hint">
          Use the issuer’s stable HTTPS renewal page. Leave blank to clear the
          saved link. Do not save one-time or password-reset links.
        </p>
      </Field>
    );
  return (
    <Field
      id="renewal-progress"
      label="Renewal progress"
      error={errors.progress}
    >
      <select
        id="renewal-progress"
        name="progress"
        value={progress}
        onChange={(e) =>
          setProgress(e.target.value as RenewalState["workflow"]["status"])
        }
        {...errorAttributes("renewal-progress", errors.progress)}
      >
        {Object.entries(progressLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <p className="hint">
        Progress helps your team coordinate. Entered dates and reminders
        continue to apply.
      </p>
    </Field>
  );
}
function saveLabel(
  pending: boolean,
  uncertain: boolean,
  intent: RenewalIntent,
) {
  if (pending) return "Saving…";
  if (uncertain) return "Retry this save";
  return intent === "complete"
    ? "Confirm renewal and new dates"
    : intent === "link"
      ? "Save renewal link"
      : intent === "review"
        ? "Confirm review"
        : "Save progress";
}
function ConflictReview({
  state,
  onReload,
}: {
  state: RenewalFormState;
  onReload: (record: RenewalCredential) => void;
}) {
  if (state.status !== "conflict" || !state.credential) return null;
  const saved = state.credential;
  return (
    <div className="renewal-conflict">
      <h4>Saved values for comparison</h4>
      <p>{saved.title}</p>
      <p>Saved renewal link: {saved.renewal.link.url ?? "None"}</p>
      <RenewalSummary renewal={saved.renewal} />
      <RecordDates record={saved} />
      <p>
        Reloading saved values discards your draft. Review them and reenter your
        intended change.
      </p>
      <button type="button" onClick={() => onReload(saved)}>
        Reload saved values
      </button>
    </div>
  );
}
