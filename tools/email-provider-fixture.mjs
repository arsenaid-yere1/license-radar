import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
// Loopback only. Recorded messages never leave this process or reach an inbox.
const fixtureAddress = /^fixture-[a-zA-Z0-9-]+@example\.test$/;
const sendModes = new Set([
  "accepted",
  "lost",
  "lost-before-acceptance",
  "rejected",
  "error",
  "rate-limited",
  "quota",
]);
const lookupModes = new Set([
  "normal",
  "missing",
  "error",
  "missing-tags",
  "foreign-tags",
  "duplicate-tags",
]);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export async function startEmailFixture() {
  const messages = [],
    calls = [],
    resources = new Map(),
    acceptedKeys = new Map(),
    modes = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization !== "Bearer local-fixture-only-e4-s2") {
      response.writeHead(403).end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 65536) throw new Error("Too large");
      }
      const input = JSON.parse(body || "{}");
      if (request.url === "/test/mode" && request.method === "POST") {
        const script = Array.isArray(input.mode) ? input.mode : [input.mode];
        if (
          !fixtureAddress.test(input.to) ||
          !script.length ||
          script.length > 128 ||
          script.some((mode) => !sendModes.has(mode)) ||
          (input.lookup !== undefined && !lookupModes.has(input.lookup)) ||
          (input.lastEvent !== undefined &&
            (typeof input.lastEvent !== "string" ||
              input.lastEvent.length > 64))
        ) {
          response.writeHead(400).end("{}");
          return;
        }
        modes.set(input.to, {
          script: [...script],
          scripted: Array.isArray(input.mode),
          lastEvent: input.lastEvent ?? "sent",
          lookup: input.lookup ?? "normal",
        });
        response.end("{}");
        return;
      }
      if (
        ["/test/state", "/test/resources", "/test/calls"].includes(
          request.url,
        ) &&
        request.method === "POST"
      ) {
        if (!fixtureAddress.test(input.to)) {
          response.writeHead(400).end("{}");
          return;
        }
        const selected = calls.filter((call) => call.to === input.to);
        const result =
          request.url === "/test/calls"
            ? {
                postCount: selected.filter((call) => call.method === "POST")
                  .length,
                getCount: selected.filter((call) => call.method === "GET")
                  .length,
                calls: selected,
              }
            : (request.url === "/test/state"
                ? messages
                : [...resources.values()]
              ).filter((message) => message.to[0] === input.to);
        response.end(JSON.stringify(result));
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/emails/")) {
        const id = request.url.slice(8);
        const message = resources.get(id);
        const mode = modes.get(message?.to[0]);
        const lookup = mode?.lookup ?? "normal";
        calls.push({
          method: "GET",
          to: message?.to[0] ?? null,
          id,
          classification: message ? lookup : "missing",
        });
        if (!message || lookup === "missing") {
          response.writeHead(404).end("{}");
          return;
        }
        if (lookup === "error") {
          response.writeHead(503).end("{}");
          return;
        }
        const result = { ...message, last_event: mode?.lastEvent ?? "sent" };
        if (lookup === "missing-tags") delete result.tags;
        if (lookup === "foreign-tags")
          result.tags = [{ name: "attempt", value: "foreign-attempt" }];
        if (lookup === "duplicate-tags")
          result.tags = [...(message.tags ?? []), ...(message.tags ?? [])];
        response.end(JSON.stringify(result));
        return;
      }
      if (
        request.url !== "/emails" ||
        request.method !== "POST" ||
        input.to?.length !== 1 ||
        !fixtureAddress.test(input.to[0])
      ) {
        response.writeHead(400).end("{}");
        return;
      }
      const settings = modes.get(input.to[0]);
      const mode = settings?.scripted
        ? (settings.script.shift() ?? "accepted")
        : (settings?.script[0] ?? "accepted");
      const key = request.headers["idempotency-key"];
      const fingerprint = JSON.stringify(canonical(input));
      const existing = key ? acceptedKeys.get(key) : undefined;
      const id = existing?.id ?? randomUUID();
      const message = {
        ...input,
        id,
        key,
      };
      messages.push(message);
      const call = {
        method: "POST",
        to: input.to[0],
        id,
        key,
        payload: input,
        classification: mode,
      };
      calls.push(call);
      if (existing && existing.fingerprint !== fingerprint) {
        call.classification = "idempotency-conflict";
        response
          .writeHead(409)
          .end(JSON.stringify({ name: "invalid_idempotent_request" }));
        return;
      }
      if (existing) {
        call.classification = "deduplicated";
        response.end(JSON.stringify({ id }));
        return;
      }
      if (mode === "lost-before-acceptance") {
        response.destroy();
        return;
      }
      if (mode === "rejected") {
        response.writeHead(422).end("{}");
        return;
      }
      if (mode === "error") {
        response.writeHead(503).end("{}");
        return;
      }
      if (mode === "rate-limited" || mode === "quota") {
        if (mode === "rate-limited") response.setHeader("Retry-After", "60");
        response.writeHead(429).end(
          JSON.stringify({
            name:
              mode === "rate-limited"
                ? "rate_limit_exceeded"
                : "daily_quota_exceeded",
            message: "Local fixture rejection",
          }),
        );
        return;
      }
      resources.set(id, { ...message, last_event: "sent" });
      if (key) acceptedKeys.set(key, { id, fingerprint });
      if (mode === "lost") {
        response.destroy();
        return;
      }
      response.end(JSON.stringify({ id }));
    } catch {
      response.writeHead(400).end("{}");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(55326, "127.0.0.1", resolve);
  });
  return {
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
