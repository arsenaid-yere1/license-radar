"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EvidencePage, EvidenceFile } from "@/lib/evidence/schema";
import { evidenceMessage } from "@/lib/evidence/messages";
import { formatCredentialDate, cycleEndLabel } from "@/lib/register/dates";
import { Shell } from "@/components/shell";
import { EvidenceUploadForm } from "./upload-form";
import { EvidenceRemoveForm } from "./remove-form";
type Actions = {
  endpoint: string;
  disabled: boolean;
  canUpload: boolean;
  canRemove: boolean;
  readKey: string;
  onLock: (v: boolean) => void;
  onSaved: (message: string) => void;
  onResume: (id: string | null) => void;
};
export function EvidencePanel({
  page,
  canEdit,
  configured,
  readKey,
  requestId,
  timezone,
  action,
}: {
  page: EvidencePage;
  canEdit: boolean;
  configured: boolean;
  readKey: string;
  requestId: string;
  timezone: string;
  action?: ReactNode;
}) {
  const router = useRouter(),
    feedback = useRef<HTMLParagraphElement>(null),
    [locked, setLocked] = useState(false),
    [notice, setNotice] = useState<string>(),
    [refreshing, setRefreshing] = useState<string | null>(null),
    [resume, setResume] = useState<string | null>(null);
  const onLock = useCallback((v: boolean) => setLocked(v), []),
    disabled = locked || refreshing === readKey,
    endpoint = `/api/renewal-evidence/${page.credentialId}/${page.cycleId}`;
  const canRemove = canEdit && configured,
    canUpload = canRemove && !page.archivedAt;
  useEffect(() => {
    if (notice) feedback.current?.focus();
  }, [notice]);
  function saved(message: string) {
    setLocked(false);
    setRefreshing(readKey);
    setNotice(message);
    setResume(null);
    router.refresh();
  }
  const actions = {
    endpoint,
    disabled,
    canRemove,
    canUpload,
    readKey,
    onLock,
    onSaved: saved,
    onResume: setResume,
  };
  return (
    <Shell
      navigationLocked={disabled}
      action={
        disabled ? (
          <span className="header-note">Finish or retry this request.</span>
        ) : (
          action
        )
      }
    >
      <div className="calendar-heading">
        <EvidenceHeading page={page} timezone={timezone} />
        {!disabled && <EvidenceNavigation page={page} />}
        <section
          className="panel evidence-panel"
          aria-label="Evidence attachments"
        >
          {!configured && (
            <p role="status">
              Evidence file storage is unavailable. Saved evidence history
              remains visible.
            </p>
          )}
          {notice && (
            <p ref={feedback} tabIndex={-1} role="status" className="success">
              {notice}
            </p>
          )}
          {refreshing === readKey && (
            <p className="hint">
              Refreshing saved evidence before another change…
            </p>
          )}
          <EvidenceList
            page={page}
            timezone={timezone}
            configured={configured}
            actions={actions}
          />
          <EvidenceUploader
            actions={actions}
            requestId={requestId}
            resume={resume}
          />
        </section>
      </div>
    </Shell>
  );
}
function EvidenceUploader({
  actions,
  requestId,
  resume,
}: {
  actions: Actions;
  requestId: string;
  resume: string | null;
}) {
  if (!actions.canUpload) return null;
  const key = resume ?? requestId;
  return (
    <EvidenceUploadForm
      key={`${actions.readKey}-${key}`}
      endpoint={actions.endpoint}
      requestId={key}
      disabled={actions.disabled}
      onLock={actions.onLock}
      onSaved={actions.onSaved}
    />
  );
}
function EvidenceHeading({
  page,
  timezone,
}: {
  page: EvidencePage;
  timezone: string;
}) {
  return (
    <>
      <span className="eyebrow">Renewal evidence</span>
      <h1>{page.title}</h1>
      <p>
        Cycle {page.cycle.cycleNumber} ·{" "}
        {page.current ? "Current cycle" : "Historical cycle"}
        {page.archivedAt ? " · Archived record" : ""}
      </p>
      <p className="hint">
        {cycleEndLabel(page.cycle.type)}:{" "}
        {page.cycle.endDate
          ? formatCredentialDate(page.cycle.endDate)
          : "Not entered"}{" "}
        · Practice timezone: {timezone}
      </p>
    </>
  );
}
function EvidenceNavigation({ page }: { page: EvidencePage }) {
  return (
    <nav className="renewal-navigation" aria-label="Evidence navigation">
      <Link href={`/practice/register/${page.credentialId}/history`}>
        Renewal history
      </Link>
      {!page.archivedAt && (
        <Link href={`/practice/register/${page.credentialId}`}>
          Current record
        </Link>
      )}
      <Link
        href={
          page.archivedAt
            ? "/practice/register?view=archived"
            : "/practice/register"
        }
      >
        Back to register
      </Link>
    </nav>
  );
}
function EvidenceList({
  page,
  timezone,
  configured,
  actions,
}: {
  page: EvidencePage;
  timezone: string;
  configured: boolean;
  actions: Actions;
}) {
  return (
    <>
      <ul className="register-list">
        {page.files.map((file) => (
          <EvidenceRow
            key={file.id}
            file={file}
            timezone={timezone}
            configured={configured}
            actions={actions}
          />
        ))}
      </ul>
      {!page.files.length && <p>No evidence attached to this cycle.</p>}
      {page.notices.map((file) => (
        <p key={file.id} className="hint">
          {file.filename ?? "Removed attachment"}: {evidenceMessage(file.state)}
        </p>
      ))}
    </>
  );
}
function EvidenceRow({
  file,
  timezone,
  configured,
  actions,
}: {
  file: EvidenceFile;
  timezone: string;
  configured: boolean;
  actions: Actions;
}) {
  return (
    <li>
      <article>
        <h2 className="evidence-filename">{file.filename}</h2>
        <p>
          {file.mime} · {Math.ceil(file.byteCount / 1024)} KiB ·{" "}
          {file.state === "available" ? "Available" : "Upload not confirmed"}
        </p>
        <p className="hint">
          Recorded{" "}
          {new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(file.createdAt))}
        </p>
        <EvidenceFileActions
          file={file}
          configured={configured}
          actions={actions}
        />
      </article>
    </li>
  );
}
function EvidenceFileActions({
  file,
  configured,
  actions,
}: {
  file: EvidenceFile;
  configured: boolean;
  actions: Actions;
}) {
  return (
    <>
      {file.state === "available" && configured && (
        <a className="text-link" href={`${actions.endpoint}/${file.id}`}>
          Download {file.filename}
        </a>
      )}
      {file.state === "pending" && file.requestId && actions.canUpload && (
        <button
          type="button"
          className="secondary"
          disabled={actions.disabled}
          onClick={() => actions.onResume(file.requestId)}
        >
          Resume upload for {file.filename}
        </button>
      )}
      {actions.canRemove && (
        <EvidenceRemoveForm
          key={`${actions.readKey}-${file.id}`}
          file={file}
          endpoint={`${actions.endpoint}/${file.id}`}
          disabled={actions.disabled}
          onLock={actions.onLock}
          onSaved={actions.onSaved}
        />
      )}
    </>
  );
}
