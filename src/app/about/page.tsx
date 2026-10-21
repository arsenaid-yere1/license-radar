import Link from "next/link";
import { Shell } from "@/components/shell";
export default function About() {
  return (
    <Shell>
      <article className="panel public-information">
        <h1>License Radar</h1>
        <p className="lede">One place to track practice renewal dates.</p>
        <p>
          License Radar helps a practice keep its credential records, renewal
          dates and renewal progress together. Authorized practice members can
          review records and reminder history after signing in.
        </p>
        <p>
          The personal Gmail pilot sends renewal reminders from the
          operator&apos;s authorized Gmail account to the same approved account.
          Google access is used to verify the sender and send reminder emails.
          License Radar does not request permission to read your inbox.
        </p>
        <p>
          Gmail acceptance is shown as accepted, with delivery unconfirmed. The
          Gmail pilot does not automatically resend reminders or check mailbox
          delivery.
        </p>
        <nav className="renewal-navigation">
          <Link href="/privacy">Privacy</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </article>
    </Shell>
  );
}
