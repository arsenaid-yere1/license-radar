"use client";
import { useId } from "react";
import { CreateForm, Field, errorAttributes } from "./create-form";
import type { RegisterAction, RegisterState } from "@/lib/register/schema";
export function ClinicianForm({
  action,
  requestKey,
  onSaved,
}: {
  action: RegisterAction;
  requestKey: string;
  onSaved: (state: RegisterState) => void;
}) {
  const id = useId();
  return (
    <section className="panel">
      <h2>Add a clinician</h2>
      <p>
        A clinician is a person whose renewals you track. Adding one does not
        create staff access.
      </p>
      <CreateForm
        intent="clinician"
        requestKey={requestKey}
        action={action}
        onSaved={onSaved}
      >
        {(errors) => (
          <Field id={id} label="Clinician name" error={errors.name}>
            <input
              id={id}
              name="name"
              required
              {...errorAttributes(id, errors.name)}
            />
          </Field>
        )}
      </CreateForm>
    </section>
  );
}
