"use client";
import { useActionState, useEffect, useRef } from "react";
import { loginAction } from "@/app/login/actions";
export function EmailCodeForm({
  destination = "/",
}: {
  destination?: "/" | "/join";
}) {
  const [state, action, pending] = useActionState(loginAction, {
    status: "idle",
  });
  const message = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.message) message.current?.focus();
  }, [state]);
  return (
    <form action={action} className="login-form" noValidate>
      <input type="hidden" name="destination" value={destination} />
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          required
        />
      </div>
      {state.status === "sent" && (
        <div className="field">
          <label htmlFor="token">Six-digit code</label>
          <input
            id="token"
            name="token"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            placeholder="000000"
          />
        </div>
      )}
      {state.message && (
        <p role="status" ref={message} tabIndex={-1} className="hint">
          {state.message}
        </p>
      )}
      <button
        disabled={pending}
        name="intent"
        value={state.status === "sent" ? "verify" : "request"}
      >
        {pending
          ? "Working…"
          : state.status === "sent"
            ? "Verify code"
            : "Send sign-in code"}
        <span aria-hidden="true">↗</span>
      </button>
      {state.status === "sent" && (
        <button
          disabled={pending}
          name="intent"
          value="request"
          className="secondary"
        >
          Send a new code
        </button>
      )}
      <p className="hint">A code connects you securely to your practice.</p>
    </form>
  );
}
