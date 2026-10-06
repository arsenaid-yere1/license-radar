import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { getRecipient } from "@/lib/recipients/repository";
import { RecipientPanel } from "@/components/recipients/recipient-panel";
import { recipientAction } from "./recipient-actions";
import { roleLabels } from "@/lib/team/schema";
import Link from "next/link";
import { getSupportedTimezones } from "@/lib/practice/timezones";
import { PracticeForm } from "@/components/practice/practice-form";
import { Shell } from "@/components/shell";
import { updatePracticeAction } from "./actions";
import { SignOutForm } from "@/components/auth/sign-out-form";
export const dynamic = "force-dynamic";
export default async function Settings() {
  const { client, user } = await requireUser();
  const result = await getPracticeAccess(client);
  if (result.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  if (!result.access) redirect("/onboarding/practice");
  const { practice, role } = result.access;
  const recipient = await getRecipient(client, practice.id);
  if (recipient.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  return (
    <Shell action={<SignOutForm />}>
      <div className="split-layout">
        <section className="intro">
          <span className="eyebrow">Practice essentials / Settings</span>
          <h1>
            Your practice.
            <br />
            <em>In good time.</em>
          </h1>
          <p className="lede">
            Your foundation is saved. Keep these details current as your
            practice grows.
          </p>
          <div className="owner-note">
            <span className="eyebrow">{roleLabels[role]}</span>
            <p>{user.email}</p>
          </div>
          <p className="hint">
            Your renewal calendar will build on this profile.
          </p>
        </section>
        <div className="settings-panels">
          <Link href="/practice/register" className="text-link">
            Renewal register
          </Link>
          <section className="panel">
            <span className="saved-label">
              <span aria-hidden="true">●</span> Practice profile saved
            </span>
            <h2>{practice.name}</h2>
            <p>
              {role === "administrator"
                ? "Manage your practice name and local time."
                : "Your shared practice profile."}
            </p>
            {role === "administrator" ? (
              <>
                <PracticeForm
                  practice={practice}
                  action={updatePracticeAction}
                  timezones={getSupportedTimezones()}
                />
                <Link href="/practice/team" className="text-link">
                  Manage team
                </Link>
              </>
            ) : (
              <>
                <dl>
                  <dt>Practice timezone</dt>
                  <dd>{practice.timezone}</dd>
                </dl>
                <p className="hint">
                  An administrator can update these settings.
                </p>
              </>
            )}
          </section>
          <RecipientPanel
            recipient={recipient.recipient}
            action={recipientAction}
          />
        </div>
      </div>
    </Shell>
  );
}
