import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { getTeam } from "@/lib/team/repository";
import { Shell } from "@/components/shell";
import { SignOutForm } from "@/components/auth/sign-out-form";
import { TeamPanel } from "@/components/team/team-panel";
import { teamAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function PracticeTeam() {
  const { client } = await requireUser();
  const access = await getPracticeAccess(client);
  if (access.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  if (!access.access) redirect("/onboarding/practice");
  if (access.access.role !== "administrator") redirect("/practice");
  const result = await getTeam(client, access.access.practice.id);
  if (result.status === "forbidden") redirect("/practice");
  if (result.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  return (
    <Shell action={<SignOutForm />}>
      <div className="team-heading">
        <span className="eyebrow">Practice essentials / Team</span>
        <h1>
          Your people.
          <br />
          <em>The right access.</em>
        </h1>
        <p>{access.access.practice.name}</p>
        <Link href="/practice" className="text-link">
          Practice settings
        </Link>
      </div>
      <TeamPanel team={result.team} action={teamAction} />
    </Shell>
  );
}
