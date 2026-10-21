import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
  createAuthorization,
  verifyCallback,
  privateDirectory,
  readClient,
  saveCredentials,
  exchangeAuthorization,
} from "./gmail-oauth-helper.mjs";
export async function runGmailAuthorization(
  { input, output, sender, publishingStatus },
  announce = console.log,
) {
  await privateDirectory(output, process.cwd());
  const client = await readClient(input, process.cwd()),
    session = createAuthorization(client.clientId, sender);
  let timer, server;
  try {
    const completed = new Promise((resolve, reject) => {
      server = createServer(async (request, response) => {
        let code;
        try {
          code = verifyCallback(session, {
            url: request.url,
            host: request.headers.host,
            method: request.method,
          });
        } catch {
          response.writeHead(400, {
            "Content-Type": "text/plain",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          });
          response.end(
            "Authorization callback refused. Return to the local operator helper.",
          );
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "default-src 'none'",
        });
        response.end(
          "Google authorization received. You can close this tab. Credentials are being checked locally.",
        );
        try {
          const credentials = await exchangeAuthorization(
            client,
            session,
            code,
            sender,
            publishingStatus,
          );
          if (session.closed || Date.now() >= session.expires)
            throw Error("Gmail authorization expired");
          const path = await saveCredentials(
            output,
            credentials,
            process.cwd(),
          );
          resolve(path);
        } catch {
          reject(Error("Gmail authorization refused; no credentials saved"));
        }
      });
      server.maxHeadersCount = 30;
      server.requestTimeout = 5000;
      server.headersTimeout = 5000;
      server.on("error", () =>
        reject(Error("Gmail callback port unavailable")),
      );
      server.listen(53682, "127.0.0.1", () => announce(session.url));
      timer = setTimeout(
        () =>
          reject(Error("Gmail authorization expired; no credentials saved")),
        300000,
      );
    });
    const file = await completed;
    announce(`Credentials saved privately: ${file}`);
    return file;
  } finally {
    session.closed = true;
    clearTimeout(timer);
    server?.closeAllConnections();
    server?.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2),
      values = {};
    if (args.length !== 8) throw Error();
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      if (
        !["--input", "--output", "--sender", "--publishing"].includes(key) ||
        key in values
      )
        throw Error();
      values[key] = args[i + 1];
    }
    await runGmailAuthorization({
      input: values["--input"],
      output: values["--output"],
      sender: values["--sender"],
      publishingStatus: values["--publishing"],
    });
  } catch {
    console.error(
      "Gmail setup incomplete. Check private client/output paths, loopback port and consent, then run again. No secret details are printed.",
    );
    process.exitCode = 1;
  }
}
