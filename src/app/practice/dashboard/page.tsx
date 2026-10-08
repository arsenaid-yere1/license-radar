import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { getMaintenanceRegister } from "@/lib/register/repository";
import { practiceToday } from "@/lib/calendar/dates";
import { projectDashboard } from "@/lib/dashboard/summary";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { DateText } from "@/components/register/record-dates";
import { Shell } from "@/components/shell";
import { SignOutForm } from "@/components/auth/sign-out-form";
export const dynamic = "force-dynamic";
export default async function PracticeDashboard() {
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
    today = practiceToday(practice.timezone, new Date());
  return (
    <Shell action={<SignOutForm />}>
      <div className="dashboard-heading">
        <a className="text-link" href="/practice">
          Practice settings
        </a>
        <span className="eyebrow">{practice.name} / Renewal dashboard</span>
        <h1>Your renewal dashboard.</h1>
        <p className="lede">A clear view of what needs your attention.</p>
        <p className="dashboard-asof">
          As of <DateText date={today} /> · Practice timezone:{" "}
          {practice.timezone}
        </p>
        <p className="hint">
          Saved snapshot. Refresh to see the latest dates and records. Browser
          history may show an earlier snapshot.
        </p>
        <p className="hint">Text reminders are not active yet.</p>
        <nav className="dashboard-navigation" aria-label="Dashboard navigation">
          <a href="/practice/dashboard">Refresh records</a>
          <a href="/practice/calendar">Renewal calendar</a>
          {/* Document navigation checks current access and data. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/practice/register">Renewal register</a>
        </nav>
        <DashboardPanel summary={projectDashboard(result.register, today)} />
      </div>
    </Shell>
  );
}
