"use client";
import { Field, errorAttributes } from "@/components/register/create-form";
import { detailLabels } from "@/lib/register/dates";
import type { RenewalCredential } from "@/lib/renewals/schema";
export function CompletionFields({
  record,
  errors = {},
  today,
  timezone,
}: {
  record: RenewalCredential;
  errors?: Record<string, string>;
  today?: string;
  timezone: string;
}) {
  return (
    <>
      <p>
        Record this renewal only after your practice has confirmed it. The
        previous dates and history will be retained.
      </p>
      <p className="hint">
        {today ? `Today: ${today} · ` : ""}Practice timezone: {timezone}. New
        dates must be after today.
      </p>
      <Field
        id="renewal-new-end"
        label={`New ${detailLabels[record.type].end.toLowerCase()}`}
        error={errors.endDate}
      >
        <input
          id="renewal-new-end"
          name="endDate"
          type="date"
          defaultValue=""
          {...errorAttributes("renewal-new-end", errors.endDate)}
        />
      </Field>
      <Field
        id="renewal-new-action"
        label="New earlier action deadline (optional)"
        error={errors.actionDeadline}
      >
        <input
          id="renewal-new-action"
          name="actionDeadline"
          type="date"
          defaultValue=""
          {...errorAttributes("renewal-new-action", errors.actionDeadline)}
        />
        <p className="hint">
          Leave blank when there is no new earlier deadline. The previous
          deadline will not carry forward.
        </p>
      </Field>
      <label className="sms-choice">
        <input
          name="confirmed"
          type="checkbox"
          value="true"
          {...errorAttributes("renewal-confirmed", errors.confirmed)}
        />
        I have confirmed this renewal and its new dates.
      </label>
      {errors.confirmed && (
        <p id="renewal-confirmed-error" className="error">
          Confirm the renewal before saving.
        </p>
      )}
      <p className="hint">
        Schedule updates when the reminder worker next checks. Completion does
        not activate email or text sending.
      </p>
    </>
  );
}
