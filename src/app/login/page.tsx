import { EmailCodeForm } from "@/components/auth/email-code-form";
import { Shell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default function Login() {
  return (
    <Shell>
      <div className="split-layout">
        <section className="intro">
          <span className="eyebrow">Practice essentials / 01</span>
          <h1>
            More clarity.
            <br />
            <em>Fewer surprises.</em>
          </h1>
          <p className="lede">
            Start with one home for your practice. A calmer approach to renewal
            dates begins here.
          </p>
          <div className="intro-line">
            <span aria-hidden="true">01 —</span> Sign in to set up your practice
          </div>
        </section>
        <section className="panel">
          <span className="eyebrow">Welcome to Radar</span>
          <h2>Make yourself at home.</h2>
          <p>Sign in with your email. We’ll send a one-time code.</p>
          <EmailCodeForm />
        </section>
      </div>
    </Shell>
  );
}
