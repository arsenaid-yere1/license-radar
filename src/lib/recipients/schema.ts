import { z } from "zod";
import { roleSchema, versionSchema } from "@/lib/team/schema";
export const recipientInputSchema = z.union([
  z.strictObject({
    intent: z.literal("assign"),
    membershipId: z.uuid(),
    expectedVersion: versionSchema,
  }),
  z.strictObject({
    intent: z.literal("clear"),
    expectedVersion: versionSchema,
  }),
]);
const member = z.object({
  id: z.uuid(),
  email: z.email(),
  role: roleSchema,
  state: z.enum(["active", "revoked"]),
});
const candidate = member.extend({
  role: z.enum(["administrator", "manager"]),
  state: z.literal("active"),
});
export const recipientSchema = z
  .union([
    z.object({
      canEdit: z.literal(true),
      version: versionSchema,
      selected: member.nullable(),
      readiness: z.enum([
        "no-recipient",
        "sms-setup-pending",
        "member-unavailable",
      ]),
      ready: z.literal(false),
      candidates: z.array(candidate),
    }),
    z.object({
      canEdit: z.literal(false),
      version: versionSchema,
      selected: member.nullable(),
      readiness: z.enum([
        "no-recipient",
        "sms-setup-pending",
        "member-unavailable",
      ]),
      ready: z.literal(false),
      candidates: z.never().optional(),
    }),
  ])
  .refine((value) => {
    if (!value.selected) return value.readiness === "no-recipient";
    const eligible =
      value.selected.state === "active" && value.selected.role !== "viewer";
    return (
      value.readiness ===
      (eligible ? "sms-setup-pending" : "member-unavailable")
    );
  });
export type Recipient = z.infer<typeof recipientSchema>;
export type RecipientFailure =
  | "forbidden"
  | "conflict"
  | "invalid-recipient"
  | "unavailable"
  | "auth-required";
export type RecipientResult =
  | { status: "success"; recipient: Recipient }
  | { status: RecipientFailure }
  | { status: "invalid"; errors: Record<string, string> };
export type RecipientState = {
  status: "idle" | RecipientResult["status"];
  message?: string;
  recipient?: Recipient;
  errors?: Record<string, string>;
};
export type RecipientAction = (
  state: RecipientState,
  form: FormData,
) => Promise<RecipientState>;
