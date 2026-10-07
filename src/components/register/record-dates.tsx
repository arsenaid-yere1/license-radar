import {
  detailLabels,
  formatCredentialDate,
  trackingDate,
} from "@/lib/register/dates";
import type { Credential } from "@/lib/register/schema";
export function RecordDates({ record }: { record: Credential }) {
  const labels = detailLabels[record.type];
  const cycle = record.current_cycle;
  const tracking = trackingDate(
    cycle.end_date,
    cycle.action_deadline,
    record.type,
  );
  return (
    <>
      {record.issuer && (
        <p>
          {labels.issuer}: {record.issuer}
        </p>
      )}
      {record.jurisdiction && (
        <p>
          {labels.jurisdiction}: {record.jurisdiction}
        </p>
      )}
      <p>
        {cycle.end_date ? (
          <>
            {labels.end}: <DateText date={cycle.end_date} />
          </>
        ) : (
          `${labels.end} unknown`
        )}
      </p>
      {cycle.action_deadline && (
        <p>
          Earlier action deadline: <DateText date={cycle.action_deadline} />
        </p>
      )}
      {tracking ? (
        <p className="saved-label">
          Tracking date: <DateText date={tracking.date} /> ({tracking.purpose})
        </p>
      ) : (
        <span className="saved-label">Dates not entered</span>
      )}
    </>
  );
}
export function DateText({ date }: { date: string }) {
  return <time dateTime={date}>{formatCredentialDate(date)}</time>;
}
