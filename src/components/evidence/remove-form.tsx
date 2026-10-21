"use client";
import { useLayoutEffect, useRef, useState } from "react";
import type { EvidenceFile } from "@/lib/evidence/schema";
import { resultSchema } from "@/lib/evidence/schema";
import { evidenceMessage } from "@/lib/evidence/messages";
export function EvidenceRemoveForm({
  file,
  endpoint,
  disabled,
  onLock,
  onSaved,
}: {
  file: EvidenceFile;
  endpoint: string;
  disabled: boolean;
  onLock: (v: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [pending, setPending] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState<string>();
  const frozen = useRef<string | null>(null),
    feedback = useRef<HTMLParagraphElement>(null),
    opener = useRef<HTMLButtonElement>(null),
    restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false;
      opener.current?.focus();
    }
  }, [open]);
  useLayoutEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);
  async function save() {
    if (!confirmed || pending) return;
    const body =
      frozen.current ??
      JSON.stringify({
        requestId: crypto.randomUUID(),
        expectedVersion: file.version,
        confirmed: true,
      });
    frozen.current = body;
    setPending(true);
    onLock(true);
    setMessage(undefined);
    try {
      const response = await fetch(endpoint, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body,
        }),
        parsed = resultSchema.safeParse(await response.json());
      if (
        !parsed.success ||
        response.status >= 500 ||
        parsed.data.status === "unavailable"
      )
        throw new Error("Uncertain removal");
      if (
        parsed.data.status === "success" &&
        parsed.data.evidenceId === file.id
      ) {
        onSaved(evidenceMessage(parsed.data.state));
        return;
      }
      frozen.current = null;
      setUncertain(false);
      onLock(false);
      setMessage(evidenceMessage(parsed.data.status));
    } catch {
      setUncertain(true);
      setMessage(
        "We could not confirm removal. Retry this removal before leaving this cycle.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="renewal-form">
      <button
        ref={opener}
        type="button"
        className="secondary"
        disabled={disabled || open}
        onClick={() => setOpen(true)}
      >
        Remove {file.filename}
      </button>
      {open && (
        <RemovalConfirmation
          name={file.filename}
          confirmed={confirmed}
          pending={pending}
          uncertain={uncertain}
          disabled={disabled}
          onConfirm={setConfirmed}
          onSave={save}
          onCancel={() => {
            restoreFocus.current = true;
            setOpen(false);
            setConfirmed(false);
            setMessage(undefined);
          }}
        />
      )}
      {message && (
        <p ref={feedback} tabIndex={-1} role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
function RemovalConfirmation({
  name,
  confirmed,
  pending,
  uncertain,
  disabled,
  onConfirm,
  onSave,
  onCancel,
}: {
  name: string | null;
  confirmed: boolean;
  pending: boolean;
  uncertain: boolean;
  disabled: boolean;
  onConfirm: (v: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="group" aria-label={`Remove ${name}`}>
      <p>
        Remove this attachment? The renewal cycle and its dates remain in
        history. File cleanup may need another attempt.
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={pending || uncertain}
          onChange={(e) => onConfirm(e.target.checked)}
        />
        I confirm removal of this evidence.
      </label>
      <div className="renewal-buttons">
        <button
          type="button"
          disabled={pending || !confirmed || (disabled && !uncertain)}
          onClick={onSave}
        >
          {pending
            ? "Removing evidence…"
            : uncertain
              ? "Retry this removal"
              : "Confirm removal"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={pending || uncertain}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
