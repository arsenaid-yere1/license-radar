import { z } from "zod";
import { isCredentialDate } from "./dates";
import { versionSchema } from "@/lib/team/schema";
const uuid = z.uuid().transform((value) => value.toLowerCase());
const name = z
  .string()
  .trim()
  .refine((value) => !/[\uD800-\uDFFF\u0000]/u.test(value), "Use valid text.")
  .refine(
    (value) => Array.from(value).length >= 1 && Array.from(value).length <= 120,
    "Use 1 to 120 characters.",
  );
const optionalName = z
  .string()
  .trim()
  .refine((value) => !/[\uD800-\uDFFF\u0000]/u.test(value), "Use valid text.")
  .refine(
    (value) => Array.from(value).length <= 120,
    "Use 1 to 120 characters.",
  )
  .nullish()
  .transform((value) => value || null);
const date = z
  .string()
  .refine(isCredentialDate, "Enter a valid date (YYYY-MM-DD).");
const optionalDate = z
  .union([z.literal(""), date])
  .nullish()
  .transform((value) => value || null);
const orderedDates = (end: string | null, action: string | null) =>
  !end || !action || action < end;
const type = z.enum([
  "state_license",
  "dea_registration",
  "malpractice_policy",
]);
const owner = z.enum(["clinician", "practice"]);
export const typeLabels = {
  state_license: "State license",
  dea_registration: "DEA registration",
  malpractice_policy: "Malpractice policy",
} as const;
const credentialInput = z
  .strictObject({
    requestId: uuid,
    title: name,
    issuer: optionalName,
    jurisdiction: optionalName,
    endDate: optionalDate,
    actionDeadline: optionalDate,
    type,
    ownerKind: owner,
    ownerClinicianId: uuid.optional(),
    coveredClinicianIds: z.array(uuid).default([]),
  })
  .refine(
    (value) =>
      (value.ownerKind === "clinician") === Boolean(value.ownerClinicianId),
    {
      path: ["ownerClinicianId"],
      message: "Choose a clinician for clinician ownership only.",
    },
  )
  .refine(
    (value) =>
      !value.coveredClinicianIds.length ||
      (value.type === "malpractice_policy" && value.ownerKind === "practice"),
    {
      path: ["coveredClinicianIds"],
      message:
        "Coverage is available only for a practice-owned malpractice policy.",
    },
  )
  .refine(
    (value) =>
      new Set(value.coveredClinicianIds).size ===
      value.coveredClinicianIds.length,
    {
      path: ["coveredClinicianIds"],
      message: "Choose each covered clinician once.",
    },
  )
  .refine((value) => orderedDates(value.endDate, value.actionDeadline), {
    path: ["actionDeadline"],
    message: "The action deadline must be earlier than the end date.",
  });
const sortedCredentialInput = credentialInput
  .safeExtend({ intent: z.literal("credential") })
  .transform((value) => ({
    ...value,
    coveredClinicianIds: value.coveredClinicianIds.sort(),
  }));
export const registerInputSchema = z.lazy(() =>
  z.discriminatedUnion("intent", [
    z.strictObject({ intent: z.literal("clinician"), requestId: uuid, name }),
    sortedCredentialInput,
  ]),
);
const person = z.object({ id: uuid, name });
export const clinicianSchema = person.extend({ version: versionSchema });
export const credentialSchema = z
  .object({
    id: uuid,
    title: name,
    type,
    owner_kind: owner,
    owner_clinician_id: uuid.nullable(),
    owner_name: name,
    version: versionSchema,
    covered_clinicians: z.array(person),
    issuer: name.nullable(),
    jurisdiction: name.nullable(),
    current_cycle: z
      .object({
        id: uuid,
        cycle_number: z.literal(1),
        date_revision: versionSchema,
        end_date: date.nullable(),
        action_deadline: date.nullable(),
      })
      .refine((value) => orderedDates(value.end_date, value.action_deadline)),
  })
  .refine(
    (value) =>
      (value.owner_kind === "clinician") ===
      (value.owner_clinician_id !== null),
  )
  .refine(
    (value) =>
      !value.covered_clinicians.length ||
      (value.type === "malpractice_policy" && value.owner_kind === "practice"),
  );
