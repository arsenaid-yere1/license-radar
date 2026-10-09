"use client";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Preference, PreferenceState } from "@/lib/reminders/schema";
export function EmailPreferenceForm({
  preference,
  action,
}: {
  preference: Preference;
  action: (state: PreferenceState, form: FormData) => Promise<PreferenceState>;
}) {
  const router = useRouter(),
    feedback = useRef<HTMLParagraphElement>(null);
  const [state, submit, pending] = useActionState<PreferenceState, FormData>(
    async (previous, form) => {
      form.set("requestId", crypto.randomUUID());
      try {
        return await action(previous, form);
      } catch {
        return {
          status: "unavailable",
          message:
            "We could not confirm this change. Reload before trying again.",
        };
      }
    },
    { status: "idle" },
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
    if (state.message) feedback.current?.focus();
  }, [state, router]);
  const current = currentPreference(preference, state.preference);
  return (
    <section className="panel">
      <h2>My reminder emails</h2>
      <p>
        {current.enabled
          ? "Email reminders enabled for this practice."
          : "Email reminders disabled for this practice."}{" "}
        You receive reminders only while selected as the responsible recipient.
      </p>
      <p className="hint">
        This preference changes renewal emails. Your sign-in emails, assignment
        and text consent stay separate. Re-enabling after a scheduled target
        needs future catch-up support.
      </p>
      {(current.enabled || current.canEnable) && (
        <form action={submit}>
          <input
            type="hidden"
            name="enabled"
            value={String(!current.enabled)}
          />
          <input type="hidden" name="expectedVersion" value={current.version} />
          <button
            disabled={pending || !["idle", "success"].includes(state.status)}
          >
            {pending
              ? "Saving…"
              : current.enabled
                ? "Disable my reminder emails"
                : "Enable my reminder emails"}
          </button>
        </form>
      )}
      {state.message && (
        <p
          role={state.status === "success" ? "status" : "alert"}
          ref={feedback}
          tabIndex={-1}
        >
          {state.message}
        </p>
      )}
      <a className="text-link" href="/practice/reminders">
        Reload reminders
      </a>
    </section>
  );
}

function currentPreference(server: Preference, saved?: Preference) {
  return saved && saved.version > server.version ? saved : server;
}
