import { Shell } from "@/components/shell";
export default function NotFound() {
  return (
    <Shell>
      <section className="panel error-panel">
        <h1>Record unavailable.</h1>
        <p>This record is not available in your active register.</p>
        <a className="text-link" href="/practice/calendar">
          Return to calendar
        </a>
        {/* A document request refreshes saved data and live authorization. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="text-link" href="/practice/register">
          Return to register
        </a>
      </section>
    </Shell>
  );
}