export const registerSchema = z.object({
  clinicians: z.array(clinicianSchema),
  credentials: z.array(credentialSchema),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;
export type Clinician = z.infer<typeof clinicianSchema>;
export type Credential = z.infer<typeof credentialSchema>;
export type Register = z.infer<typeof registerSchema>;
export type RegisterResult =
  | { status: "success"; clinician: Clinician }
  | { status: "success"; credential: Credential }
  | { status: "invalid"; errors?: Record<string, string> }
  | {
      status:
        | "invalid-reference"
        | "request-conflict"
        | "forbidden"
        | "unavailable"
        | "auth-required";
    };
export type RegisterState = {
  status: "idle" | RegisterResult["status"];
  message?: string;
  errors?: Record<string, string>;
  clinician?: Clinician;
  credential?: Credential;
};
export type RegisterAction = (
  state: RegisterState,
  form: FormData,
) => Promise<RegisterState>;

const expectedVersion = z.preprocess(
  (value) =>
    typeof value === "string" && /^[1-9][0-9]*$/.test(value)
      ? Number(value)
      : value,
  versionSchema,
);
const changeTokens = {
  requestId: uuid,
  id: uuid,
  expectedVersion,
  expectedCycleId: uuid,
  expectedDateRevision: expectedVersion,
};
const maintenanceUpdateInput = credentialInput
  .safeExtend({ ...changeTokens, intent: z.literal("update") })
  .transform((value) => ({
    ...value,
    coveredClinicianIds: value.coveredClinicianIds.sort(),
  }));
const maintenanceArchiveInput = z.strictObject({
  ...changeTokens,
  intent: z.literal("archive"),
});
export const maintenanceInputSchema = z.lazy(() =>
  z.discriminatedUnion("intent", [
    maintenanceUpdateInput,
    maintenanceArchiveInput,
  ]),
);
export const maintenanceCredentialSchema = credentialSchema.safeExtend({
  archived_at: z.iso.datetime({ offset: true }).nullable(),
});
const listedCredential = maintenanceCredentialSchema
  .safeExtend({ suspected_duplicate_ids: z.array(uuid) })
  .refine(
    (value) =>
      !value.suspected_duplicate_ids.includes(value.id) &&
      new Set(value.suspected_duplicate_ids).size ===
        value.suspected_duplicate_ids.length &&
      (!value.archived_at || value.suspected_duplicate_ids.length === 0),
  );
export const maintenanceRegisterSchema = z.object({
  clinicians: z.array(clinicianSchema),
  credentials: z.array(listedCredential),
});
export type MaintenanceInput = z.infer<typeof maintenanceInputSchema>;
export type MaintenanceCredential = z.infer<typeof maintenanceCredentialSchema>;
export type MaintenanceRegister = z.infer<typeof maintenanceRegisterSchema>;
export type MaintenanceResult =
  | { status: "success"; changed: boolean; credential: MaintenanceCredential }
  | { status: "conflict"; credential: MaintenanceCredential }
  | { status: "invalid"; errors?: Record<string, string> }
  | {
      status:
        | "invalid-reference"
        | "request-conflict"
        | "archived"
        | "not-found"
        | "forbidden"
        | "unavailable"
        | "auth-required";
    };
export type MaintenanceState = {
  status: "idle" | MaintenanceResult["status"];
  message?: string;
  errors?: Record<string, string>;
  credential?: MaintenanceCredential;
  changed?: boolean;
};
export type MaintenanceAction = (
  state: MaintenanceState,
  form: FormData,
) => Promise<MaintenanceState>;
