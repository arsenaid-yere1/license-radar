import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  stat,
  symlink,
  rm,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAuthorization,
  verifyCallback,
  saveCredentials,
  exchangeAuthorization,
  readClient,
} from "./gmail-oauth-helper.mjs";
import { runGmailAuthorization } from "./gmail-oauth.mjs";
import { get } from "node:http";
const clientId = "fixture.apps.googleusercontent.com",
  sender = "fixture@gmail.com";
test("GM02 OAuth uses unpredictable state, S256 PKCE and exact send/identity scopes", () => {
  const a = createAuthorization(clientId, sender),
    b = createAuthorization(clientId, sender),
    url = new URL(a.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.pathname, "/o/oauth2/v2/auth");
  assert.notEqual(a.state, b.state);
  assert.ok(a.state.length >= 43);
  assert.equal(
    url.searchParams.get("code_challenge"),
    createHash("sha256").update(a.verifier).digest("base64url"),
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "http://127.0.0.1:53682/oauth/callback",
  );
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.deepEqual(url.searchParams.get("scope").split(" ").sort(), [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
  ]);
});
test("GM02 callback rejects foreign/replayed/expired/denied/broadened inputs without exposing code", () => {
  const a = createAuthorization(clientId, sender, 1000),
    valid = `/oauth/callback?state=${a.state}&code=private-code&iss=https%3A%2F%2Faccounts.google.com`;
  for (const [path, host, method, now] of [
    [valid, "attacker.invalid", "GET", 1001],
    [valid, "127.0.0.1:53682", "POST", 1001],
    [valid, "127.0.0.1:53682", "GET", 301001],
    [valid + "&evil=1", "127.0.0.1:53682", "GET", 1001],
    [valid.replace(a.state, "foreign"), "127.0.0.1:53682", "GET", 1001],
    [valid + "&code=duplicate", "127.0.0.1:53682", "GET", 1001],
    [
      `/oauth/callback?state=${a.state}&error=access_denied`,
      "127.0.0.1:53682",
      "GET",
      1001,
    ],
  ])
    assert.throws(
      () => verifyCallback(a, { url: path, host, method }, now),
      (e) => !e.message.includes("private-code"),
    );
  assert.equal(
    verifyCallback(
      a,
      { url: valid, host: "127.0.0.1:53682", method: "GET" },
      1001,
    ),
    "private-code",
  );
  assert.throws(() =>
    verifyCallback(
      a,
      { url: valid, host: "127.0.0.1:53682", method: "GET" },
      1002,
    ),
  );
});
test("GM08 credentials are saved exclusively in a private nonsymlink directory outside source", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "gmail-oauth-test-")),
  );
  try {
    const dir = join(root, "private");
    await mkdir(dir, { mode: 0o700 });
    const file = await saveCredentials(
      dir,
      { private: "secret" },
      process.cwd(),
    );
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      private: "secret",
    });
    await assert.rejects(
      saveCredentials(dir, { private: "replacement" }, process.cwd()),
    );
    const publicDir = join(root, "public");
    await mkdir(publicDir, { mode: 0o755 });
    await assert.rejects(saveCredentials(publicDir, {}, process.cwd()));
    const link = join(root, "linked");
    await symlink(dir, link);
    await assert.rejects(saveCredentials(link, {}, process.cwd()));
    await assert.rejects(saveCredentials(process.cwd(), {}, process.cwd()));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("GM02 exchange requires refresh grant, exact scopes and verified identity with sanitized failures", async () => {
  const original = globalThis.fetch;
  try {
    for (const patch of [
      { scope: undefined },
      { scope: "openid email" },
      {
        scope:
          "openid email https://www.googleapis.com/auth/gmail.send profile",
      },
      { refresh_token: undefined },
      { email: "other@gmail.com" },
      { email_verified: false },
      { sub: "" },
    ]) {
      let call = 0;
      const token = {
        access_token: "access-fixture",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh-fixture",
        scope: "openid email https://www.googleapis.com/auth/gmail.send",
        ...patch,
      };
      globalThis.fetch = async (url) => {
        assert.ok(!String(url).includes("access-fixture"));
        return new Response(
          JSON.stringify(
            call++ === 0
              ? token
              : {
                  email: sender,
                  email_verified: true,
                  sub: "google-subject",
                  ...patch,
                },
          ),
        );
      };
      const a = createAuthorization(clientId, sender);
      a.used = true;
      await assert.rejects(
        exchangeAuthorization(
          { clientId, clientSecret: "secret-fixture" },
          a,
          "private-code",
          sender,
          "production",
        ),
        (e) =>
          e.message === "Gmail authorization refused; no credentials saved",
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});
test("GM02 real loopback helper exchanges one PKCE callback and writes a private bound grant", async () => {
  const root = await realpath(
      await mkdtemp(join(tmpdir(), "gmail-oauth-flow-")),
    ),
    original = globalThis.fetch;
  try {
    const input = join(root, "client.json"),
      output = join(root, "output");
    await mkdir(output, { mode: 0o700 });
    await writeFile(
      input,
      JSON.stringify({
        web: {
          client_id: clientId,
          client_secret: "secret-fixture",
          redirect_uris: ["http://127.0.0.1:53682/oauth/callback"],
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
        },
      }),
      { mode: 0o600 },
    );
    assert.deepEqual(await readClient(input, process.cwd()), {
      clientId,
      clientSecret: "secret-fixture",
    });
    const seen = [];
    globalThis.fetch = async (url, options) => {
      seen.push({ url, options });
      return new Response(
        JSON.stringify(
          seen.length === 1
            ? {
                access_token: "access-fixture",
                token_type: "Bearer",
                expires_in: 3600,
                refresh_token: "refresh-fixture",
                scope:
                  "openid email https://www.googleapis.com/auth/gmail.send",
              }
            : { email: sender, email_verified: true, sub: "google-subject" },
        ),
      );
    };
    let ready;
    const started = new Promise((resolve) => {
        ready = resolve;
      }),
      announcements = [];
    const pending = runGmailAuthorization(
      { input, output, sender, publishingStatus: "testing" },
      (value) => {
        announcements.push(value);
        if (value.startsWith("https://")) ready(value);
      },
    );
    const auth = new URL(
      await Promise.race([
        started,
        pending.then(() => {
          throw Error("Missing authorization URL");
        }),
      ]),
    );
    const callback = `http://127.0.0.1:53682/oauth/callback?state=${auth.searchParams.get("state")}&code=private-code&iss=https%3A%2F%2Faccounts.google.com`;
    const status = await new Promise((resolve, reject) => {
      get(callback, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      }).on("error", reject);
    });
    assert.equal(status, 200);
    const file = await pending,
      saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.refreshToken, "refresh-fixture");
    assert.equal(saved.binding.email, sender);
    assert.equal(saved.binding.subject, "google-subject");
    assert.equal(
      saved.binding.refreshTokenSha256,
      createHash("sha256").update("refresh-fixture").digest("hex"),
    );
    assert.equal(
      Date.parse(saved.binding.testingExpiresAt) -
        Date.parse(saved.binding.authorizedAt),
      7 * 86400000,
    );
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const tokenRequest = seen[0].options.body;
    assert.equal(tokenRequest.get("code"), "private-code");
    assert.equal(
      createHash("sha256")
        .update(tokenRequest.get("code_verifier"))
        .digest("base64url"),
      auth.searchParams.get("code_challenge"),
    );
    assert.equal(seen.length, 2);
    assert.ok(
      announcements.every(
        (value) =>
          !/[?&]code=|refresh-fixture|secret-fixture|access-fixture/.test(
            value,
          ),
      ),
    );
  } finally {
    globalThis.fetch = original;
    await rm(root, { recursive: true, force: true });
  }
});
test("GM02 callback issuer is exactly Google and cannot be missing, duplicated or redirected", () => {
  const a = createAuthorization(clientId, sender),
    base = `/oauth/callback?state=${a.state}&code=private-code`;
  for (const suffix of [
    "",
    "&iss=https://attacker.invalid",
    "&iss=https://accounts.google.com&iss=https://accounts.google.com",
    "&iss=accounts.google.com",
  ])
    assert.throws(() =>
      verifyCallback(a, {
        url: base + suffix,
        host: "127.0.0.1:53682",
        method: "GET",
      }),
    );
  assert.equal(
    verifyCallback(a, {
      url: base + "&iss=https://accounts.google.com",
      host: "127.0.0.1:53682",
      method: "GET",
    }),
    "private-code",
  );
});
