// Operator-only loopback authorization. No mailbox access is requested.
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, realpath, open } from "node:fs/promises";
import { resolve, relative, join, isAbsolute } from "node:path";
import {
  GMAIL_SCOPES,
  canonicalGmailScopes,
  googleJson,
  gmailAccessToken,
  verifiedGmailIdentity,
  refreshDigest,
} from "../src/lib/reminders/gmail-authorization.ts";
export const REDIRECT = "http://127.0.0.1:53682/oauth/callback";
export function createAuthorization(clientId, sender, now = Date.now()) {
  if (
    !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/.test(sender)
  )
    throw Error("Invalid Gmail client or sender");
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(64).toString("base64url"),
    url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    login_hint: sender,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.href, state, verifier, expires: now + 300000, used: false };
}
export function verifyCallback(session, request, now = Date.now()) {
  const invalid = () => Error("Gmail callback refused");
  if (
    session.used ||
    now >= session.expires ||
    request.method !== "GET" ||
    request.host !== "127.0.0.1:53682" ||
    typeof request.url !== "string" ||
    request.url.length > 8192 ||
    !request.url.startsWith("/oauth/callback?")
  )
    throw invalid();
  const url = new URL(request.url, REDIRECT),
    params = url.searchParams;
  if (
    url.origin !== new URL(REDIRECT).origin ||
    url.pathname !== "/oauth/callback" ||
    url.hash ||
    params.getAll("state").length !== 1 ||
    params.get("state") !== session.state ||
    params.get("iss") !== "https://accounts.google.com" ||
    params.getAll("code").length !== 1 ||
    !params.get("code") ||
    params.get("code").length > 4096
  )
    throw invalid();
  for (const key of params.keys())
    if (
      !["state", "code", "scope", "authuser", "prompt", "iss"].includes(key) ||
      params.getAll(key).length !== 1
    )
      throw invalid();
  if (params.has("scope") && !canonicalGmailScopes(params.get("scope")))
    throw invalid();
  session.used = true;
  return params.get("code");
}
export async function privateDirectory(directory, repository) {
  if (!isAbsolute(directory))
    throw Error("An absolute private output directory is required");
  const dir = resolve(directory),
    root = await realpath(repository),
    actual = await realpath(dir),
    info = await lstat(dir);
  const rel = relative(root, actual),
    inside =
      rel === "" ||
      (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
  if (
    actual !== dir ||
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    info.mode & 0o077 ||
    info.uid !== process.getuid() ||
    inside
  )
    throw Error("Output must be private and outside the repository");
  return actual;
}
export async function saveCredentials(directory, value, repository) {
  const dir = await privateDirectory(directory, repository),
    file = join(dir, "gmail-credentials.json");
  const handle = await open(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return file;
}
export async function readClient(file, repository) {
  const actual = resolve(file);
  await privateDirectory(resolve(actual, ".."), repository);
  const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.mode & 0o077 ||
      info.size > 16384 ||
      info.uid !== process.getuid()
    )
      throw Error();
    const raw = JSON.parse(await handle.readFile("utf8")),
      c = raw.web;
    if (
      !c ||
      !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(c.client_id) ||
      typeof c.client_secret !== "string" ||
      !/^[\x21-\x7e]{8,4096}$/.test(c.client_secret) ||
      JSON.stringify(c.redirect_uris) !== JSON.stringify([REDIRECT]) ||
      c.auth_uri !== "https://accounts.google.com/o/oauth2/auth" ||
      c.token_uri !== "https://oauth2.googleapis.com/token"
    )
      throw Error();
    return { clientId: c.client_id, clientSecret: c.client_secret };
  } catch {
    throw Error("Private Google web client configuration refused");
  } finally {
    await handle.close();
  }
}
export async function exchangeAuthorization(
  client,
  session,
  code,
  sender,
  publishingStatus,
  now = Date.now(),
) {
  if (
    !session.used ||
    now >= session.expires ||
    !["testing", "production"].includes(publishingStatus)
  )
    throw Error("Gmail authorization unavailable");
  try {
    const result = await googleJson(
      "token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.clientId,
          client_secret: client.clientSecret,
          code,
          code_verifier: session.verifier,
          redirect_uri: REDIRECT,
          grant_type: "authorization_code",
        }),
      },
      3000,
    );
    if (!result.ok) throw Error();
    const token = gmailAccessToken(result.body),
      scopes = canonicalGmailScopes(token.scope),
      refresh = result.body.refresh_token;
    if (
      !scopes ||
      typeof refresh !== "string" ||
      !/^[\x21-\x7e]{8,4096}$/.test(refresh)
    )
      throw Error();
    const response = await googleJson(
      "identity",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token.access_token}` },
      },
      3000,
    );
    if (!response.ok) throw Error();
    const identity = verifiedGmailIdentity(response.body, sender);
    return {
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      refreshToken: refresh,
      binding: {
        version: 1,
        email: identity.email,
        subject: identity.subject,
        clientId: client.clientId,
        scopes,
        authorizedAt: new Date(now).toISOString(),
        publishingStatus,
        testingExpiresAt:
          publishingStatus === "testing"
            ? new Date(now + 7 * 86400000).toISOString()
            : null,
        refreshTokenSha256: refreshDigest(refresh),
      },
    };
  } catch {
    throw Error("Gmail authorization refused; no credentials saved");
  }
}
