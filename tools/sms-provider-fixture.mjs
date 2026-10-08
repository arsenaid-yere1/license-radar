import { createServer } from "node:http";
import { randomBytes, randomInt } from "node:crypto";
export async function startSmsFixture() {
  const verifications = new Map(),
    modes = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.headers.authorization !== "Bearer local-fixture-only-e4-s1") {
      response.writeHead(403).end();
      return;
    }
    let body = "";
    try {
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 16384) throw new Error("Too large");
      }
      const input = JSON.parse(body || "{}");
      if (request.url === "/test/state") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify(
            [...verifications.values()].filter((v) => v.to === input.phone),
          ),
        );
        return;
      }
      if (request.url === "/test/mode") {
        modes.set(input.phone, input.mode);
        response.end("{}");
        return;
      }
      const claim = input.claim;
      const mode = modes.get(claim.phone);
      if (mode === "error") {
        response.writeHead(503).end();
        return;
      }
      let current = claim.verificationSid
        ? verifications.get(claim.verificationSid)
        : undefined;
      if (request.url === "/send") {
        if (!current) {
          const sid = `VE${randomBytes(16).toString("hex")}`;
          current = {
            sid,
            accountSid: claim.accountSid,
            serviceSid: claim.verifyServiceSid,
            to: claim.phone,
            channel: "sms",
            status: "pending",
            code: String(randomInt(100000, 1000000)),
            expires: Date.now() + 600000,
            checks: 0,
          };
          verifications.set(sid, current);
        }
      } else if (request.url === "/check" && current) {
        current.checks++;
        current.status =
          current.expires <= Date.now()
            ? "expired"
            : current.checks > 5
              ? "max_attempts_reached"
              : input.code === current.code
                ? "approved"
                : "pending";
      } else {
        response.writeHead(404).end();
        return;
      }
      if (
        (mode === "start-lost" && request.url === "/send") ||
        (mode === "check-lost" && request.url === "/check")
      ) {
        response.destroy();
        return;
      }
      const { code, expires, checks, ...result } = current;
      void code;
      void expires;
      void checks;
      if (mode === "mismatch") result.to = "+19999999999";
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result));
    } catch {
      response.writeHead(400).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(55325, "127.0.0.1", resolve);
  });
  return {
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
