import type { CalendarEvent } from "@/lib/calendar/events";
import { calendarHref, type CalendarQuery } from "@/lib/calendar/query";
import { monthLabel } from "@/lib/calendar/dates";
import { detailLabels } from "@/lib/register/dates";
import { typeLabels } from "@/lib/register/schema";
import { DateText } from "@/components/register/record-dates";
export function EventLink({
  event,
  query,
}: {
  event: CalendarEvent;
  query: CalendarQuery;
}) {
  const record = event.record;
  return (
    <a
      className="calendar-event"
      href={calendarHref(query, `/practice/register/${record.id}`)}
    >
      <strong>{record.title}</strong>
      <span>
        {record.owner_name} · {typeLabels[record.type]}
      </span>
      <span className="calendar-purpose">
        {event.purpose}
        {event.tracking && (
          <span className="tracking-marker"> · Tracking date</span>
        )}
      </span>
      {record.current_cycle.end_date === null && (
        <span>{detailLabels[record.type].end} unknown</span>
      )}
    </a>
  );
}
export function CalendarAgenda({
  events,
  query,
}: {
  events: CalendarEvent[];
  query: CalendarQuery;
}) {
  const days = [...new Set(events.map((event) => event.date))];
  return (
    <section
      className="calendar-agenda"
      aria-label={`${monthLabel(query.month)} agenda`}
    >
      {days.map((date) => (
        <section className="agenda-day" key={date}>
          <h3>
            <DateText date={date} />
          </h3>
          <ul>
            {events
              .filter((event) => event.date === date)
              .map((event) => (
                <li key={event.id}>
                  <EventLink event={event} query={query} />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
