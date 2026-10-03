"use client";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Practice } from "@/lib/practice/repository";
import { previewReminder, suggestedTimezone } from "@/lib/practice/timezones";
export type FormState = {
  status: string;
  revision?: number;
  values?: { name: string; timezone: string };
  message?: string;
  errors?: Record<string, string>;
  practice?: Practice;
};
export type PracticeFormProps = {
  practice?: Practice;
  timezones: string[];
  action: (state: FormState, data: FormData) => Promise<FormState>;
};
const subscribe = () => () => {};
function detectedZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
function NameField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div className="field">
      <label htmlFor="practice-name">Practice name</label>
      <input
        id="practice-name"
        name="name"
        autoComplete="organization"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "name-error" : "name-help"}
      />
      <p id="name-help" className="hint">
        The name your team recognizes. Up to 120 characters.
      </p>
      {error && (
        <p id="name-error" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
function ZoneField({
  value,
  onChange,
  error,
  timezones,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  timezones: string[];
}) {
  return (
    <div className="field">
      <label htmlFor="practice-timezone">Practice timezone</label>
      <select
        id="practice-timezone"
        name="timezone"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "timezone-error" : "timezone-help"}
      >
        {timezones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      <p id="timezone-help" className="hint">
        Future reminders will use this local time. You can change it anytime.
      </p>
      {error && (
        <p id="timezone-error" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
function ResultMessage({ state }: { state: FormState }) {
  const message = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.message) message.current?.focus();
  }, [state]);
  return (
    <>
      {state.message && (
        <p
          className={state.status === "success" ? "success" : "error"}
          role="status"
          tabIndex={-1}
          ref={message}
        >
          {state.message}
        </p>
      )}
      {state.status === "conflict" && (
        <a href="/practice" className="text-link">
          Reload current settings
        </a>
      )}
    </>
  );
}
function Submit({ pending, editing }: { pending: boolean; editing: boolean }) {
  return (
    <div className="form-footer">
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Create practice"}
        <span aria-hidden="true">↗</span>
      </button>
      <span className="hint">
        {editing
          ? "Saved to your practice"
          : "You’ll be the practice administrator"}
      </span>
    </div>
  );
}
function Version({
  practice,
  saved,
}: {
  practice?: Practice;
  saved?: Practice;
}) {
  return (
    practice && (
      <input
        type="hidden"
        name="expectedVersion"
        value={saved?.version ?? practice.version}
      />
    )
  );
}
function initialValues(state: FormState, practice?: Practice) {
  return {
    name: state.values?.name ?? practice?.name ?? "",
    timezone: state.values?.timezone ?? "",
  };
}
function PracticeFields({
  practice,
  timezones,
  state,
  ready,
}: {
  practice?: Practice;
  timezones: string[];
  state: FormState;
  ready: boolean;
}) {
  const suggestion = useSyncExternalStore(subscribe, detectedZone, () => "UTC");
  const initial = initialValues(state, practice);
  const [name, setName] = useState(initial.name);
  const [choice, setChoice] = useState(initial.timezone);
  const timezone =
    choice || practice?.timezone || suggestedTimezone(suggestion, timezones);
  return (
    <fieldset disabled={!ready}>
      <NameField value={name} onChange={setName} error={state.errors?.name} />
      <ZoneField
        value={timezone}
        onChange={setChoice}
        error={state.errors?.timezone}
        timezones={timezones}
      />
      <Version practice={practice} saved={state.practice} />
      <aside className="preview" aria-label="Reminder example">
        <span className="eyebrow">A look ahead</span>
        <p>{previewReminder(timezone)}</p>
      </aside>
    </fieldset>
  );
}
export function PracticeForm({
  practice,
  timezones,
  action,
}: PracticeFormProps) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (previous: FormState, data: FormData) => {
      const result = await action(previous, data);
      return {
        ...result,
        practice: result.practice ?? previous.practice,
        revision: (previous.revision ?? 0) + 1,
        values: {
          name: String(data.get("name") ?? ""),
          timezone: String(data.get("timezone") ?? "UTC"),
        },
      };
    },
    { status: "idle" },
  );
  return (
    <form
      action={formAction}
      onReset={(event) => event.preventDefault()}
      noValidate
      className="practice-form"
    >
      <PracticeFields
        key={state.revision ?? 0}
        practice={practice}
        timezones={timezones}
        state={state}
        ready={ready}
      />
      <ResultMessage state={state} />
      <Submit pending={pending || !ready} editing={Boolean(practice)} />
    </form>
  );
}
