import fc from "fast-check";
import { afterEach, expect, it, vi } from "vitest";
import { reminderHeartbeat } from "./heartbeat";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function production() {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("EMAIL_PROVIDER_FIXTURE", undefined);
  vi.stubEnv("REMINDER_HEALTHCHECK_ENABLED", "true");
}
it("SA03 every valid UUID can check in, arbitrary hosts and suffixes cannot", async () => {
  production();
  await fc.assert(
    fc.asyncProperty(
      fc.uuid({ version: 4 }),
      fc.string({ minLength: 1, maxLength: 80 }),
      async (id, hostile) => {
        const network = vi.fn().mockResolvedValue(new Response("OK"));
        vi.stubGlobal("fetch", network);
        const good = `https://hc-ping.com/${id}`;
        vi.stubEnv("REMINDER_HEALTHCHECK_URL", good);
        expect(await reminderHeartbeat()).toBe(true);
        expect(network).toHaveBeenCalledExactlyOnceWith(
          good,
          expect.objectContaining({ method: "POST" }),
        );
        for (const bad of [
          `https://${encodeURIComponent(hostile)}.invalid/${id}`,
          good + hostile,
        ]) {
          network.mockClear();
          vi.stubEnv("REMINDER_HEALTHCHECK_URL", bad);
          expect(await reminderHeartbeat()).toBe(false);
          expect(network).not.toHaveBeenCalled();
        }
      },
    ),
    { seed: 20261016, numRuns: 100 },
  );
});
it("SA04 arbitrary response text cannot impersonate exact OK", async () => {
  production();
  vi.stubEnv(
    "REMINDER_HEALTHCHECK_URL",
    "https://hc-ping.com/10000000-0000-4000-8000-000000000001",
  );
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(fc.constant("OK"), fc.string({ maxLength: 512 })),
      async (body) => {
        const network = vi.fn().mockResolvedValue(new Response(body));
        vi.stubGlobal("fetch", network);
        expect(await reminderHeartbeat()).toBe(body === "OK");
        expect(network).toHaveBeenCalledTimes(1);
      },
    ),
    { seed: 20261016, numRuns: 100 },
  );
});
