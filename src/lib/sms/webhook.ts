import "server-only";
import twilio from "twilio";
import { z } from "zod";
import type { CallbackConfig } from "./config";
function reply(status: number) {
  return new Response(status === 200 ? "<Response/>" : "", {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 16384) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
}
async function fieldsFrom(
  request: Request,
): Promise<Record<string, string> | Response> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/x-www-form-urlencoded"
  )
    return reply(415);
  if (Number(request.headers.get("content-length")) > 16384) return reply(413);
  let body: string | null;
  try {
    body = await readBody(request);
  } catch {
    return reply(400);
  }
  if (body === null) return reply(400);
  const fields: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(body)) {
    if (Object.hasOwn(fields, key)) return reply(400);
    fields[key] = value;
  }
  return fields;
}
function validatedEvent(
  request: Request,
  fields: Record<string, string>,
  config: CallbackConfig,
) {
  const signature = request.headers.get("x-twilio-signature");
  if (
    !signature ||
    !twilio.validateRequest(config.authToken, signature, config.url, fields)
  )
    return null;
  const parsed = z
    .object({
      AccountSid: z.literal(config.accountSid),
      MessagingServiceSid: z.literal(config.messagingServiceSid),
      MessageSid: z.string().regex(/^SM[0-9a-fA-F]{32}$/),
      From: z.string().regex(/^\+[1-9][0-9]{1,14}$/),
      To: z.enum(config.senders),
      OptOutType: z.enum(["STOP", "START", "HELP"]).optional(),
    })
    .safeParse(fields);
  // Failed parsing has no data; the caller rejects that result once below.
  return parsed.data;
}
export async function handleSmsWebhook(
  request: Request,
  config: CallbackConfig | null,
  persist: (
    account: string,
    service: string,
    phone: string,
    message: string,
    type: string,
  ) => Promise<unknown>,
): Promise<Response> {
  if (!config) return reply(503);
  const fields = await fieldsFrom(request);
  if (fields instanceof Response) return fields;
  const event = validatedEvent(request, fields, config);
  if (!event) return reply(403);
  if (!event.OptOutType) return reply(200);
  try {
    const result = await persist(
      event.AccountSid,
      event.MessagingServiceSid,
      event.From,
      event.MessageSid,
      event.OptOutType,
    );
    return reply(
      z.object({ status: z.literal("success") }).safeParse(result).success
        ? 200
        : 503,
    );
  } catch {
    return reply(503);
  }
}
