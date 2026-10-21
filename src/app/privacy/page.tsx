import Link from "next/link";
import { Shell } from "@/components/shell";
export default function Privacy() {
  return (
    <Shell>
      <article className="panel public-information">
        <h1>Privacy</h1>
        <p>
          Updated October 15, 2026. This notice describes the License Radar
          personal pilot and its Gmail reminder integration.
        </p>
        <h2>Information we use</h2>
        <p>
          License Radar stores the email used to sign in, practice membership
          and the credential and renewal information entered by authorized
          members. Reminder history records who a reminder was intended for, its
          scheduling and submission status, and provider message identifiers.
        </p>
        <p>Session cookies keep you signed in to the application.</p>
        <p>
          For the Gmail integration, Google provides the authorized
          account&apos;s email, verified-email status and account identifier.
          The operator stores OAuth credentials so the server can send reminders
          without asking for a Google password. License Radar requests sending
          and basic identity permissions. It does not request permission to read
          the inbox, contacts, existing messages or attachments.
        </p>
        <h2>How information is used and shared</h2>
        <p>
          Google account information is used to verify the authorized sender.
          The server sends reminder content and its approved recipient address
          to Google to submit email through Gmail. The personal pilot restricts
          sending to the same approved Gmail account.
        </p>
        <p>
          Vercel hosts the application and protected server configuration.
          Supabase stores sign-in, practice and reminder records. These services
          process information needed to run the app. The application does not
          sell Google user data, use it for advertising, or send it to AI models
          for training. Access to private application records is restricted to
          authorized practice members and operators maintaining the service.
        </p>
        <h2>Storage and retention</h2>
        <p>
          Gmail credentials are kept in protected server configuration and
          private operator setup files; they are not sent to the browser. Access
          tokens are held temporarily during a reminder-worker run. The database
          keeps account identity binding and reminder history. This describes
          the application&apos;s controls and is not a guarantee against every
          security risk.
        </p>
        <p>
          Practice records and reminder history remain until removed by the
          operator. Archiving a record does not delete its reminder history.
          Removing Google&apos;s authorization stops future authorized sends but
          does not delete existing app records or retract email already
          submitted to Gmail. Stored setup credentials must also be removed by
          the operator when disconnecting the integration.
        </p>
        <h2>Your choices and contact</h2>
        <p>
          You can turn off reminder email in the app. The operator can disable
          Gmail sending and its scheduler. You can remove License Radar&apos;s
          Google access from your Google Account connections at{" "}
          <a href="https://myaccount.google.com/connections">
            https://myaccount.google.com/connections
          </a>
          .
        </p>
        <p>
          For questions or a request to remove stored information, contact{" "}
          <a href="mailto:arsen.yere1@gmail.com">arsen.yere1@gmail.com</a>.
          Requests are handled by the operator; the pilot does not offer an
          automated data-deletion screen.
        </p>
        <nav className="renewal-navigation">
          <Link href="/about">About License Radar</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </article>
    </Shell>
  );
}
