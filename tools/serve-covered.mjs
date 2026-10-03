import next from "next";
import { createServer } from "node:http";
import { takeCoverage } from "node:v8";
const app = next({ dev: false, hostname: "127.0.0.1", port: 3000 });
await app.prepare();
const server = createServer(app.getRequestHandler());
server.listen(3000, "127.0.0.1");
process.on("SIGTERM", () => {
  takeCoverage();
  server.close();
  app.close().then(() => process.exit(0));
});
