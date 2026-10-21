"use client";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { resultSchema } from "@/lib/evidence/schema";
import { evidenceMessage } from "@/lib/evidence/messages";
export function EvidenceUploadForm({
  endpoint,
  requestId,
  disabled,
  onLock,
  onSaved,
}: {
  endpoint: string;
  requestId: string;
  disabled: boolean;
  onLock: (v: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const frozen = useRef<FormData | null>(null),
    feedback = useRef<HTMLParagraphElement>(null);
  const [pending, setPending] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState<string>();
  useLayoutEffect(() => {
    if (message) feedback.current?.focus();
  }, [message]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = frozen.current ?? new FormData(event.currentTarget);
    frozen.current = data;
    setPending(true);
    onLock(true);
    setMessage(undefined);
    try {
      const response = await fetch(endpoint, { method: "POST", body: data }),
        parsed = resultSchema.safeParse(await response.json());
      if (
        !parsed.success ||
        response.status >= 500 ||
        parsed.data.status === "busy" ||
        parsed.data.status === "unavailable"
      )
        throw new Error("Uncertain upload");
      const result = parsed.data;
      if (result.status === "success" && result.state === "available") {
        onSaved(evidenceMessage("available"));
        return;
      }
      frozen.current = null;
      setUncertain(false);
      onLock(false);
      setMessage(
        evidenceMessage(
          result.status === "success" ? result.state : result.status,
        ),
      );
    } catch {
      setUncertain(true);
      setMessage(
        "We could not confirm this upload. Retry the same file before leaving this cycle.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={save}
      className="renewal-form"
      aria-label="Upload renewal evidence"
    >
      <input type="hidden" name="requestId" value={requestId} />
      <label>
        Evidence file
        <input
          type="file"
          name="file"
          accept=".pdf,.jpg,.jpeg,.png"
          required
          disabled={pending || uncertain || disabled}
        />
      </label>
      <p className="hint">
        PDF, JPEG or PNG up to 3 MiB. Evidence stays with this cycle and does
        not change renewal dates.
      </p>
      <button type="submit" disabled={pending || (disabled && !uncertain)}>
        {pending
          ? "Saving evidence…"
          : uncertain
            ? "Retry this upload"
            : "Upload evidence"}
      </button>
      {message && (
        <p ref={feedback} tabIndex={-1} role="alert">
          {message}
        </p>
      )}
    </form>
  );
}
