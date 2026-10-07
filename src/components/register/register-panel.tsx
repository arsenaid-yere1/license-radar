"use client";
import { RecordDates } from "./record-dates";
import type { Credential } from "@/lib/register/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditRecordForm } from "./edit-record-form";
import { ArchiveRecordForm } from "./archive-record-form";
import { ClinicianForm } from "./clinician-form";
import { CredentialForm } from "./credential-form";
import {
  type MaintenanceAction,
  type MaintenanceCredential,
  type MaintenanceState,
  typeLabels,
  type Register,
  type RegisterAction,
  type RegisterState,
} from "@/lib/register/schema";
export function RegisterPanel({
  register,
  canEdit,
  action,
  clinicianKey,
  credentialKey,
  maintenanceAction,
  readKey,
  archivedView = false,
}: {
  register: Register;
  canEdit: boolean;
  action: RegisterAction;
  clinicianKey: string;
  credentialKey: string;
  maintenanceAction?: MaintenanceAction;
  readKey?: string;
  archivedView?: boolean;
}) {
  const router = useRouter();
  const [locked, setLocked] = useState(false),
    [awaitingRead, setAwaitingRead] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message?: string }>();
  const [editing, setEditing] = useState<{
    record: MaintenanceCredential;
    intent: "update" | "archive";
  } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null),
    feedback = useRef<HTMLParagraphElement | null>(null);
  const onLock = useCallback((value: boolean) => setLocked(value), []);
  const [saved, setSaved] = useState<Register>({
    clinicians: [],
    credentials: [],
  });
  const clinicians = merge(register.clinicians, saved.clinicians),
    allCredentials = merge(
      register.credentials,
      retainCredentialReplies(
        saved.credentials,
        register.credentials,
        awaitingRead,
        readKey,
      ),
    ) as (Credential & {
      archived_at?: string | null;
      suspected_duplicate_ids?: string[];
    })[],
    credentials = allCredentials.filter(
      (record) => Boolean(record.archived_at) === archivedView,
    );
  const refreshing = awaitingRead !== null && awaitingRead === readKey;
  useEffect(() => {
    if (!editing) opener.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (notice) feedback.current?.focus();
  }, [notice]);
  function close() {
    setEditing(null);
  }
  function onChanged(state: MaintenanceState) {
    if (state.credential)
      setSaved((previous) => ({
        ...previous,
        credentials: merge(previous.credentials, [state.credential!]),
      }));
    setNotice({ message: state.message });
    setEditing(null);
    setAwaitingRead(readKey ?? null);
    router.refresh();
  }
  function onSaved(state: RegisterState) {
    if (maintenanceAction) setAwaitingRead(readKey ?? null);
    setSaved((previous) => ({
      clinicians: state.clinician
        ? merge(previous.clinicians, [state.clinician])
        : previous.clinicians,
      credentials: state.credential
        ? merge(previous.credentials, [state.credential])
        : previous.credentials,
    }));
  }
  return (
    <>
      <RegisterFeedback
        locked={locked}
        notice={notice}
        refreshing={refreshing}
        feedback={feedback}
      />{" "}
      <p className="hint">Text reminders are not active yet.</p>
      {!canEdit && <p>You have read-only access to this register.</p>}
      <div className="register-layout">
        {canEdit && !archivedView && (
          <>
            <ClinicianForm
              action={action}
              requestKey={clinicianKey}
              onSaved={onSaved}
            />
            <CredentialForm
              action={action}
              requestKey={credentialKey}
              onSaved={onSaved}
              clinicians={clinicians}
            />
          </>
        )}
        <section className="panel">
          <h2>Clinicians</h2>
          {clinicians.length ? (
            <ul className="register-list" aria-label="Saved clinicians">
              {clinicians.map((clinician) => (
                <li key={clinician.id}>
                  {clinician.name}{" "}
                  <span className="hint">· {clinician.id.slice(-6)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No clinicians added yet.</p>
          )}
        </section>
        <section className="panel">
          <h2>{archivedView ? "Archived records" : "Renewal records"}</h2>
          {credentials.length ? (
            <ul className="register-list" aria-label="Saved records">
              {credentials.map((record) => (
                <RecordItem
                  key={record.id}
                  record={record}
                  canEdit={canEdit}
                  maintenanceAction={maintenanceAction}
                  register={register}
                  editing={editing}
                  locked={locked}
                  refreshing={refreshing}
                  clinicians={clinicians}
                  onChanged={onChanged}
                  close={close}
                  onLock={onLock}
                  open={(record, intent, button) => {
                    opener.current = button;
                    setEditing({ record, intent });
                  }}
                  active={allCredentials}
                  archivedView={archivedView}
                />
              ))}
            </ul>
          ) : (
            <p>
              {archivedView
                ? "No archived records."
                : "No renewal records added yet."}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
function merge<T extends { id: string; version: number }>(
  current: T[],
  saved: T[],
): T[] {
  const merged = new Map(current.map((value) => [value.id, value]));
  for (const value of saved)
    if (!merged.has(value.id) || merged.get(value.id)!.version < value.version)
      merged.set(value.id, value);
  return Array.from(merged.values());
}

function retainCredentialReplies(
  saved: (Credential & { archived_at?: string | null })[],
  current: Credential[],
  awaitingRead: string | null,
  readKey?: string,
) {
  const hasFreshRead = awaitingRead !== null && awaitingRead !== readKey;
  return saved.filter(
    (record) =>
      !hasFreshRead ||
      Boolean(record.archived_at) ||
      current.some((value) => value.id === record.id),
  );
}

function DuplicateReview({
  record,
  register,
  active,
}: {
  record: Credential;
  register: Register;
  active: (Credential & { archived_at?: string | null })[];
}) {
  const source = register.credentials.find(
    (current) => current.id === record.id,
  ) as (Credential & { suspected_duplicate_ids?: string[] }) | undefined;
  const candidates = active.filter(
    (current) =>
      !current.archived_at &&
      source?.suspected_duplicate_ids?.includes(current.id),
  );
  if (!candidates.length) return null;
  return (
    <aside>
      <p>Possible duplicate — review these records</p>
      <ul>
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <a href={`#record-${candidate.id}`}>{candidate.title}</a>
            {" · "}
            {typeLabels[candidate.type]} · {candidate.owner_name}
            <RecordDates record={candidate} />
          </li>
        ))}
      </ul>
    </aside>
  );
}

type DisplayRecord = Credential & { archived_at?: string | null };
type Editing = {
  record: MaintenanceCredential;
  intent: "update" | "archive";
} | null;
type ControlsProps = {
  record: DisplayRecord;
  canEdit: boolean;
  action?: MaintenanceAction;
  register: Register;
  editing: Editing;
  locked: boolean;
  refreshing: boolean;
  clinicians: Register["clinicians"];
  onChanged: (state: MaintenanceState) => void;
  close: () => void;
  onLock: (locked: boolean) => void;
  open: (
    record: MaintenanceCredential,
    intent: "update" | "archive",
    button: HTMLButtonElement,
  ) => void;
};
function RegisterFeedback({
  locked,
  notice,
  refreshing,
  feedback,
}: {
  locked: boolean;
  notice?: { message?: string };
  refreshing: boolean;
  feedback: React.RefObject<HTMLParagraphElement | null>;
}) {
  return (
    <>
      {" "}
      <nav aria-label="Register views">
        {locked ? (
          <p>Finish or retry this save before changing views.</p>
        ) : (
          <>
            <Link className="text-link" href="/practice/register">
              Active records
            </Link>
            {" · "}
            <Link className="text-link" href="/practice/register?view=archived">
              Archived records
            </Link>
            {" · "}
            <a className="text-link" href="/practice/calendar">
              Renewal calendar
            </a>
          </>
        )}
      </nav>
      {notice?.message && (
        <p ref={feedback} role="status" tabIndex={-1} className="success">
          {notice.message}
        </p>
      )}
      {refreshing && <p>Refreshing saved records before another edit…</p>}
    </>
  );
}
function RecordItem({
  record,
  canEdit,
  maintenanceAction,
  register,
  editing,
  locked,
  refreshing,
  clinicians,
  onChanged,
  close,
  onLock,
  open,
  active,
  archivedView,
}: Omit<ControlsProps, "action"> & {
  maintenanceAction?: MaintenanceAction;
  active: DisplayRecord[];
  archivedView: boolean;
}) {
  return (
    <li key={record.id} id={`record-${record.id}`}>
      <article>
        <h3>{record.title}</h3>
        <p>
          {typeLabels[record.type]} · {record.id.slice(-6)}
        </p>
        <p>
          Owner: {record.owner_name} (
          {record.owner_kind === "practice" ? "practice" : "clinician"})
        </p>
        {record.type === "malpractice_policy" &&
          record.owner_kind === "practice" && (
            <p>
              {record.covered_clinicians.length
                ? `Covers: ${record.covered_clinicians.map((person) => person.name).join(", ")}`
                : "No covered clinicians selected"}
            </p>
          )}
        <RecordDates record={record} />
        {record.archived_at && (
          <p>
            Archived on{" "}
            <time dateTime={record.archived_at}>
              {record.archived_at.slice(0, 10)}
            </time>
          </p>
        )}
        {!archivedView && (
          <DuplicateReview
            record={record}
            register={register}
            active={active}
          />
        )}
        <RecordControls
          record={record}
          canEdit={canEdit}
          action={maintenanceAction}
          register={register}
          editing={editing}
          locked={locked}
          refreshing={refreshing}
          clinicians={clinicians}
          onChanged={onChanged}
          close={close}
          onLock={onLock}
          open={open}
        />
      </article>
    </li>
  );
}
function controlsDisabled({
  locked,
  editing,
  refreshing,
  record,
  register,
}: ControlsProps) {
  return (
    locked ||
    editing !== null ||
    refreshing ||
    !("archived_at" in record) ||
    !register.credentials.some(
      (current) =>
        current.id === record.id && current.version >= record.version,
    )
  );
}
function RecordControls(props: ControlsProps) {
  const {
    record,
    canEdit,
    action,
    editing,
    clinicians,
    onChanged,
    close,
    onLock,
    open,
  } = props;
  if (!canEdit || !action || record.archived_at) return null;
  return (
    <div>
      {(["update", "archive"] as const).map((intent) => (
        <button
          type="button"
          key={intent}
          disabled={controlsDisabled(props)}
          onClick={(event) =>
            open(record as MaintenanceCredential, intent, event.currentTarget)
          }
        >
          {intent === "update" ? "Edit record" : "Archive record"}
        </button>
      ))}
      {editing?.record.id === record.id &&
        (editing.intent === "update" ? (
          <EditRecordForm
            record={editing.record}
            clinicians={clinicians}
            action={action}
            onSaved={onChanged}
            onCancel={close}
            onLock={onLock}
          />
        ) : (
          <ArchiveRecordForm
            record={editing.record}
            clinicians={clinicians}
            action={action}
            onSaved={onChanged}
            onCancel={close}
            onLock={onLock}
          />
        ))}
    </div>
  );
}
