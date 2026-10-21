import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import {
  getReminderHistoryV2 as getReminderHistory,
  getReminderTimelineV2 as getReminderTimeline,
  type ReminderHistoryV2 as ReminderHistory,
  type RecoverySummary,
} from "@/lib/reminders/history";
import { Shell } from "@/components/shell";
import { SignOutForm } from "@/components/auth/sign-out-form";
import { EmailCheckForm } from "@/components/reminders/check-form";
import { emailCheckAction } from "./actions";
export const dynamic = "force-dynamic";
function time(value: string | null, zone: string) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Unavailable";
}
export default async function ReminderHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ credentialId: string }>;
  searchParams: Promise<{ after?: string; attempt?: string; event?: string }>;
}) {
  const { credentialId } = await params,
    query = await searchParams;
  const loaded = await loadHistory(credentialId, query.after);
  if (!loaded) return <Missing />;
  const { client, access, history } = loaded;
  return (
    <Shell action={<SignOutForm />}>
      <section className="panel">
        <span className="eyebrow">Reminder history</span>
        <HistoryHeading credential={history.credential} />
        <p className="hint">
          History includes previous dates and recipients. Provider acceptance or
          delivery does not mean the renewal is complete. An unclear outcome
          needs review. Available actions depend on the sending provider.
        </p>
        <Link className="text-link" href="/practice/reminders">
          Back to reminders
        </Link>{" "}
        {!history.credential.archived && (
          <Link
            className="text-link"
            href={`/practice/register/${credentialId}`}
          >
            Open record
          </Link>
        )}
        {history.rows.length === 0 && <p>No reminder history yet.</p>}
        {history.rows.map((row) => (
          <HistoryRow
            key={row.id}
            row={row}
            credentialId={credentialId}
            canManage={access.access!.role !== "viewer"}
          />
        ))}
        {history.nextCursor && (
          <Link
            className="text-link"
            href={`/practice/reminders/${credentialId}?after=${history.nextCursor}`}
          >
            Older reminder records
          </Link>
        )}
        {query.attempt && (
          <Timeline
            client={client}
            practiceId={access.access.practice.id}
            credentialId={credentialId}
            attempt={query.attempt}
            event={query.event}
          />
        )}
      </section>
    </Shell>
  );
}
async function loadHistory(credentialId: string, rawAfter?: string) {
  const { client } = await requireUser();
  const access = await getPracticeAccess(client);
  if (access.status !== "success")
    throw new Error("We could not load reminder history. Try again.");
  if (!access.access) redirect("/onboarding/practice");

  const parsed = z.uuid().safeParse(credentialId),
    after = z
      .uuid()
      .nullable()
      .safeParse(rawAfter ?? null);
  if (!parsed.success || !after.success) return null;
  const history = await getReminderHistory(
    client,
    access.access.practice.id,
    credentialId,
    after.data,
  );
  if (history.status === "not-found") return null;
  if (history.status !== "success")
    throw new Error("We could not load reminder history. Try again.");
  return { client, access: { access: access.access }, history };
}
function HistoryHeading({
  credential,
}: {
  credential: Extract<ReminderHistory, { status: "success" }>["credential"];
}) {
  return (
    <>
      <h1>{credential.title}</h1>
      <p>
        {credential.archived ? "Archived record" : "Current record"} · Current
        due date: {credential.currentDueDate ?? "No date entered"} ·{" "}
        {credential.currentTimezone}
      </p>
    </>
  );
}
function Missing() {
  return (
    <Shell action={<SignOutForm />}>
      <section className="panel">
        <h1>Reminder history unavailable</h1>
        <p>This record is unavailable in your practice.</p>
        <Link href="/practice/reminders">Back to reminders</Link>
      </section>
    </Shell>
  );
}
function HistoryRow({
  row,
  credentialId,
  canManage,
}: {
  row: Extract<ReminderHistory, { status: "success" }>["rows"][number];
  credentialId: string;
  canManage: boolean;
}) {
  return (
    <article>
      <h2>
        {row.recipient === "selected"
          ? "Selected recipient"
          : "Former recipient"}
      </h2>
      <dl>
        <dt>Frozen due date</dt>
        <dd>
          {row.dueDate} · {row.timezone}
        </dd>
        <dt>Reminder kind</dt>
        <dd>
          {row.scheduleKind === "catch-up"
            ? "Catch-up reminder"
            : "60-day reminder"}
        </dd>
        <dt>Original target</dt>
        <dd>{time(row.nominalTarget, row.timezone)}</dd>
        <dt>Dispatch target</dt>
        <dd>{time(row.dispatchTarget, row.timezone)}</dd>
        <dt>Attempt started</dt>
        <dd>
          {row.startedAt
            ? time(row.startedAt, row.timezone)
            : "No message attempt"}
        </dd>
        <SubmissionDetails row={row} />
      </dl>
      <ProviderGuidance row={row} />
      {row.reason && (
        <p>
          {reasonGuidance.get(row.reason) ??
            "Scheduling details changed. Review current record dates and practice reminder settings."}
        </p>
      )}
      {row.attemptId && (
        <Link
          className="text-link"
          href={`/practice/reminders/${credentialId}?attempt=${row.attemptId}`}
        >
          View attempt events
        </Link>
      )}
      <CheckControls row={row} canManage={canManage} />
    </article>
  );
}
function SubmissionDetails({
  row,
}: {
  row: Extract<ReminderHistory, { status: "success" }>["rows"][number];
}) {
  return (
    <>
      {" "}
      <dt>Submission outcome</dt>
      <dd>
        {row.provider?.kind === "gmail" && row.state === "accepted"
          ? "Accepted by Gmail; delivery is not confirmed"
          : row.state}
      </dd>
      <dt>Delivery evidence</dt>
      <dd>{row.delivery ?? "Not observed"}</dd>
      {row.provider?.kind === "gmail" ? (
        <>
          <dt>Provider submissions</dt>
          <dd>1 of 1</dd>
        </>
      ) : (
        <RecoveryDetails recovery={row.recovery} zone={row.timezone} />
      )}
    </>
  );
}
function ProviderGuidance({
  row,
}: {
  row: Extract<ReminderHistory, { status: "success" }>["rows"][number];
}) {
  return (
    <>
      {" "}
      {row.provider?.kind === "gmail" ? (
        <p>Automatic resend and delivery checks are unavailable.</p>
      ) : (
        row.recovery && <p>{recoveryGuidance[row.recovery.disposition]}</p>
      )}
    </>
  );
}
function CheckControls({
  row,
  canManage,
}: {
  row: Extract<ReminderHistory, { status: "success" }>["rows"][number];
  canManage: boolean;
}) {
  if (
    !canManage ||
    !row.attemptId ||
    !row.recovery ||
    row.provider?.kind === "gmail"
  )
    return null;
  return (
    <EmailCheckForm
      attemptId={row.attemptId}
      version={row.recovery.version}
      canCheck={row.recovery.canCheck}
      action={emailCheckAction}
    />
  );
}
function RecoveryDetails({
  recovery,
  zone,
}: {
  recovery: Extract<
    ReminderHistory,
    { status: "success" }
  >["rows"][number]["recovery"];
  zone: string;
}) {
  if (!recovery) return null;
  return (
    <>
      <dt>Recovery</dt>
      <dd>{recovery.disposition}</dd>
      <dt>Provider submissions</dt>
      <dd>
        {recovery.disposition === "legacy"
          ? "Recorded before recovery tracking"
          : `${recovery.postCount} of 3`}
      </dd>
      <dt>Delivery checks</dt>
      <dd>{recovery.checkCount} of 6</dd>
      {recovery.retryDue && (
        <>
          <dt>Next permitted retry</dt>
          <dd>{time(recovery.retryDue, zone)}</dd>
        </>
      )}
      {recovery.checkDue && (
        <>
          <dt>Next delivery check</dt>
          <dd>{time(recovery.checkDue, zone)}</dd>
        </>
      )}
    </>
  );
}
const gmailEventLabels = new Map([
  ["gmail-result-accepted", "Gmail accepted the reminder"],
  ["gmail-result-failed", "Gmail rejected the reminder"],
  ["gmail-result-uncertain", "Gmail acceptance could not be confirmed"],
  [
    "gmail-permission-expired",
    "Gmail submission deadline passed; no automatic resend",
  ],
]);
function eventLabel(operation: string) {
  return gmailEventLabels.get(operation) ?? operation;
}
const reasonGuidance = new Map([
  [
    "gmail-unavailable",
    "Gmail authorization needs review. Ask your administrator to reconnect the sending account.",
  ],
  [
    "gmail-recipient-blocked",
    "This Gmail pilot can send only to its authorized account.",
  ],
  [
    "email-disabled",
    "The recipient disabled reminder emails. Review the practice reminder settings.",
  ],
  [
    "email-suppressed",
    "Email is blocked after a delivery problem. Contact your practice administrator for review.",
  ],
  [
    "already-attempted",
    "This recipient's message attempt is already consumed. Reviewing eligibility does not send it again.",
  ],
]);
const recoveryGuidance: Record<RecoverySummary["disposition"], string> = {
  legacy:
    "This message predates recovery tracking. Its recorded outcome remains available; it will not be retried automatically.",
  submitting:
    "A submission was reserved. Its outcome is being recorded; another send is not available.",
  "retry-pending": "The same frozen message is waiting for a permitted retry.",
  accepted:
    "The provider accepted this message. Delivery checks can add evidence without sending another email.",
  permanent:
    "The provider rejected this submission. Contact your practice administrator to review delivery settings.",
  uncertain:
    "Acceptance remains unclear. A delivery check can review the known message; it does not send another email.",
  "review-needed":
    "Acceptance could not be confirmed. Contact your practice administrator or support to review the outcome.",
  canceled:
    "Eligibility or message details changed. This message will not be retried.",
  exhausted:
    "All three submission reservations were used. Contact your practice administrator for review.",
  expired: "The safe retry period ended. This message will not be retried.",
};
async function Timeline({
  client,
  practiceId,
  credentialId,
  attempt,
  event,
}: {
  client: Parameters<typeof getReminderTimeline>[0];
  practiceId: string;
  credentialId: string;
  attempt: string;
  event?: string;
}) {
  const id = z.uuid().safeParse(attempt);
  if (!id.success) return <p>Attempt unavailable.</p>;
  let cursor: null | {
    observedAt: string;
    source: "job" | "submission" | "delivery" | "check";
    id: string;
  } = null;
  if (event) {
    try {
      cursor = z
        .strictObject({
          observedAt: z.string(),
          source: z.enum(["job", "submission", "delivery", "check"]),
          id: z.uuid(),
        })
        .parse(JSON.parse(event));
    } catch {
      return <p>Event page unavailable.</p>;
    }
  }
  const result = await getReminderTimeline(
    client,
    practiceId,
    id.data,
    cursor,
    credentialId,
  );
  if (result.status !== "success")
    return <p>Attempt events unavailable. Reload to try again.</p>;
  return (
    <section>
      <h2>Attempt events</h2>
      <p className="hint">Times show when the application recorded evidence.</p>
      <ol>
        {result.rows.map((row) => (
          <li key={`${row.source}-${row.id}`}>
            {time(row.observedAt, "UTC")} UTC · {row.source} ·{" "}
            {eventLabel(row.operation)}
            {row.anomaly ? " · Conflicting terminal evidence retained" : ""}
          </li>
        ))}
      </ol>
      {result.nextCursor && (
        <Link
          href={`/practice/reminders/${credentialId}?attempt=${id.data}&event=${encodeURIComponent(JSON.stringify(result.nextCursor))}`}
        >
          Earlier events
        </Link>
      )}
    </section>
  );
}
