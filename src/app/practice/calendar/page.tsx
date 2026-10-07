import { CalendarPanel } from "@/components/calendar/calendar-panel";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { getMaintenanceRegister } from "@/lib/register/repository";
import { practiceToday } from "@/lib/calendar/dates";
import { parseCalendarQuery, type SearchQuery } from "@/lib/calendar/query";
import { Shell } from "@/components/shell";
import { SignOutForm } from "@/components/auth/sign-out-form";
export const dynamic = "force-dynamic";
export default async function PracticeCalendar({
  searchParams,
}: {
  searchParams?: Promise<SearchQuery>;
}) {
  const { client } = await requireUser(),
    access = await getPracticeAccess(client);
  if (access.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  if (!access.access) redirect("/onboarding/practice");
  const result = await getMaintenanceRegister(
    client,
    access.access.practice.id,
    false,
  );
  if (result.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  const practice = access.access.practice,
    today = practiceToday(practice.timezone, new Date()),
    query = parseCalendarQuery((await searchParams) ?? {}, today);
  return (
    <Shell action={<SignOutForm />}>
      <div className="calendar-heading">
        <a className="text-link" href="/practice">
          Practice settings
        </a>
        <span className="eyebrow">{practice.name} / Renewal calendar</span>
        <h1>Your renewal calendar.</h1>
        <p className="lede">Every entered date. A little room to plan ahead.</p>
        <p className="hint">
          Practice timezone: {practice.timezone} · Saved snapshot. Refresh to
          see the latest records.
        </p>
        <p className="hint">Text reminders are not active yet.</p>
        <CalendarPanel register={result.register} query={query} today={today} />
      </div>
    </Shell>
  );
}
