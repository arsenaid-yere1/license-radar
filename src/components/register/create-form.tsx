"use client";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { registerMessage } from "@/lib/register/messages";
import type { RegisterAction, RegisterState } from "@/lib/register/schema";
export function CreateForm({
  intent,
  requestKey,
  action,
  onSaved,
  children,
}: {
  intent: "clinician" | "credential";
  requestKey: string;
  action: RegisterAction;
  onSaved: (state: RegisterState) => void;
  children: (errors: Record<string, string>) => ReactNode;
}) {
  const [key, setKey] = useState(requestKey);
  const frozen = useRef<FormData | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const router = useRouter();
  const [state, submit, pending] = useActionState<RegisterState, FormData>(
    async (previous, form) => {
      const payload = frozen.current ?? form;
      frozen.current = payload;
      let next: RegisterState;
      try {
        next = await action(previous, payload);
      } catch {
        next = {
          status: "unavailable",
          message: registerMessage("unavailable"),
        };
      }
      if (next.status !== "unavailable") frozen.current = null;
      if (next.status === "success") {
        onSaved(next);
        setKey(crypto.randomUUID());
      }
      return next;
    },
    { status: "idle" },
  );
  useEffect(() => {
    if (state.message) feedback.current?.focus();
    if (state.status === "success") router.refresh();
  }, [state, router]);
  const uncertain = state.status === "unavailable";
  const blocked =
    state.status === "request-conflict" || state.status === "forbidden";
  const review = blocked || state.status === "invalid-reference";
  return (
    <form action={submit} onReset={(event) => event.preventDefault()}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="requestId" value={key} />
      <fieldset key={key} disabled={pending || uncertain || blocked}>
        {children(state.errors ?? {})}
      </fieldset>
      <button disabled={pending || blocked}>
        {saveLabel(pending, uncertain, intent)}
      </button>
      <CreateFeedback state={state} review={review} feedback={feedback} />
    </form>
  );
}
export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <p className="error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
export function errorAttributes(id: string, error?: string) {
  return {
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? `${id}-error` : undefined,
  };
}

function saveLabel(pending: boolean, uncertain: boolean, intent: string) {
  if (pending) return "Saving…";
  if (uncertain) return "Retry this save";
  return intent === "clinician" ? "Add clinician" : "Add record";
}
function CreateFeedback({
  state,
  review,
  feedback,
}: {
  state: RegisterState;
  review: boolean;
  feedback: React.RefObject<HTMLParagraphElement | null>;
}) {
  return (
    <>
      {state.message && (
        <p
          ref={feedback}
          tabIndex={-1}
          role={state.status === "success" ? "status" : "alert"}
          className={state.status === "success" ? "success" : "error"}
        >
          {state.message}
        </p>
      )}
      {review && (
        <a className="text-link" href="/practice/register">
          Reload register
        </a>
      )}
    </>
  );
}
