export type Rejection = {
  kind: "rate-limited" | "permanent" | "uncertain";
  errorCode: string | null;
  retryAfterSeconds: number | null;
};
export function classifyRejection(
  status: number,
  raw: unknown,
  retryAfter: string | null,
): Rejection {
  const errorCode = providerErrorCode(status, raw);
  const kind = rejectionKind(status, errorCode);
  return {
    kind,
    errorCode,
    retryAfterSeconds:
      kind === "rate-limited" ? retryAfterSeconds(retryAfter) : null,
  };
}
function providerErrorCode(status: number, raw: unknown): string | null {
  const parsed = errorSchema.safeParse(raw);
  return parsed.success &&
    (parsed.data.statusCode === undefined || parsed.data.statusCode === status)
    ? parsed.data.name
    : null;
}
function rejectionKind(
  status: number,
  errorCode: string | null,
): Rejection["kind"] {
  if (status === 429) {
    if (errorCode === "rate_limit_exceeded") return "rate-limited";
    if (
      errorCode === "daily_quota_exceeded" ||
      errorCode === "monthly_quota_exceeded"
    )
      return "permanent";
    return "uncertain";
  }
  return definiteClientRejection(status) ? "permanent" : "uncertain";
}
function definiteClientRejection(status: number): boolean {
  return (
    Number.isInteger(status) &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409
  );
}
export type DeliveryBinding = {
  providerId: string;
  attemptId: string;
  from: string;
  to: string;
};
export type DeliveryObservation = {
  status:
    | "sent"
    | "delivered"
    | "delayed"
    | "failed"
    | "complained"
    | "suppressed"
    | null;
  bounced: boolean;
};
export function parseDeliveryResource(
  raw: unknown,
  binding: DeliveryBinding,
): DeliveryObservation | null {
  const parsedBinding = bindingSchema.safeParse(binding);
  const parsed = resourceSchema.safeParse(raw);
  if (!parsedBinding.success || !parsed.success) return null;
  const resource = parsed.data;
  const tags = resource.tags.filter((tag) => tag.name === "reminder_attempt");
  if (
    resource.id !== binding.providerId ||
    resource.from !== binding.from ||
    resource.to[0] !== binding.to ||
    tags.length !== 1 ||
    !z.uuid().safeParse(tags[0].value).success ||
    tags[0].value !== binding.attemptId
  )
    return null;
  return {
    status: Object.hasOwn(statuses, resource.last_event)
      ? statuses[resource.last_event]
      : null,
    bounced: resource.last_event === "bounced",
  };
}
import { z } from "zod";

function retryAfterSeconds(header: string | null): number | null {
  if (header === null || !/^[0-9]{1,10}(?![^])/.test(header)) return null;
  const seconds = Number(header);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 2147483647
    ? seconds
    : null;
}

const errorSchema = z.strictObject({
  name: z.string().regex(/^[a-z_]{1,64}(?![^])/),
  message: z.string().min(1).max(2000),
  statusCode: z.number().int().min(100).max(599).optional(),
});
const bindingSchema = z.strictObject({
  providerId: z.uuid(),
  attemptId: z.uuid(),
  from: z.string().min(1).max(254),
  to: z.email().max(254),
});
const resourceSchema = z.object({
  id: z.uuid(),
  from: z.string().min(1).max(254),
  to: z.tuple([z.email().max(254)]),
  tags: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(256),
        value: z.string().min(1).max(256),
      }),
    )
    .max(100),
  last_event: z.string().max(64),
});
const statuses: Record<string, Exclude<DeliveryObservation["status"], null>> = {
  sent: "sent",
  delivered: "delivered",
  delivery_delayed: "delayed",
  failed: "failed",
  complained: "complained",
  suppressed: "suppressed",
  bounced: "failed",
};
