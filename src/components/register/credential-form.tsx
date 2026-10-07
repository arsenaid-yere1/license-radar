"use client";
import { CreateForm } from "./create-form";
import { CredentialFields } from "./credential-fields";
import type {
  Clinician,
  RegisterAction,
  RegisterState,
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
      <p>Choose who owns the record. Enter dates from your records.</p>
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
