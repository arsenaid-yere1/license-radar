import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
// Loopback only. Recorded messages never leave this process or reach an inbox.
export async function startEmailFixture() {
  const messages = new Map(),
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
        modes.set(input.to, input.mode);
        response.end("{}");
        return;
      }
      if (request.url === "/test/state" && request.method === "POST") {
        response.end(
          JSON.stringify(
            [...messages.values()].filter((m) => m.to[0] === input.to),
          ),
        );
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/emails/")) {
        const message = messages.get(request.url.slice(8));
        if (!message) {
          response.writeHead(404).end("{}");
          return;
        }
        response.end(JSON.stringify(message));
        return;
      }
      if (
        request.url !== "/emails" ||
        request.method !== "POST" ||
        input.to?.length !== 1 ||
        !/^fixture-[a-zA-Z0-9-]+@example\.test$/.test(input.to[0])
      ) {
        response.writeHead(400).end("{}");
        return;
      }
      const mode = modes.get(input.to[0]);
      const id = randomUUID();
      messages.set(id, {
        ...input,
        id,
        key: request.headers["idempotency-key"],
      });
      if (mode === "lost") {
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
