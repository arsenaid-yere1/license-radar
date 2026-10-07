import type { CalendarEvent } from "@/lib/calendar/events";
import { monthDays, monthLabel } from "@/lib/calendar/dates";
import type { CalendarQuery } from "@/lib/calendar/query";
import { EventLink } from "./calendar-agenda";
const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function MonthCalendar({
  events,
  query,
  today,
}: {
  events: CalendarEvent[];
  query: CalendarQuery;
  today: string;
}) {
  return (
    <table className="month-calendar">
      <caption>{monthLabel(query.month)} renewal dates</caption>
      <thead>
        <tr>
          {weekdays.map((day) => (
            <th scope="col" key={day}>
              <abbr title={day}>{day.slice(0, 3)}</abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthDays(query.month).map((week, index) => (
          <tr key={index}>
            {week.map((date, column) => (
              <td
                key={column}
                className={date === today ? "today-cell" : undefined}
              >
                {date && (
                  <>
                    <time
                      className="calendar-day-number"
                      dateTime={date}
                      aria-current={date === today ? "date" : undefined}
                    >
                      <span className="calendar-weekday">
                        {weekdays[column].slice(0, 3)}
                      </span>{" "}
                      {Number(date.slice(8))}
                      {date === today && (
                        <span className="today-label"> Today</span>
                      )}
                    </time>
                    <ul>
                      {events
                        .filter((event) => event.date === date)
                        .map((event) => (
                          <li key={event.id}>
                            <EventLink event={event} query={query} />
                          </li>
                        ))}
                    </ul>
                  </>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
