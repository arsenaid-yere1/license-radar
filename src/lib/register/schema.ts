import { z } from "zod";
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
    intent: z.literal("credential"),
    requestId: uuid,
    title: name,
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
  .transform((value) => ({
    ...value,
    coveredClinicianIds: value.coveredClinicianIds.sort(),
  }));
export const registerInputSchema = z.lazy(() =>
  z.discriminatedUnion("intent", [
    z.strictObject({ intent: z.literal("clinician"), requestId: uuid, name }),
    credentialInput,
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
