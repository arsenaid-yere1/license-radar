"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { RenewalAction, RenewalCredential } from "@/lib/renewals/schema";
import { RenewalForm, type RenewalIntent } from "./form";
import { RenewalSummary } from "./summary";
import { Shell } from "@/components/shell";
export type RenewalDetailProps = {
  record: RenewalCredential;
  canEdit: boolean;
  action: RenewalAction;
  readKey: string;
  timezone: string;
  today?: string;
  summary?: ReactNode;
  backLink?: ReactNode;
  navigation?: ReactNode;
  heading?: ReactNode;
  shellAction?: ReactNode;
};
export function RenewalDetail({
  record,
  canEdit,
  action,
  readKey,
  timezone,
  today,
  summary,
  backLink,
  navigation,
  heading,
  shellAction,
}: RenewalDetailProps) {
  const router = useRouter(),
    opener = useRef<HTMLButtonElement | null>(null),
    feedback = useRef<HTMLParagraphElement>(null),
    latestRead = useRef(readKey);
  const [editing, setEditing] = useState<{
      intent: RenewalIntent;
      record: RenewalCredential;
      key: string;
    } | null>(null),
    [locked, setLocked] = useState(false),
    [awaitingRead, setAwaitingRead] = useState<string | null>(null),
    [notice, setNotice] = useState<string>();
  const onLock = useCallback((value: boolean) => setLocked(value), []),
    refreshing = awaitingRead !== null && awaitingRead === readKey,
    writeLocked = locked || refreshing;
  useEffect(() => {
    latestRead.current = readKey;
  }, [readKey]);
  useEffect(() => {
    if (!editing) opener.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (notice) feedback.current?.focus();
  }, [notice]);
  return (
    <RenewalShell locked={writeLocked} action={shellAction}>
      <div className="calendar-heading">
        {!writeLocked && backLink}
        <DetailHeading heading={heading} title={record.title} />
        <article className="panel credential-detail">
          {summary}
          <section className="renewal-work" aria-label="Renewal work">
            <div className="renewal-work-heading">
              <h2 className="eyebrow">Renewal work</h2>
              <RenewalSummary renewal={record.renewal} timezone={timezone} />
            </div>
            <p className="hint">
              Progress and review are separate from confirmed renewal. Entered
              dates remain in effect.
            </p>
            <RenewalLink url={record.renewal.link.url} disabled={writeLocked} />
            <RenewalControls
              canEdit={canEdit}
              disabled={writeLocked || editing !== null}
              reviewed={record.renewal.workflow.acknowledgedAt !== null}
              onOpen={(intent, button) => {
                opener.current = button;
                setNotice(undefined);
                setEditing({ intent, record, key: crypto.randomUUID() });
              }}
            />
            {editing && (
              <RenewalForm
                key={editing.key}
                record={editing.record}
                intent={editing.intent}
                requestKey={editing.key}
                action={action}
                today={today}
                timezone={timezone}
                onLock={onLock}
                onCancel={() => setEditing(null)}
                onReload={(saved) =>
                  setEditing({
                    ...editing,
                    record: saved,
                    key: crypto.randomUUID(),
                  })
                }
                onSaved={(state) => {
                  setNotice(state.message);
                  setAwaitingRead(latestRead.current);
                  setEditing(null);
                  router.refresh();
                }}
              />
            )}
            {notice && (
              <p ref={feedback} role="status" tabIndex={-1} className="success">
                {notice}
              </p>
            )}
            {locked && (
              <p className="hint">
                Finish or retry this save before leaving this record.
              </p>
            )}
            {refreshing && (
              <p className="hint">
                Refreshing saved progress before another change…
              </p>
            )}
          </section>
          {!writeLocked && (
            <nav className="renewal-navigation" aria-label="Record navigation">
              {navigation}
            </nav>
          )}
        </article>
      </div>
    </RenewalShell>
  );
}
function RenewalShell({
  locked,
  action,
  children,
}: {
  locked: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Shell
      navigationLocked={locked}
      action={
        locked ? (
          <span className="header-note">Finish or retry this save.</span>
        ) : (
          action
        )
      }
    >
      {children}
    </Shell>
  );
}
function RenewalLink({
  url,
  disabled,
}: {
  url: string | null;
  disabled: boolean;
}) {
  if (!url)
    return (
      <p className="hint">
        No renewal link saved. Add the issuer’s renewal page when you have it.
      </p>
    );
  const hostname = new URL(url).hostname;
  if (disabled) return <p className="hint">Saved renewal site: {hostname}</p>;
  return (
    <a
      className="text-link renewal-site"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
    >
      Open renewal site: {hostname} <span aria-hidden="true">↗</span>
      <span className="hint"> (opens in a new tab)</span>
    </a>
  );
}
function DetailHeading({
  heading,
  title,
}: {
  heading?: ReactNode;
  title: string;
}) {
  return heading ?? <h1>{title}</h1>;
}
function RenewalControls({
  canEdit,
  disabled,
  reviewed,
  onOpen,
}: {
  canEdit: boolean;
  disabled: boolean;
  reviewed: boolean;
  onOpen: (intent: RenewalIntent, button: HTMLButtonElement) => void;
}) {
  if (!canEdit) return null;
  return (
    <div className="renewal-buttons">
      {(["progress", "link", "review", "complete"] as const).map((intent) => (
        <button
          className="secondary"
          key={intent}
          type="button"
          disabled={disabled || (intent === "review" && reviewed)}
          onClick={(event) => onOpen(intent, event.currentTarget)}
        >
          {intent === "progress"
            ? "Change progress"
            : intent === "link"
              ? "Edit renewal link"
              : intent === "complete"
                ? "Record confirmed renewal"
                : "Acknowledge review"}
        </button>
      ))}
    </div>
  );
}
