import { createClient } from "@/lib/supabase/server";
import { authenticationRequired } from "@/lib/auth/operations";
import { Shell } from "@/components/shell";
import { JoinForm } from "@/components/auth/join-form";
import { joinAction } from "./actions";
export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" };
export default async function Join() {
  const { data, error } = await (await createClient()).auth.getUser();
  if (error && !authenticationRequired(error.status))
    throw new Error("We could not complete this request. Try again.");
  return (
    <Shell>
      <div className="split-layout">
        <section className="intro">
          <span className="eyebrow">Your invitation</span>
          <h1>
            Join your
            <br />
            <em>practice.</em>
          </h1>
          <p className="lede">
            Verify your email, review your access, then accept your invitation.
          </p>
        </section>
        <section className="panel">
          <h2>Welcome to the team.</h2>
          <JoinForm
            signedIn={Boolean(data.user && !error)}
            email={data.user?.email}
            action={joinAction}
          />
        </section>
      </div>
    </Shell>
  );
}
