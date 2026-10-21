import type { RenewalState } from "@/lib/renewals/state";
import { progressLabels } from "@/lib/renewals/state";
export function RenewalSummary({
  renewal,
  timezone = "UTC",
}: {
  renewal?: RenewalState;
  timezone?: string;
}) {
  if (!renewal) return <p className="hint">Refresh to see renewal progress.</p>;
  const workflow = renewal.workflow;
  return (
    <div className="renewal-summary">
      <span className={`renewal-status renewal-status-${workflow.status}`}>
        {progressLabels[workflow.status]}
      </span>
      {workflow.acknowledgedAt ? (
        <p className="hint">
          Reviewed{" "}
          <time dateTime={workflow.acknowledgedAt}>
            {new Intl.DateTimeFormat("en-US", {
              timeZone: timezone,
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(workflow.acknowledgedAt))}
          </time>{" "}
          ({timezone})
        </p>
      ) : (
        <p className="hint">Review not yet acknowledged.</p>
      )}
    </div>
  );
}
