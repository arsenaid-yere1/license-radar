import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { getReminderSchedule } from "@/lib/reminders/repository";
import { emailConfig, emailWebhookConfig } from "@/lib/reminders/config";
import { Shell } from "@/components/shell";
import { SignOutForm } from "@/components/auth/sign-out-form";
import { EmailPreferenceForm } from "@/components/reminders/preference-form";
import { emailPreferenceAction } from "./actions";
export const dynamic = "force-dynamic";
const reasons: Record<string, string> = {
  "catch-up-unavailable": "Catch-up not available yet",
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
    namespace = config?.namespace ?? "unconfigured";
  const after = reminderCursor(params.after);
  const result = await getReminderSchedule(
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
  const configured = Boolean(emailConfig());
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
            {practice.timezone}.
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

function ReminderRow({
  row,
}: {
  row: import("@/lib/reminders/schema").Schedule["rows"][number];
}) {
  return (
    <article>
      <h3>
        <Link href={`/practice/register/${row.id}`}>{row.title}</Link>
      </h3>
      <dl>
        <dt>
          {row.datePurpose === "action-deadline"
            ? "Action deadline"
            : "End date"}
        </dt>
        <dd>{row.dueDate ?? "No date entered"}</dd>
        <dt>Scheduled local time</dt>
        <dd>
          {localTime(row.target, row.timezone)} · {row.timezone}
        </dd>
        <dt>Email status</dt>
        <dd>
          {row.delivery ?? row.state}
          {row.reason &&
            ` · ${reasons[row.reason] ?? "Waiting for eligibility review"}`}
        </dd>
        {["queued", "claimed"].includes(row.state) &&
          row.nextSendAt &&
          row.nextSendAt !== row.target && (
            <>
              <dt>Next sending window</dt>
              <dd>{localTime(row.nextSendAt, row.timezone)}</dd>
            </>
          )}
      </dl>
    </article>
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
