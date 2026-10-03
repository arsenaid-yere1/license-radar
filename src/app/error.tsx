"use client";
import { Shell } from "@/components/shell";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <Shell>
      <section className="panel error-panel">
        <h1>A brief interruption.</h1>
        <p role="alert">We could not complete this request. Try again.</p>
        <button onClick={reset}>Try again</button>
        <a href="/login" className="text-link">
          Return to sign in
        </a>
      </section>
    </Shell>
  );
}
