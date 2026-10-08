import Link from "next/link";
import { Shell } from "@/components/shell";
import { smsConfig } from "@/lib/sms/config";
export const dynamic = "force-dynamic";
export default function SmsInformation() {
  const support = smsConfig()?.supportEmail;
  return (
    <Shell>
      <article className="panel sms-information">
        <h1>SMS terms and privacy</h1>
        <p>
          License Renewal Radar offers requested phone verification texts and
          optional practice renewal reminder texts. Renewal reminder delivery is
          not active yet.
        </p>
        <h2>SMS terms</h2>
        <p>
          A verification request permits its verification text only. Renewal
          reminders require a separate choice for each practice and verified
          phone. Frequency varies with renewal dates. Message and data rates may
          apply. Carriers may delay or fail delivery; do not rely on texts as
          your only renewal record.
        </p>
        <p>
          Reply STOP to stop texts through the provider across practices using
          that phone. In this release, replying START does not restore local
          enrollment; same-number recovery is not available yet. You can
          withdraw reminder consent in practice settings at any time. In-app
          withdrawal applies to that practice. Reply HELP for provider help.
        </p>
        <h2>SMS privacy</h2>
        <p>
          We use your phone for verification and, after your separate consent,
          renewal reminders for your practice. Verification and consent records
          identify the practice, member, phone revision and disclosure you
          accepted. Provider opt-out records suppress that phone across
          practices using the same messaging service. Codes are submitted to the
          verification provider and are not retained in our enrollment records.
          Other practice members see enrollment readiness, not your phone or
          verification details.
        </p>
        <h2>Customer care</h2>
        {support ? (
          <p>
            Contact <a href={`mailto:${support}`}>{support}</a> for SMS help.
          </p>
        ) : (
          <p>
            Live text enrollment is unavailable until the operator provides a
            customer-care contact and reviews these terms and privacy
            information.
          </p>
        )}
        <p>
          <Link href="/practice/sms">My reminder texts</Link>
        </p>
      </article>
    </Shell>
  );
}
