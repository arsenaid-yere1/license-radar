import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { getMaintenanceRegister } from "@/lib/register/repository";
import { typeLabels, type MaintenanceCredential } from "@/lib/register/schema";
import { practiceToday } from "@/lib/calendar/dates";
import {
  calendarHref,
  parseCalendarQuery,
  type SearchQuery,
} from "@/lib/calendar/query";
import { RecordDates } from "@/components/register/record-dates";
import { Shell } from "@/components/shell";
import { SignOutForm } from "@/components/auth/sign-out-form";
export const dynamic = "force-dynamic";
export default async function CredentialDetail({
  params,
  searchParams,
}: {
  params: Promise<{ credentialId: string }>;
  searchParams?: Promise<SearchQuery>;
}) {
  const { client } = await requireUser(),
    access = await getPracticeAccess(client);
  if (access.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  if (!access.access) redirect("/onboarding/practice");
  const id = z.uuid().safeParse((await params).credentialId);
  if (!id.success) notFound();
  const result = await getMaintenanceRegister(
    client,
    access.access.practice.id,
    false,
  );
  if (result.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  const record = result.register.credentials.find(
    (r) => r.id === id.data.toLowerCase() && r.archived_at === null,
  );
  if (!record) notFound();
  const today = practiceToday(access.access.practice.timezone, new Date()),
    raw = (await searchParams) ?? {};
  return (
    <Shell action={<SignOutForm />}>
      <div className="calendar-heading">
        <BackLink raw={raw} today={today} />
        <span className="eyebrow">
          {access.access.practice.name} / Renewal record
        </span>
        <h1>{record.title}</h1>
        <article className="panel credential-detail">
          <RecordSummary record={record} />
          <RecordDates record={record} />
          <p className="hint">
            Practice timezone: {access.access.practice.timezone}
          </p>
          <p className="hint">Text reminders are not active yet.</p>
          <a
            className="text-link"
            href={`/practice/register#record-${record.id}`}
          >
            {access.access.role === "viewer"
              ? "View in register"
              : "Edit in register"}
          </a>
        </article>
      </div>
    </Shell>
  );
}

function BackLink({ raw, today }: { raw: SearchQuery; today: string }) {
  if (raw.from === "dashboard")
    return (
      <a className="text-link" href="/practice/dashboard">
        Back to dashboard
      </a>
    );
  const query = parseCalendarQuery(raw, today),
    back = query.invalidFilters
      ? parseCalendarQuery({ month: query.month, view: query.view }, today)
      : query;
  return (
    <a className="text-link" href={calendarHref(back)}>
      Back to calendar
    </a>
  );
}

function RecordSummary({ record }: { record: MaintenanceCredential }) {
  return (
    <>
      <p>{typeLabels[record.type]}</p>
      <p>
        Owner: {record.owner_name} ({record.owner_kind})
      </p>
      {record.type === "malpractice_policy" &&
        record.owner_kind === "practice" && (
          <p>
            {record.covered_clinicians.length
              ? `Covers: ${record.covered_clinicians.map((p) => p.name).join(", ")}`
              : "No covered clinicians selected"}
          </p>
        )}
    </>
  );
}
