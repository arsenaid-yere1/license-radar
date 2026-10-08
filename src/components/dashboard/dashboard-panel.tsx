import type { DashboardEntry, DashboardSummary } from "@/lib/dashboard/summary";
import { typeLabels } from "@/lib/register/schema";
import { RecordDates } from "@/components/register/record-dates";
const sections = [
  {
    key: "pastDue",
    id: "past-due",
    title: "Past due",
    hint: "Tracking dates before today. Review the entered date purpose.",
    empty: "No past-due tracking dates.",
  },
  {
    key: "dueWithin60",
    id: "due-within-60",
    title: "Due within 60 days",
    hint: "Includes today and the next 60 calendar days.",
    empty: "No tracking dates due within 60 days.",
  },
  {
    key: "missingEnd",
    id: "missing-end",
    title: "Missing expiration / coverage end",
    hint: "These records need an expiration or coverage end date. Records with an entered action deadline may also appear in the dated lists above. Counts are not additive.",
    empty: "No records with missing expiration or coverage end.",
  },
] as const;
export function DashboardPanel({ summary }: { summary: DashboardSummary }) {
  const active =
    summary.pastDue.length +
    summary.dueWithin60.length +
    summary.later.length +
    summary.undated.length;
  return (
    <div className="dashboard-workspace">
      <nav className="dashboard-counts" aria-label="Renewal priorities">
        {sections.map((section) => (
          <a
            className={`dashboard-count dashboard-count-${section.id}`}
            key={section.key}
            href={`#${section.id}`}
          >
            <strong>{summary[section.key].length}</strong>{" "}
            <span>{section.title}</span>
          </a>
        ))}
      </nav>
      {active === 0 && (
        <p className="dashboard-empty">No active renewal records yet.</p>
      )}
      {sections.map((section) => (
        <section
          className="dashboard-section"
          key={section.key}
          aria-labelledby={section.id}
        >
          <div className="dashboard-section-heading">
            <h2 id={section.id} tabIndex={-1}>
              {section.title}
            </h2>
            <p className="hint">{section.hint}</p>
          </div>
          {summary[section.key].length ? (
            <ul className="dashboard-list">
              {summary[section.key].map((entry) => (
                <li
                  key={entry.record.id}
                  id={`${section.id}-${entry.record.id}`}
                >
                  <DashboardRow entry={entry} />
                </li>
              ))}
            </ul>
          ) : (
            <p>{section.empty}</p>
          )}
        </section>
      ))}
      <aside className="dashboard-later" aria-label="Later tracking dates">
        <p>
          {summary.later.length}{" "}
          {summary.later.length === 1 ? "record" : "records"} with a tracking
          date more than 60 days away.
        </p>
        {/* Document navigation checks current access and data. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/practice/register">Review all records</a>
        {" · "}
        <a href="/practice/calendar">Plan ahead in calendar</a>
      </aside>
    </div>
  );
}
function urgencyLabel(entry: DashboardEntry): string {
  if (entry.days === null) return "Dates not entered";
  if (entry.days < 0)
    return `Past due · ${-entry.days} ${entry.days === -1 ? "day" : "days"} past due`;
  if (entry.days === 0) return "Due today";
  return `Due in ${entry.days} ${entry.days === 1 ? "day" : "days"}`;
}
function DashboardRow({ entry }: { entry: DashboardEntry }) {
  const record = entry.record;
  return (
    <article className="dashboard-record">
      <div className="dashboard-record-summary">
        <span className={`urgency-badge urgency-${entry.urgency}`}>
          {urgencyLabel(entry)}
        </span>
        <h3>
          <a href={`/practice/register/${record.id}?from=dashboard`}>
            {record.title}
          </a>
        </h3>
        <p>
          {typeLabels[record.type]} · Owner: {record.owner_name} (
          {record.owner_kind})
        </p>
        {record.covered_clinicians.length > 0 && (
          <p>
            Covers: {record.covered_clinicians.map((p) => p.name).join(", ")}
          </p>
        )}
      </div>
      <div className="dashboard-record-dates">
        <RecordDates record={record} />
      </div>
    </article>
  );
}
