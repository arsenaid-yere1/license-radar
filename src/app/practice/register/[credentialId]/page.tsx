import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { randomUUID } from "node:crypto";
import { getRenewalRegister } from "@/lib/renewals/repository";
import { RenewalDetail } from "@/components/renewals/detail";
import { renewalAction } from "./actions";
import { typeLabels, type MaintenanceCredential } from "@/lib/register/schema";
import { practiceToday } from "@/lib/calendar/dates";
import {
  calendarHref,
  parseCalendarQuery,
  type SearchQuery,
} from "@/lib/calendar/query";
import { RecordDates } from "@/components/register/record-dates";
import { RecordNumber } from "@/components/register/record-number";
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
  const result = await getRenewalRegister(
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
    <RenewalDetail
      shellAction={<SignOutForm />}
      record={record}
      canEdit={access.access.role !== "viewer"}
      action={renewalAction.bind(null, record.id)}
      readKey={randomUUID()}
      timezone={access.access.practice.timezone}
      today={today}
      backLink={<BackLink raw={raw} today={today} />}
      heading={
        <>
          <span className="eyebrow">
            {access.access.practice.name} / Renewal record
          </span>
          <h1>{record.title}</h1>
        </>
      }
      summary={
        <>
          <RecordSummary record={record} />
          <RecordNumber record={record} />
          <RecordDates record={record} />
          <p className="hint">
            Practice timezone: {access.access.practice.timezone}
          </p>
          <p className="hint">Text reminders are not active yet.</p>
        </>
      }
      navigation={
        <>
          <Link
            className="text-link"
            href={`/practice/register/${record.id}/evidence/${record.current_cycle.id}`}
          >
            Renewal evidence
          </Link>
          <Link
            className="text-link"
            href={`/practice/register/${record.id}/history`}
          >
            Renewal history
          </Link>
          <Link className="text-link" href={`/practice/reminders/${record.id}`}>
            Delivery history
          </Link>
          <Link
            prefetch={false}
            className="text-link"
            href="/practice/reminders"
          >
            Email schedule and delivery status
          </Link>
          <Link
            className="text-link"
            href={`/practice/register#record-${record.id}`}
          >
            {access.access.role === "viewer"
              ? "View in register"
              : "Edit in register"}
          </Link>
        </>
      }
    />
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
