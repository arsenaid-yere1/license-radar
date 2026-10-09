import next from "next";
import { createServer } from "node:http";
import { takeCoverage } from "node:v8";
import { startSmsFixture } from "./sms-provider-fixture.mjs";
import { startEmailFixture } from "./email-provider-fixture.mjs";
const fixture = await startSmsFixture();
let emailFixture;
try {
  emailFixture = await startEmailFixture();
} catch (error) {
  await fixture.close();
  throw error;
}
const app = next({ dev: false, hostname: "127.0.0.1", port: 3000 });
try {
  await app.prepare();
} catch (error) {
  await fixture.close();
  await emailFixture.close();
  throw error;
}
const server = createServer(app.getRequestHandler());
server.listen(3000, "127.0.0.1");
process.on("SIGTERM", () => {
  takeCoverage();
  server.close();
  Promise.all([app.close(), fixture.close(), emailFixture.close()]).then(() =>
    process.exit(0),
  );
});
