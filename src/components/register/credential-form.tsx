"use client";
import { useId, useState } from "react";
import { CreateForm, Field, errorAttributes } from "./create-form";
import {
  typeLabels,
  type Clinician,
  type RegisterAction,
  type RegisterState,
} from "@/lib/register/schema";
export function CredentialForm({
  action,
  requestKey,
  onSaved,
  clinicians,
}: {
  action: RegisterAction;
  requestKey: string;
  onSaved: (state: RegisterState) => void;
  clinicians: Clinician[];
}) {
  return (
    <section className="panel">
      <h2>Add a renewal record</h2>
      <p>Choose who owns the record. Dates will be entered in the next step.</p>
      <CreateForm
        intent="credential"
        requestKey={requestKey}
        action={action}
        onSaved={onSaved}
      >
        {(errors) => (
          <CredentialFields clinicians={clinicians} errors={errors} />
        )}
      </CreateForm>
    </section>
  );
}
function CredentialFields({
  clinicians,
  errors,
}: {
  clinicians: Clinician[];
  errors: Record<string, string>;
}) {
  const id = useId();
  const [type, setType] = useState<keyof typeof typeLabels>("state_license");
  const [owner, setOwner] = useState("practice");
  const [person, setPerson] = useState("");
  const [coverage, setCoverage] = useState<string[]>([]);
  const covered = type === "malpractice_policy" && owner === "practice";
  return (
    <>
      <Field id={`${id}-title`} label="Record title" error={errors.title}>
        <input
          id={`${id}-title`}
          name="title"
          required
          {...errorAttributes(`${id}-title`, errors.title)}
        />
      </Field>
      <Field id={`${id}-type`} label="Record type" error={errors.type}>
        <select
          id={`${id}-type`}
          name="type"
          value={type}
          onChange={(event) => {
            setType(event.target.value as keyof typeof typeLabels);
            setCoverage([]);
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
      <Field id={`${id}-owner`} label="Record owner" error={errors.ownerKind}>
        <select
          id={`${id}-owner`}
          name="ownerKind"
          value={owner}
          onChange={(event) => {
            setOwner(event.target.value);
            setPerson("");
            setCoverage([]);
          }}
          {...errorAttributes(`${id}-owner`, errors.ownerKind)}
        >
          <option value="practice">This practice</option>
          <option value="clinician">A clinician</option>
        </select>
      </Field>
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
