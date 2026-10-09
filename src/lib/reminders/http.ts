import "server-only";
export function reminderReply(status: number, body: unknown = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function boundedReminderBody(
  request: Pick<Request, "body" | "headers">,
  limit: number,
): Promise<{ body: string } | { status: 400 | 408 | 413 }> {
  if (Number(request.headers.get("content-length")) > limit)
    return { status: 413 };
  const reader = request.body?.getReader();
  if (!reader) return { body: "" };
  const chunks: Uint8Array[] = [];
  let length = 0;
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, 5000);
  try {
    for (;;) {
      const part = await reader.read();
      if (expired) return { status: 408 };
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return { status: 413 };
      }
      chunks.push(part.value);
    }
    return {
      body: new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      ),
    };
  } catch {
    return { status: 400 };
  } finally {
    clearTimeout(timer);
  }
}
