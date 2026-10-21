import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { getReminderScheduleV4 } from "@/lib/reminders/repository";
import { emailConfig, emailWebhookConfig } from "@/lib/reminders/config";
import {
  gmailConfig,
  selectedEmailProvider,
} from "@/lib/reminders/gmail-config";
import { Shell } from "@/components/shell";
import { SignOutForm } from "@/components/auth/sign-out-form";
import { EmailPreferenceForm } from "@/components/reminders/preference-form";
import { emailPreferenceAction } from "./actions";
export const dynamic = "force-dynamic";
const kindLabels = {
  normal: "60-day reminder",
  "catch-up": "Catch-up reminder",
};
const reasons: Record<string, string> = {
  "gmail-unavailable":
    "Gmail authorization needs review. Ask your administrator to reconnect the sending account.",
  "gmail-recipient-blocked":
    "This Gmail pilot can send only to its authorized account. Choose that account as the reminder recipient.",
  "already-attempted": "Email attempt already used for this recipient",
  "missing-date": "Add a due date",
  "invalid-target": "Scheduled date unavailable",
  "no-recipient": "Choose a reminder recipient",
  "member-unavailable": "Recipient unavailable",
  "email-unconfirmed": "Recipient email needs confirmation",
  "email-disabled": "Recipient disabled reminder emails",
  "email-suppressed": "Email blocked after a delivery problem",
  archived: "Record archived",
  "cycle-completed": "Cycle completed",
};
function localTime(value: string | null, zone: string) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not scheduled";
}
async function loadReminders(params: { after?: string }) {
  const { client } = await requireUser(),
    access = await getPracticeAccess(client);
  if (access.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  if (!access.access) redirect("/onboarding/practice");
  const { practice } = access.access,
    config = emailWebhookConfig(),
    namespace =
      selectedEmailProvider() === "gmail"
        ? (z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,80}$/)
            .safeParse(process.env.GMAIL_PROVIDER_NAMESPACE).data ??
          "unconfigured")
        : (config?.namespace ?? "unconfigured");
  const after = reminderCursor(params.after);
  const result = await getReminderScheduleV4(
    client,
    practice.id,
    namespace,
    after,
  );
  if (result.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  return { practice, schedule: result.schedule };
}
export default async function Reminders({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  const { practice, schedule } = await loadReminders(await searchParams);
  const configured =
    selectedEmailProvider() === "gmail"
      ? Boolean(gmailConfig())
      : selectedEmailProvider() === "resend" && Boolean(emailConfig());
  const stale = heartbeatStale(schedule.lastSuccessAt, new Date());
  return (
    <Shell action={<SignOutForm />}>
      <div className="settings-panels">
        <section className="intro">
          <span className="eyebrow">Practice essentials / Reminders</span>
          <h1>
            Renewals.
            <br />
            <em>In good time.</em>
          </h1>
          <p className="lede">
            Email reminders are scheduled 60 calendar days before the action
            deadline, or the end date when no deadline is entered, at 9 AM in{" "}
            {practice.timezone}. Eligible late entries or reminder setup are
            scheduled for catch-up in the next permitted local sending window,
            from 9 AM to before 5 PM.
          </p>
          <p>
            {configured
              ? "Email sending configured."
              : "Email sending is off or setup is incomplete."}{" "}
            {schedule.emailReadiness === "ready"
              ? "Recipient email ready."
              : reasons[schedule.emailReadiness]}
          </p>
          <p className="hint">
            Texts are optional after separate configuration, phone verification
            and explicit enrollment. Renewal texts are not active yet. Provider
            acceptance and receiving mail-server delivery do not mean a renewal
            is complete.
          </p>
          <GmailConnection configured={configured} stale={stale} />
          <Link href="/practice" className="text-link">
            Practice settings and recipient
          </Link>{" "}
          <Link href="/practice/sms" className="text-link">
            Optional reminder texts
          </Link>
        </section>
        <EmailPreferenceForm
          preference={schedule.preference}
          action={emailPreferenceAction}
        />
        <section className="panel">
          <h2>Email schedule and status</h2>
          <Link className="text-link" href="/practice/reminders">
            Refresh status
          </Link>
          {configured && stale && (
            <p role="status">
              The reminder worker has not reported success in the last 15
              minutes. Scheduled emails may be delayed.
            </p>
          )}
          <p className="hint">
            Last successful check:{" "}
            {localTime(schedule.lastSuccessAt, practice.timezone)}. Oldest
            waiting reminder:{" "}
            {localTime(schedule.oldestDueAt, practice.timezone)}.
          </p>
          {schedule.rows.length === 0 && <p>No renewal records yet.</p>}
          {schedule.rows.map((row) => (
            <ReminderRow key={row.id} row={row} />
          ))}
          {schedule.nextCursor && (
            <Link
              className="text-link"
              href={`/practice/reminders?after=${schedule.nextCursor}`}
            >
              Next records
            </Link>
          )}
        </section>
      </div>
    </Shell>
  );
}

function GmailConnection({
  configured,
  stale,
}: {
  configured: boolean;
  stale: boolean;
}) {
  if (selectedEmailProvider() !== "gmail" || (configured && !stale))
    return null;
  return (
    <p role="status">
      Gmail sending is off or its Google connection needs review. Ask your
      administrator to reconnect the sending account.
    </p>
  );
}
function ReminderRow({
  row,
}: {
  row: import("@/lib/reminders/schema").ScheduleV4["rows"][number];
}) {
  return (
    <article>
      <h3>
        <ReminderTitle row={row} />
      </h3>
      <Link className="text-link" href={`/practice/reminders/${row.id}`}>
        Delivery history
      </Link>
      <dl>
        <dt>
          {row.datePurpose === "action-deadline"
            ? "Current action deadline"
            : "Current end date"}
        </dt>
        <dd>{row.dueDate ?? "No date entered"}</dd>
        <dt>Original 60-day target</dt>
        <dd>
          {localTime(row.target, row.timezone)} · {row.timezone}
        </dd>
        <dt>Reminder kind</dt>
        <dd>
          {row.scheduleKind
            ? kindLabels[row.scheduleKind]
            : "Scheduling review pending"}
        </dd>
        <CatchUpTarget row={row} />
        <ProviderRecovery row={row} />
        <dt>Email status</dt>
        <dd>
          <EmailStatus row={row} />
        </dd>
        {["queued", "claimed"].includes(row.state) && row.nextSendAt && (
          <>
            <dt>Next sending window</dt>
            <dd>{localTime(row.nextSendAt, row.timezone)}</dd>
          </>
        )}
      </dl>
      {["submitting", "accepted", "failed", "uncertain"].includes(
        row.state,
      ) && (
        <p className="hint">
          The prior email keeps its original scheduling details. Date changes do
          not send another email automatically.
        </p>
      )}
    </article>
  );
}

function EmailStatus({
  row,
}: {
  row: import("@/lib/reminders/schema").ScheduleV4["rows"][number];
}) {
  return (
    <>
      {row.provider?.kind === "gmail" && row.state === "accepted"
        ? "Accepted by Gmail; delivery is not confirmed"
        : (row.delivery ?? row.state)}
      {row.reason && ` · ${reasons[row.reason] ?? "Eligibility changed"}`}
    </>
  );
}
function ProviderRecovery({
  row,
}: {
  row: import("@/lib/reminders/schema").ScheduleV4["rows"][number];
}) {
  return row.provider?.kind === "gmail" ? null : (
    <RecoveryStatus recovery={row.recovery} />
  );
}
function RecoveryStatus({
  recovery,
}: {
  recovery: import("@/lib/reminders/schema").ScheduleV4["rows"][number]["recovery"];
}) {
  return recovery ? (
    <>
      <dt>Recovery status</dt>
      <dd>{recovery.disposition}</dd>
    </>
  ) : null;
}
function ReminderTitle({
  row,
}: {
  row: import("@/lib/reminders/schema").ScheduleV4["rows"][number];
}) {
  return row.activeLinkAvailable ? (
    <Link href={`/practice/register/${row.id}`}>{row.title}</Link>
  ) : (
    row.title
  );
}
function CatchUpTarget({
  row,
}: {
  row: import("@/lib/reminders/schema").ScheduleV4["rows"][number];
}) {
  if (row.scheduleKind !== "catch-up" || !row.dispatchTarget) return null;
  return (
    <>
      <dt>Catch-up target</dt>
      <dd>{localTime(row.dispatchTarget, row.timezone)}</dd>
    </>
  );
}

function heartbeatStale(last: string | null, now: Date) {
  return !last || now.getTime() - Date.parse(last) > 900000;
}

function reminderCursor(raw: string | undefined) {
  if (!raw) return null;
  const result = z.uuid().safeParse(raw);
  if (!result.success) redirect("/practice/reminders");
  return result.data;
}
