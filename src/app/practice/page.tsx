import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getCurrentPractice } from "@/lib/practice/repository";
import { getSupportedTimezones } from "@/lib/practice/timezones";
import { PracticeForm } from "@/components/practice/practice-form";
import { Shell } from "@/components/shell";
import { updatePracticeAction } from "./actions";
import { signOutAction } from "@/app/login/actions";
export const dynamic = "force-dynamic";
export default async function Settings() {
  const { client, user } = await requireUser();
  const result = await getCurrentPractice(client);
  if (result.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  if (!result.practice) redirect("/onboarding/practice");
  return (
    <Shell
      action={
        <form action={signOutAction}>
          <button className="secondary">Sign out</button>
        </form>
      }
    >
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
            <span className="eyebrow">Practice administrator</span>
            <p>{user.email}</p>
          </div>
          <p className="hint">
            Your renewal calendar will build on this profile.
          </p>
        </section>
        <section className="panel">
          <span className="saved-label">
            <span aria-hidden="true">●</span> Practice profile saved
          </span>
          <h2>{result.practice.name}</h2>
          <p>Manage your practice name and local time.</p>
          <PracticeForm
            practice={result.practice}
            action={updatePracticeAction}
            timezones={getSupportedTimezones()}
          />
        </section>
      </div>
    </Shell>
  );
}
