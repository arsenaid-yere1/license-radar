"use client";
import { useState } from "react";
import { ClinicianForm } from "./clinician-form";
import { CredentialForm } from "./credential-form";
import {
  typeLabels,
  type Register,
  type RegisterAction,
  type RegisterState,
} from "@/lib/register/schema";
export function RegisterPanel({
  register,
  canEdit,
  action,
  clinicianKey,
  credentialKey,
}: {
  register: Register;
  canEdit: boolean;
  action: RegisterAction;
  clinicianKey: string;
  credentialKey: string;
}) {
  const [saved, setSaved] = useState<Register>({
    clinicians: [],
    credentials: [],
  });
  const clinicians = merge(register.clinicians, saved.clinicians),
    credentials = merge(register.credentials, saved.credentials);
  function onSaved(state: RegisterState) {
    setSaved((previous) => ({
      clinicians: state.clinician
        ? merge(previous.clinicians, [state.clinician])
        : previous.clinicians,
      credentials: state.credential
        ? merge(previous.credentials, [state.credential])
        : previous.credentials,
    }));
  }
  return (
    <>
      <p className="hint">Text reminders are not active yet.</p>
      {!canEdit && <p>You have read-only access to this register.</p>}
      <div className="register-layout">
        {canEdit && (
          <>
            <ClinicianForm
              action={action}
              requestKey={clinicianKey}
              onSaved={onSaved}
            />
            <CredentialForm
              action={action}
              requestKey={credentialKey}
              onSaved={onSaved}
              clinicians={clinicians}
            />
          </>
        )}
        <section className="panel">
          <h2>Clinicians</h2>
          {clinicians.length ? (
            <ul className="register-list" aria-label="Saved clinicians">
              {clinicians.map((clinician) => (
                <li key={clinician.id}>
                  {clinician.name}{" "}
                  <span className="hint">· {clinician.id.slice(-6)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No clinicians added yet.</p>
          )}
        </section>
        <section className="panel">
          <h2>Renewal records</h2>
          {credentials.length ? (
            <ul className="register-list" aria-label="Saved records">
              {credentials.map((record) => (
                <li key={record.id}>
                  <article>
                    <h3>{record.title}</h3>
                    <p>
                      {typeLabels[record.type]} · {record.id.slice(-6)}
                    </p>
                    <p>
                      Owner: {record.owner_name} (
                      {record.owner_kind === "practice"
                        ? "practice"
                        : "clinician"}
                      )
                    </p>
                    {record.type === "malpractice_policy" &&
                      record.owner_kind === "practice" && (
                        <p>
                          {record.covered_clinicians.length
                            ? `Covers: ${record.covered_clinicians.map((person) => person.name).join(", ")}`
                            : "No covered clinicians selected"}
                        </p>
                      )}
                    <span className="saved-label">Dates not entered</span>
                  </article>
                </li>
              ))}
            </ul>
          ) : (
            <p>No renewal records added yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
function merge<T extends { id: string }>(current: T[], saved: T[]): T[] {
  const merged = new Map(current.map((value) => [value.id, value]));
  for (const value of saved)
    if (!merged.has(value.id)) merged.set(value.id, value);
  return Array.from(merged.values());
}
