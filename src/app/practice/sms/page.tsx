import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { getMyEnrollment } from "@/lib/sms/repository";
import { smsConfig } from "@/lib/sms/config";
import { smsStorageConfigured } from "@/lib/sms/privileged-repository";
import { EnrollmentPanel } from "@/components/sms/enrollment-panel";
import { Shell } from "@/components/shell";
import { SignOutForm } from "@/components/auth/sign-out-form";
import { smsAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function SmsEnrollment() {
  const { client } = await requireUser();
  const access = await getPracticeAccess(client);
  if (access.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  if (!access.access) redirect("/onboarding/practice");
  const result = await getMyEnrollment(client, access.access.practice.id);
  if (result.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  return (
    <Shell action={<SignOutForm />}>
      <div className="split-layout">
        <section className="intro">
          <span className="eyebrow">Practice essentials / Reminder texts</span>
          <h1>
            Your phone.
            <br />
            <em>Your choice.</em>
          </h1>
          <p className="lede">
            Verify your own phone, then choose separately whether to receive
            renewal reminders for {access.access.practice.name}.
          </p>
          <p className="hint">
            Enrollment is personal. Being selected as a recipient does not
            verify your phone or give consent. Renewal texts are not active yet.
          </p>
          <Link className="text-link" href="/practice">
            Practice settings
          </Link>
        </section>
        <EnrollmentPanel
          enrollment={result.enrollment}
          configured={Boolean(smsConfig()) && smsStorageConfigured()}
          practiceName={access.access.practice.name}
          action={smsAction}
        />
      </div>
    </Shell>
  );
}
