import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getCurrentPractice } from "@/lib/practice/repository";
import { getSupportedTimezones } from "@/lib/practice/timezones";
import { PracticeForm } from "@/components/practice/practice-form";
import { Shell } from "@/components/shell";
import { createPracticeAction } from "@/app/practice/actions";
import { signOutAction } from "@/app/login/actions";
export const dynamic = "force-dynamic";
export default async function Setup() {
  const { client } = await requireUser();
  const result = await getCurrentPractice(client);
  if (result.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  if (result.practice) redirect("/practice");
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
          <span className="eyebrow">Practice essentials / 02</span>
          <h1>
            A place for
            <br />
            <em>your practice.</em>
          </h1>
          <p className="lede">
            Give your practice a name and a local time. These two details will
            anchor your future renewal calendar.
          </p>
          <div className="intro-line">
            <span aria-hidden="true">02 —</span> Set your practice’s foundation
          </div>
        </section>
        <section className="panel">
          <span className="eyebrow">Your starting point</span>
          <h2>Let’s get oriented.</h2>
          <p>Two details, then you’re in.</p>
          <PracticeForm
            action={createPracticeAction}
            timezones={getSupportedTimezones()}
          />
        </section>
      </div>
    </Shell>
  );
}
