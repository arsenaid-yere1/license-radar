import "server-only";
import { z } from "zod";
const origin = "https://hc-ping.com/";
function heartbeatUrl() {
  const value = process.env.REMINDER_HEALTHCHECK_URL;
  if (
    process.env.REMINDER_HEALTHCHECK_ENABLED !== "true" ||
    process.env.VERCEL !== "1" ||
    process.env.VERCEL_ENV !== "production" ||
    process.env.EMAIL_PROVIDER_FIXTURE !== undefined ||
    !value?.startsWith(origin) ||
    value.length !== origin.length + 36 ||
    !z.uuid().safeParse(value.slice(origin.length, origin.length + 36)).success
  )
    return null;
  return value;
}
export async function reminderHeartbeat(): Promise<boolean> {
  const url = heartbeatUrl();
  if (!url) return false;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), 3000);
  });
  try {
    return await Promise.race([
      expired,
      (async () => {
        const response = await fetch(url, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status !== 200 || !response.body) return false;
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 2) return false;
          chunks.push(part.value);
        }
        return Buffer.concat(chunks).toString("utf8") === "OK";
      })(),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
