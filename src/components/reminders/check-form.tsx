"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReminderCheckState } from "@/lib/reminders/history";
export type CheckState = (
  ReminderCheckState | { status: "idle" | "auth-required" }
) & { message?: string };
const messages: Record<Exclude<CheckState["status"], "idle">, string> = {
  queued:
    "Delivery check queued. Refreshing the recorded status. A check may take a few minutes.",
  complete: "Delivery evidence is final. Another check is not available.",
  "not-found":
    "This message is unavailable. Reload to review the current delivery history.",
  invalid:
    "The delivery check could not be requested. Reload to review the current message.",
  conflict:
    "This message changed. Reload its current status before requesting a check.",
  "unknown-id":
    "The provider has not confirmed this message's identity. Contact your practice administrator for review.",
  exhausted:
    "This message has reached its delivery check limit. Contact your practice administrator for review.",
  cooldown:
    "A delivery check was recently requested. Reload to see when another check becomes available.",
  "request-conflict":
    "This delivery check request changed. Reload to review the current status.",
  forbidden:
    "Only a current practice manager or administrator can request a delivery check.",
  unavailable:
    "We could not confirm whether the delivery check was queued. Reload before trying again.",
  "auth-required":
    "Sign in again to review this message and request a delivery check.",
};
function useRequestId() {
  const [id, setId] = useState("");
  useEffect(() => {
    let mounted = true;
    // Generate once after mounting, keeping server rendering free of random IDs.
    void Promise.resolve().then(() => {
      if (mounted) setId(crypto.randomUUID());
    });
    return () => {
      mounted = false;
    };
  }, []);
  return id;
}
export function EmailCheckForm({
  attemptId,
  version,
  canCheck,
  action,
}: {
  attemptId: string;
  version: number;
  canCheck: boolean;
  action: (state: CheckState, form: FormData) => Promise<CheckState>;
}) {
  const { refresh } = useRouter();
  const feedback = useRef<HTMLParagraphElement>(null);
  const submitted = useRef(false);
  const requestId = useRequestId();
  const [state, submit, pending] = useActionState<CheckState, FormData>(
    async (previous, data) => {
      if (submitted.current || !canCheck || !data.get("requestId"))
        return previous;
      submitted.current = true;
      try {
        return await action(previous, data);
      } catch {
        return { status: "unavailable" };
      }
    },
    { status: "idle" },
  );
  useEffect(() => {
    if (state.status === "queued") refresh();
    if (state.status !== "idle") feedback.current?.focus();
  }, [state, refresh]);
  const message = state.status === "idle" ? null : messages[state.status];
  const disabled =
    !requestId || !canCheck || pending || state.status !== "idle";
  return (
    <section className="panel">
      <h2>Delivery status</h2>
      <p className="hint">
        A delivery check asks the email provider for this message&apos;s
        recorded status.
      </p>
      {canCheck && (
        <form
          action={submit}
          onSubmit={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="attemptId" value={attemptId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <button type="submit" disabled={disabled}>
            {pending ? "Checking…" : "Check delivery status"}
          </button>
        </form>
      )}
      {message && (
        <p role="status" tabIndex={-1} ref={feedback}>
          {message}
        </p>
      )}
      {state.status !== "idle" && state.status !== "queued" && (
        // A document reload resets the consumed request and reads current authority.
        <a className="text-link" href={window.location.href}>
          Reload delivery status
        </a>
      )}
    </section>
  );
}
