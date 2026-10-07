import { typeLabels, type MaintenanceRegister } from "@/lib/register/schema";
import { projectCalendar } from "@/lib/calendar/events";
import { monthLabel, shiftMonth } from "@/lib/calendar/dates";
import { calendarHref, type CalendarQuery } from "@/lib/calendar/query";
import { MonthCalendar } from "./month-calendar";
import { CalendarAgenda } from "./calendar-agenda";
export function CalendarPanel({
  register,
  query,
  today,
}: {
  register: MaintenanceRegister;
  query: CalendarQuery;
  today: string;
}) {
  const active = register.credentials.filter(
      (record) => record.archived_at === null,
    ),
    { events, undated } = projectCalendar(register, query);
  const reset = {
    month: query.month,
    view: query.view,
    invalidFilters: false,
    notices: [],
  };
  return (
    <div className="calendar-workspace" data-view={query.view ?? "auto"}>
      <CalendarToolbar query={query} today={today} />
      <CalendarFilters register={register} query={query} />
      <a className="text-link" href={calendarHref(reset)}>
        Clear filters
      </a>
      {query.notices.includes("month") && (
        <p role="status">Month selection was invalid. Showing this month.</p>
      )}
      {query.notices.includes("view") && (
        <p role="status">View selection was invalid. Using the default view.</p>
      )}
      {query.invalidFilters ? (
        <p className="error" role="alert">
          Choose valid filters or clear them to see your dates.
        </p>
      ) : (
        <CalendarResults
          events={events}
          undated={undated}
          query={query}
          today={today}
          hasRecords={active.length > 0}
        />
      )}
    </div>
  );
}
function MonthNavigation({
  query,
  offset,
}: {
  query: CalendarQuery;
  offset: -1 | 1;
}) {
  const month = shiftMonth(query.month, offset);
  return month ? (
    <a href={calendarHref({ ...query, month })}>
      {offset === -1 ? "Previous month" : "Next month"}
    </a>
  ) : null;
}
function CalendarFilters({
  register,
  query,
}: {
  register: MaintenanceRegister;
  query: CalendarQuery;
}) {
  const jurisdictions = [
    ...new Set(
      register.credentials
        .filter((record) => record.archived_at === null)
        .map((record) =>
          record.jurisdiction === null
            ? "unknown"
            : `value:${record.jurisdiction}`,
        ),
    ),
  ].sort();
  const clinicianMissing =
      query.clinician &&
      query.clinician !== "practice" &&
      !register.clinicians.some((person) => person.id === query.clinician),
    jurisdictionMissing =
      query.jurisdiction && !jurisdictions.includes(query.jurisdiction);
  return (
    <form className="calendar-filters" action="/practice/calendar" method="get">
      <div>
        <label htmlFor="calendar-month">Month</label>
        <input
          id="calendar-month"
          type="month"
          name="month"
          defaultValue={query.month}
          min="0001-01"
          max="9999-12"
          required
        />
      </div>
      {query.view && <input type="hidden" name="view" value={query.view} />}
      <div>
        <label htmlFor="calendar-clinician">Clinician or practice</label>
        <select
          id="calendar-clinician"
          name="clinician"
          defaultValue={query.clinician ?? ""}
        >
          <option value="">All clinicians and practice</option>
          <option value="practice">Practice-owned records</option>
          {clinicianMissing && (
            <option value={query.clinician}>Clinician unavailable</option>
          )}
          {register.clinicians.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name} · {person.id.slice(-6)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="calendar-type">Credential type</label>
        <select id="calendar-type" name="type" defaultValue={query.type ?? ""}>
          <option value="">All types</option>
          {Object.entries(typeLabels).map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="calendar-jurisdiction">Jurisdiction</label>
        <select
          id="calendar-jurisdiction"
          name="jurisdiction"
          defaultValue={query.jurisdiction ?? ""}
        >
          <option value="">All jurisdictions</option>
          {jurisdictionMissing && (
            <option value={query.jurisdiction}>Jurisdiction unavailable</option>
          )}
          {jurisdictions.map((value) => (
            <option key={value} value={value}>
              {value === "unknown"
                ? "Jurisdiction not entered"
                : value.slice(6)}
            </option>
          ))}
        </select>
      </div>
      <button>Apply filters</button>
    </form>
  );
}

function CalendarToolbar({
  query,
  today,
}: {
  query: CalendarQuery;
  today: string;
}) {
  const label = monthLabel(query.month);
  return (
    <>
      <div className="calendar-toolbar">
        <div>
          <span className="eyebrow">The month ahead</span>
          <h2>{label}</h2>
        </div>
        <nav className="calendar-navigation" aria-label="Calendar navigation">
          {!query.invalidFilters && (
            <>
              <MonthNavigation query={query} offset={-1} />
              <a href={calendarHref({ ...query, month: today.slice(0, 7) })}>
                This month
              </a>
              <MonthNavigation query={query} offset={1} />
            </>
          )}
        </nav>
      </div>
      <div className="calendar-actions">
        <nav aria-label="Calendar views">
          {!query.invalidFilters && (
            <>
              <a
                href={calendarHref({ ...query, view: "month" })}
                aria-current={query.view === "month" ? "page" : undefined}
              >
                Month view
              </a>
              <a
                href={calendarHref({ ...query, view: "agenda" })}
                aria-current={query.view === "agenda" ? "page" : undefined}
              >
                Agenda view
              </a>
            </>
          )}
        </nav>
        {/* A document request refreshes saved data and live authorization. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/practice/register">Renewal register</a>
        {!query.invalidFilters && (
          <a href={calendarHref(query)}>Refresh records</a>
        )}
      </div>
    </>
  );
}
function CalendarResults({
  events,
  undated,
  query,
  today,
  hasRecords,
}: {
  events: ReturnType<typeof projectCalendar>["events"];
  undated: ReturnType<typeof projectCalendar>["undated"];
  query: CalendarQuery;
  today: string;
  hasRecords: boolean;
}) {
  return (
    <>
      {!hasRecords ? (
        <p>No active renewal records yet.</p>
      ) : (
        !events.length && <p>No matching dates this month.</p>
      )}
      <div className="calendar-month-view">
        <MonthCalendar events={events} query={query} today={today} />
      </div>
      <div className="calendar-agenda-view">
        <CalendarAgenda events={events} query={query} />
      </div>
      <section className="undated-records" aria-label="Dates not entered">
        <h3>Dates not entered</h3>
        <p className="hint">
          These records have no entered dates. They stay visible whichever month
          you view.
        </p>
        {undated.length ? (
          <ul>
            {undated.map((record) => (
              <li key={record.id}>
                <a
                  href={calendarHref(query, `/practice/register/${record.id}`)}
                >
                  {record.title}
                </a>
                <span>
                  {record.owner_name} · {typeLabels[record.type]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No matching records with missing dates.</p>
        )}
      </section>
    </>
  );
}
