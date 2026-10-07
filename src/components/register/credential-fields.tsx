"use client";
import { useId, useState } from "react";
import { detailLabels } from "@/lib/register/dates";
import { Field, errorAttributes } from "./create-form";
import {
  typeLabels,
  type Clinician,
  type Credential,
} from "@/lib/register/schema";
export function CredentialFields({
  clinicians,
  errors,
  record,
}: {
  clinicians: Clinician[];
  errors: Record<string, string>;
  record?: Credential;
}) {
  const id = useId();
  const initial = initialFields(record);
  const [type, setType] = useState(initial.type),
    [owner, setOwner] = useState(initial.owner),
    [person, setPerson] = useState(initial.person),
    [coverage, setCoverage] = useState(initial.coverage),
    [details, setDetails] = useState(initial.details);
  const [pendingType, setPendingType] = useState<
    keyof typeof typeLabels | null
  >(null);
  function changeType(next: keyof typeof typeLabels) {
    setType(next);
    setCoverage([]);
    setDetails({
      issuer: "",
      jurisdiction: "",
      endDate: "",
      actionDeadline: "",
    });
  }
  const covered = type === "malpractice_policy" && owner === "practice";
  return (
    <>
      <Field id={`${id}-title`} label="Record title" error={errors.title}>
        <input
          id={`${id}-title`}
          name="title"
          required
          defaultValue={initial.title}
          {...errorAttributes(`${id}-title`, errors.title)}
        />
      </Field>
      <Field id={`${id}-type`} label="Record type" error={errors.type}>
        <select
          id={`${id}-type`}
          name="type"
          value={type}
          onChange={(event) => {
            const next = event.target.value as keyof typeof typeLabels;
            if (
              record &&
              (Object.values(details).some(Boolean) || coverage.length)
            )
              setPendingType(next);
            else changeType(next);
          }}
          {...errorAttributes(`${id}-type`, errors.type)}
        >
          {Object.entries(typeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {pendingType && (
        <div role="group" aria-label="Review type change">
          <p>
            Changing type clears issuer, jurisdiction, dates, and covered
            clinicians from this draft.
          </p>
          <button
            type="button"
            onClick={() => {
              changeType(pendingType);
              setPendingType(null);
            }}
          >
            Confirm type change
          </button>
          <button type="button" onClick={() => setPendingType(null)}>
            Keep current type
          </button>
        </div>
      )}
      <Field id={`${id}-owner`} label="Record owner" error={errors.ownerKind}>
        <select
          id={`${id}-owner`}
          name="ownerKind"
          value={owner}
          onChange={(event) => {
            setOwner(event.target.value as "practice" | "clinician");
            setPerson("");
            setCoverage([]);
          }}
          {...errorAttributes(`${id}-owner`, errors.ownerKind)}
        >
          <option value="practice">This practice</option>
          <option value="clinician">A clinician</option>
        </select>
      </Field>
      <div key={type}>
        {(["issuer", "jurisdiction"] as const).map((field) => (
          <Field
            key={field}
            id={`${id}-${field}`}
            label={`${detailLabels[type][field]} (optional)`}
            error={errors[field]}
          >
            <input
              id={`${id}-${field}`}
              name={field}
              value={details[field]}
              onChange={(event) =>
                setDetails((previous) => ({
                  ...previous,
                  [field]: event.target.value,
                }))
              }
              {...errorAttributes(`${id}-${field}`, errors[field])}
            />
          </Field>
        ))}
        <p className="hint">
          Leave either date blank if it is unknown. An earlier action deadline
          is the date you need to act, and must be before the expiration or
          coverage end when both are known.
        </p>
        {(["endDate", "actionDeadline"] as const).map((field) => (
          <Field
            key={field}
            id={`${id}-${field}`}
            label={
              field === "endDate"
                ? detailLabels[type].end
                : "Earlier action deadline"
            }
            error={errors[field]}
          >
            <input
              id={`${id}-${field}`}
              name={field}
              value={details[field]}
              onChange={(event) =>
                setDetails((previous) => ({
                  ...previous,
                  [field]: event.target.value,
                }))
              }
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              {...errorAttributes(`${id}-${field}`, errors[field])}
            />
          </Field>
        ))}
      </div>
      {owner === "clinician" && (
        <Field
          id={`${id}-person`}
          label="Owning clinician"
          error={errors.ownerClinicianId}
        >
          <select
            id={`${id}-person`}
            name="ownerClinicianId"
            required
            value={person}
            onChange={(event) => setPerson(event.target.value)}
            {...errorAttributes(`${id}-person`, errors.ownerClinicianId)}
          >
            <option value="">Choose a saved clinician</option>
            {clinicians.map((clinician) => (
              <option key={clinician.id} value={clinician.id}>
                {clinician.name} · {clinician.id.slice(-6)}
              </option>
            ))}
          </select>
          {!clinicians.length && <p className="hint">Add a clinician first.</p>}
        </Field>
      )}
      {covered && (
        <fieldset
          className="coverage-field"
          {...errorAttributes(`${id}-coverage`, errors.coveredClinicianIds)}
        >
          <legend>Covered clinicians (optional)</legend>
          <p className="hint">
            One shared policy can cover several clinicians.
          </p>
          {clinicians.map((clinician) => (
            <label key={clinician.id} className="coverage-choice">
              <input
                type="checkbox"
                name="coveredClinicianIds"
                value={clinician.id}
                checked={coverage.includes(clinician.id)}
                onChange={(event) =>
                  setCoverage(
                    event.target.checked
                      ? [...coverage, clinician.id]
                      : coverage.filter((value) => value !== clinician.id),
                  )
                }
              />
              <span>
                {clinician.name} · {clinician.id.slice(-6)}
              </span>
            </label>
          ))}
          {errors.coveredClinicianIds && (
            <p id={`${id}-coverage-error`} className="error">
              {errors.coveredClinicianIds}
            </p>
          )}
        </fieldset>
      )}
    </>
  );
}

function initialFields(record?: Credential) {
  if (!record)
    return {
      title: "",
      type: "state_license" as Credential["type"],
      owner: "practice" as Credential["owner_kind"],
      person: "",
      coverage: [] as string[],
      details: {
        issuer: "",
        jurisdiction: "",
        endDate: "",
        actionDeadline: "",
      },
    };
  return {
    title: record.title,
    type: record.type,
    owner: record.owner_kind,
    person: record.owner_clinician_id ?? "",
    coverage: record.covered_clinicians.map((person) => person.id),
    details: {
      issuer: record.issuer ?? "",
      jurisdiction: record.jurisdiction ?? "",
      endDate: record.current_cycle.end_date ?? "",
      actionDeadline: record.current_cycle.action_deadline ?? "",
    },
  };
}
