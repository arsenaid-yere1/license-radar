import "server-only";
import { z } from "zod";
import { Webhook } from "svix";
import { boundedReminderBody, reminderReply } from "./http";
import type { EmailConfig } from "./config";
export type EmailEventServices = {
  binding(
    namespace: string,
    providerId: string,
    attemptId: string | null,
  ): Promise<unknown>;
  retrieve(id: string): Promise<unknown>;
  persist(
    namespace: string,
    eventId: string,
    providerId: string,
    attemptId: string,
    status: string,
    from: string,
    to: string,
  ): Promise<unknown>;
};
async function authenticatedEvent(request: Request, config: EmailConfig) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return reminderReply(415);
  const raw = await boundedReminderBody(request, 65536);
  if ("status" in raw) return reminderReply(raw.status);
  const eventId = request.headers.get("svix-id");
  if (!eventId || eventId.length > 256) return reminderReply(403);
  try {
    new Webhook(config.webhookSecret).verify(
      raw.body,
      Object.fromEntries(request.headers),
    );
  } catch {
    return reminderReply(403);
  }
  try {
    return { event: eventSchema.parse(JSON.parse(raw.body)), eventId };
  } catch {
    return reminderReply(400);
  }
}
type EventData = z.infer<typeof dataSchema>;
type Binding = z.infer<typeof bindingSchema>;
function matches(binding: Binding, data: EventData, attemptId: string | null) {
  if (attemptId && binding.attemptId !== attemptId) return false;
  if (binding.providerId && binding.providerId !== data.email_id) return false;
  if (!attemptId && !binding.providerId) return false;
  return binding.from === data.from && binding.to[0] === data.to[0];
}
async function resourceAttempt(data: EventData, services: EmailEventServices) {
  const resource = resourceSchema.parse(await services.retrieve(data.email_id));
  if (
    resource.id !== data.email_id ||
    resource.from !== data.from ||
    resource.to[0] !== data.to[0]
  )
    return reminderReply(400);
  const tags = resource.tags.filter((tag) => tag.name === "reminder_attempt");
  if (tags.length === 0) return reminderReply(200);
  if (tags.length !== 1 || !z.uuid().safeParse(tags[0].value).success)
    return reminderReply(400);
  return tags[0].value;
}
async function resolveBinding(
  data: EventData,
  config: EmailConfig,
  services: EmailEventServices,
) {
  let attemptId = data.tags?.reminder_attempt ?? null;
  if (attemptId !== null && !z.uuid().safeParse(attemptId).success)
    return reminderReply(400);
  let binding = await services.binding(
    config.namespace,
    data.email_id,
    attemptId,
  );
  if (missingSchema.safeParse(binding).success && !attemptId) {
    const recovered = await resourceAttempt(data, services);
    if (recovered instanceof Response) return recovered;
    attemptId = recovered;
    binding = await services.binding(
      config.namespace,
      data.email_id,
      attemptId,
    );
  }
  const bound = bindingSchema.safeParse(binding);
  if (!bound.success) return reminderReply(503);
  return matches(bound.data, data, attemptId) ? bound.data : reminderReply(400);
}
async function applyEvent(
  event: z.infer<typeof eventSchema>,
  eventId: string,
  config: EmailConfig,
  services: EmailEventServices,
) {
  const status = Object.hasOwn(statuses, event.type)
    ? statuses[event.type]
    : undefined;
  if (!status) return reminderReply(200);
  const parsed = dataSchema.safeParse(event.data);
  if (!parsed.success) return reminderReply(400);
  const data = parsed.data,
    binding = await resolveBinding(data, config, services);
  if (binding instanceof Response) return binding;
  const saved = resultSchema.safeParse(
    await services.persist(
      config.namespace,
      eventId,
      data.email_id,
      binding.attemptId,
      event.type === "email.bounced" && data.bounce?.type !== "Permanent"
        ? "failed"
        : status,
      data.from,
      data.to[0],
    ),
  );
  if (!saved.success) return reminderReply(503);
  return reminderReply(saved.data.status === "recorded" ? 200 : 400);
}
export async function handleEmailWebhook(
  request: Request,
  config: EmailConfig | null,
  services: EmailEventServices,
): Promise<Response> {
  if (request.method !== "POST") return reminderReply(405);
  if (!config) return reminderReply(503);
  const authenticated = await authenticatedEvent(request, config);
  if (authenticated instanceof Response) return authenticated;
  try {
    return await applyEvent(
      authenticated.event,
      authenticated.eventId,
      config,
      services,
    );
  } catch {
    return reminderReply(503);
  }
}

const eventSchema = z.object({
  type: z.string(),
  data: z.unknown().optional(),
});
const destination = z.array(z.email().max(254)).length(1);
const dataSchema = z.object({
  email_id: z.uuid(),
  from: z.string().min(1).max(254),
  to: destination,
  tags: z.record(z.string(), z.string()).optional(),
  bounce: z.object({ type: z.string() }).optional(),
});
const resourceSchema = z.object({
  id: z.uuid(),
  from: z.string(),
  to: destination,
  tags: z.array(z.object({ name: z.string(), value: z.string() })),
});
const bindingSchema = z.object({
  attemptId: z.uuid(),
  providerId: z.uuid().nullable(),
  from: z.string(),
  to: destination,
});
const missingSchema = z.object({ status: z.literal("missing") });
const resultSchema = z.object({
  status: z.enum(["recorded", "conflict", "invalid"]),
});
const statuses: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed",
  "email.delivery_delayed": "delayed",
  "email.failed": "failed",
};
