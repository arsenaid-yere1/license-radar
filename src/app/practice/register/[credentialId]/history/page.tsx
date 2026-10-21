import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { getRenewalHistory } from "@/lib/renewals/repository";
import { historyCursor, type RenewalHistory } from "@/lib/renewals/history";
import { typeLabels } from "@/lib/register/schema";
import { formatCredentialDate } from "@/lib/register/dates";
import { progressLabels } from "@/lib/renewals/state";
import { Shell } from "@/components/shell";
import { SignOutForm } from "@/components/auth/sign-out-form";
export const dynamic = "force-dynamic";
export default async function RenewalHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ credentialId: string }>;
  searchParams?: Promise<{ before?: string | string[] }>;
}) {
  const { client } = await requireUser(),
    access = await getPracticeAccess(client);
  if (access.status !== "success")
    throw new Error("We could not load renewal history. Try again.");
  if (!access.access) redirect("/onboarding/practice");
  const id = z.uuid().safeParse((await params).credentialId);
  if (!id.success) notFound();
  const credentialId = id.data.toLowerCase(),
    cursor = historyCursor((await searchParams)?.before);
  if (!cursor.valid)
    return (
      <Shell action={<SignOutForm />}>
        <section className="panel">
          <h1>History page unavailable</h1>
          <p>Choose a valid history page.</p>
          <Link href={`/practice/register/${credentialId}/history`}>
            Newest renewal history
          </Link>
        </section>
      </Shell>
    );
  const result = await getRenewalHistory(
    client,
    access.access.practice.id,
    credentialId,
    cursor.value,
  );
  if (result.status === "not-found") notFound();
  if (result.status !== "success")
    throw new Error("We could not load renewal history. Try again.");
  return (
    <HistoryView
      result={result}
      timezone={access.access.practice.timezone}
      paged={cursor.value !== null}
    />
  );
}
function HistoryView({
  result,
  timezone,
  paged,
}: {
  result: RenewalHistory;
  timezone: string;
  paged: boolean;
}) {
  const credentialId = result.credentialId;
  return (
    <Shell action={<SignOutForm />}>
      <div className="calendar-heading">
        <span className="eyebrow">Renewal history</span>
        <h1>{result.title}</h1>
        <p className="hint">
          {result.archivedAt ? "Archived record" : "Current record"} ·{" "}
          {timezone}. Confirmed renewals retain prior dates and progress.
          Delivery evidence is separate.
        </p>
        <nav className="renewal-navigation" aria-label="History navigation">
          <Link
            href={
              result.archivedAt
                ? "/practice/register?view=archived"
                : "/practice/register"
            }
          >
            Back to register
          </Link>
          {!result.archivedAt && (
            <Link href={`/practice/register/${credentialId}`}>
              Open current record
            </Link>
          )}
          <Link href={`/practice/reminders/${credentialId}`}>
            Delivery history
          </Link>
          {paged && (
            <Link href={`/practice/register/${credentialId}/history`}>
              Newest renewal history
            </Link>
          )}
        </nav>
        <section className="panel">
          <ol className="register-list" aria-label="Renewal cycles">
            {result.cycles.map((c) => (
              <Cycle
                key={c.id}
                cycle={c}
                current={c.id === result.currentCycleId}
                timezone={timezone}
                credentialId={credentialId}
              />
            ))}
          </ol>
          {result.cycles.length === 0 && <p>No cycles on this page.</p>}
          {result.nextBeforeCycleNumber !== null && (
            <Link
              className="text-link"
              href={`/practice/register/${credentialId}/history?before=${result.nextBeforeCycleNumber}`}
            >
              Older renewal cycles
            </Link>
          )}
        </section>
      </div>
    </Shell>
  );
}
function Cycle({
  cycle: c,
  current,
  timezone,
  credentialId,
}: {
  cycle: RenewalHistory["cycles"][number];
  current: boolean;
  timezone: string;
  credentialId: string;
}) {
  return (
    <li>
      <article>
        <h2>
          Cycle {c.cycleNumber} ·{" "}
          {current
            ? "Current cycle"
            : c.successorId
              ? "Confirmed renewal"
              : c.completedAt
                ? "Cycle closed"
                : "Historical cycle"}
        </h2>
        <p>{typeLabels[c.type]}</p>
        <dl>
          <dt>
            {c.type === "malpractice_policy" ? "Coverage end" : "Expiration"}
          </dt>
          <dd>{c.endDate ? formatCredentialDate(c.endDate) : "Not entered"}</dd>
          <dt>Earlier action deadline</dt>
          <dd>
            {c.actionDeadline
              ? formatCredentialDate(c.actionDeadline)
              : "None entered"}
          </dd>
          <dt>Progress</dt>
          <dd>{progressLabels[c.progress]}</dd>
          <dt>First review</dt>
          <dd>
            {c.acknowledgedAt
              ? time(c.acknowledgedAt, timezone)
              : "Not acknowledged"}
          </dd>
          {c.completedAt && (
            <>
              <dt>Recorded completion</dt>
              <dd>
                <time dateTime={c.completedAt}>
                  {time(c.completedAt, timezone)}
                </time>
              </dd>
            </>
          )}
        </dl>
        <Link
          className="text-link"
          href={`/practice/register/${credentialId}/evidence/${c.id}`}
        >
          Evidence for cycle {c.cycleNumber}
        </Link>
      </article>
    </li>
  );
}
function time(value: string, zone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
