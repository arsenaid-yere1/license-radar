import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  GMAIL_SCOPES,
  canonicalGmailScopes,
  gmailBinding,
  refreshDigest,
} from "./gmail-authorization";
import { gmailConfig, selectedEmailProvider } from "./gmail-config";
import { authorizeGmail, gmailMime } from "./gmail-provider";
import type { GmailConfig } from "./gmail-config";
import type { EmailSubmission } from "./messages";
const binding = {
  version: 1 as const,
  email: "fixture@gmail.com",
  subject: "google-subject",
  clientId: "fixture.apps.googleusercontent.com",
  scopes: [...GMAIL_SCOPES],
  authorizedAt: new Date().toISOString(),
  publishingStatus: "production" as const,
  testingExpiresAt: null,
  refreshTokenSha256: createHash("sha256")
    .update("refresh-fixture")
    .digest("hex"),
};
const config: GmailConfig = {
  kind: "gmail",
  namespace: "gmail-pilot",
  from: binding.email,
  replyTo: binding.email,
  allowedRecipient: binding.email,
  appUrl: "https://example.com",
  clientId: binding.clientId,
  clientSecret: "secret-fixture",
  refreshToken: "refresh-fixture",
  binding,
};
const id = "ad2304c4-fcb0-4624-95be-3beaf983c041";
const submission: EmailSubmission = {
  status: "submit",
  attemptId: id,
  token: id,
  key: `reminder-email/${id}`,
  payload: {
    from: config.from,
    to: [config.from],
    reply_to: config.from,
    subject: "Credential renewal reminder: 60 days",
    text: "Review your renewal ✓",
    html: "<p>Review your renewal ✓</p>",
    tags: [{ name: "reminder_attempt", value: id }],
  },
};
afterEach(() => vi.unstubAllGlobals());
it("GM02 refresh credential digest uses the standard SHA-256 encoding", () => {
  expect(refreshDigest("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
function fetcher(
  token: unknown = {
    access_token: "access-fixture",
    token_type: "Bearer",
    expires_in: 3600,
  },
  identity: unknown = {
    email: config.from,
    email_verified: true,
    sub: binding.subject,
  },
  send: unknown = { id: "19a8dff001" },
) {
  const fn = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(token)))
    .mockResolvedValueOnce(new Response(JSON.stringify(identity)))
    .mockResolvedValue(new Response(JSON.stringify(send)));
  vi.stubGlobal("fetch", fn);
  return fn;
}
it("GM02 exact scopes normalize email alias and reject broader or missing authorization", () => {
  expect(canonicalGmailScopes(`openid email ${GMAIL_SCOPES[0]} email`)).toEqual(
    [...GMAIL_SCOPES],
  );
  for (const bad of [
    undefined,
    "",
    `openid email`,
    `${GMAIL_SCOPES.join(" ")} profile`,
    `${GMAIL_SCOPES.join(" ")} https://mail.google.com/`,
  ])
    expect(canonicalGmailScopes(bad)).toBeNull();
});
it("GM02 scope binding ties exact client/token/sender and refuses expired testing authorization", () => {
  expect(
    gmailBinding(binding, config.clientId, config.from, config.refreshToken),
  ).toEqual(binding);
  for (const bad of [
    { ...binding, clientId: "other" },
    { ...binding, email: "other@gmail.com" },
    { ...binding, refreshTokenSha256: "0".repeat(64) },
    { ...binding, scopes: [...GMAIL_SCOPES, "profile"] },
    {
      ...binding,
      publishingStatus: "testing",
      testingExpiresAt: "2020-01-01T00:00:00.000Z",
    },
  ])
    expect(
      gmailBinding(bad, config.clientId, config.from, config.refreshToken),
    ).toBeNull();
});
it("GM01 valid Gmail configuration is separate and fixture/live mixtures fail closed", () => {
  const env = {
    EMAIL_PROVIDER: "gmail",
    EMAIL_REMINDERS_ENABLED: "true",
    GMAIL_PROVIDER_NAMESPACE: config.namespace,
    GMAIL_SENDER_EMAIL: config.from,
    GMAIL_REPLY_TO: config.replyTo,
    GMAIL_ALLOWED_RECIPIENT: config.allowedRecipient,
    GMAIL_OAUTH_CLIENT_ID: config.clientId,
    GMAIL_OAUTH_CLIENT_SECRET: config.clientSecret,
    GMAIL_OAUTH_REFRESH_TOKEN: config.refreshToken,
    GMAIL_OAUTH_BINDING: JSON.stringify(binding),
    REMINDER_APP_URL: config.appUrl,
  };
  expect(gmailConfig(env)).toEqual(config);
  for (const patch of [
    { EMAIL_REMINDERS_ENABLED: "false" },
    { GMAIL_ALLOWED_RECIPIENT: "other@gmail.com" },
    { GMAIL_OAUTH_REFRESH_TOKEN: "other" },
    { EMAIL_PROVIDER_FIXTURE: "local-e4-s2" },
    { GMAIL_OAUTH_CLIENT_SECRET: "" },
    { REMINDER_APP_URL: "https://example.com/path" },
  ])
    expect(gmailConfig({ ...env, ...patch })).toBeNull();
  expect(selectedEmailProvider({})).toBe("resend");
  expect(selectedEmailProvider({ EMAIL_PROVIDER: "invalid" })).toBeNull();
});
it("GM03 one genuine Gmail POST uses MIME and fixed origins after verified refresh identity", async () => {
  const fn = fetcher();
  const provider = await authorizeGmail(config);
  expect(fn).toHaveBeenCalledTimes(2);
  expect(await provider.send(submission)).toEqual({
    outcome: "accepted",
    providerId: "19a8dff001",
    error: null,
  });
  expect(fn).toHaveBeenCalledTimes(3);
  expect(fn.mock.calls.map((c) => c[0])).toEqual([
    "https://oauth2.googleapis.com/token",
    "https://openidconnect.googleapis.com/v1/userinfo",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
  ]);
  const refresh = fn.mock.calls[0][1];
  expect(refresh).toMatchObject({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "error",
    cache: "no-store",
  });
  expect(Object.fromEntries(refresh.body)).toEqual({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });
  expect(fn.mock.calls[1][1]).toMatchObject({
    method: "GET",
    headers: { Authorization: "Bearer access-fixture" },
    redirect: "error",
    cache: "no-store",
  });
  const options = fn.mock.calls[2][1];
  expect(options.redirect).toBe("error");
  expect(options.headers.Authorization).toBe("Bearer access-fixture");
  expect(options.method).toBe("POST");
  expect(options.headers["Content-Type"]).toBe("application/json");
  const mime = Buffer.from(JSON.parse(options.body).raw, "base64url").toString(
    "utf8",
  );
  expect(mime).toContain(`To: ${config.from}\r\n`);
  expect(mime).toContain("multipart/alternative");
  expect(mime).not.toContain("reminder_attempt");
  expect(mime).not.toContain("Bcc:");
});
it("GM05 refresh scopes may be omitted only with the recorded unchanged binding", async () => {
  const fn = fetcher({
    access_token: "access-fixture",
    token_type: "Bearer",
    expires_in: 3600,
    scope: `openid email ${GMAIL_SCOPES[0]}`,
  });
  expect(await authorizeGmail(config)).toHaveProperty("send");
  expect(fn).toHaveBeenCalledTimes(2);
});
it("GM05 mismatched/revoked identity, broad grants or expired binding never authorize a POST", async () => {
  for (const [token, identity] of [
    [{ error: "invalid_grant" }, {}],
    [
      {
        access_token: "token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: `${GMAIL_SCOPES.join(" ")} profile`,
      },
      {},
    ],
    [
      { access_token: "token", token_type: "Bearer", expires_in: 3600 },
      { email: "other@gmail.com", email_verified: true, sub: binding.subject },
    ],
    [
      { access_token: "token", token_type: "Bearer", expires_in: 3600 },
      { email: config.from, email_verified: false, sub: binding.subject },
    ],
    [
      { access_token: "token", token_type: "Bearer", expires_in: 3600 },
      { email: config.from, email_verified: true, sub: "other" },
    ],
  ] as const) {
    const fn = fetcher(token, identity);
    await expect(authorizeGmail(config)).rejects.toThrow();
    expect(
      fn.mock.calls.some((c) => String(c[0]).includes("messages/send")),
    ).toBe(false);
  }
});
it("GM05 MIME header injection, mismatched recipient and extra fields are refused before POST", () => {
  expect(gmailMime(submission, config)).toContain("MIME-Version: 1.0");
  for (const payload of [
    {
      ...submission.payload,
      from: "fixture@gmail.com\r\nBcc: victim@gmail.com",
    },
    { ...submission.payload, to: ["other@gmail.com"] },
    { ...submission.payload, from: "other@gmail.com" },
    { ...submission.payload, reply_to: "other@gmail.com" },
    { ...submission.payload, bcc: "other@gmail.com" },
  ])
    expect(() =>
      gmailMime({ ...submission, payload } as EmailSubmission, config),
    ).toThrow();
  expect(() =>
    gmailMime(
      {
        ...submission,
        payload: { ...submission.payload, to: ["other@gmail.com"] },
      },
      { ...config, allowedRecipient: "other@gmail.com" },
    ),
  ).toThrow("Gmail message unavailable");
});
it("GM05 malformed/oversized responses and transport failure are uncertain and never retried", async () => {
  for (const body of [
    "{}",
    "not-json",
    JSON.stringify({ id: "../invalid" }),
    "x".repeat(65537),
    JSON.stringify({ id: "19a8df\n" }),
  ]) {
    const fn = fetcher(),
      provider = await authorizeGmail(config);
    fn.mockResolvedValue(new Response(body));
    expect((await provider.send(submission)).outcome).toBe("uncertain");
    expect(fn).toHaveBeenCalledTimes(3);
  }
  const fn = fetcher(),
    provider = await authorizeGmail(config);
  fn.mockRejectedValue(new Error("private-detail"));
  expect(await provider.send(submission)).toEqual({
    outcome: "uncertain",
    providerId: null,
    error: "provider-unavailable",
  });
  expect(fn).toHaveBeenCalledTimes(3);
});
it("GM05 rejected token/identity HTTP responses, redirects and empty bodies never authorize sending", async () => {
  const invalid = structuredClone(config);
  invalid.binding.refreshTokenSha256 = "0".repeat(64);
  const unused = fetcher();
  await expect(authorizeGmail(invalid)).rejects.toThrow(
    "Gmail reconnect required",
  );
  expect(unused).not.toHaveBeenCalled();
  for (const stage of [0, 1])
    for (const response of [
      new Response('{"error":"private"}', { status: 401 }),
      new Response("{}", { status: 302 }),
      new Response(null),
    ]) {
      const f = fetcher();
      if (stage === 0) f.mockReset().mockResolvedValue(response);
      else
        f.mockReset()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                access_token: "access-fixture",
                token_type: "Bearer",
                expires_in: 3600,
              }),
            ),
          )
          .mockResolvedValue(response);
      await expect(authorizeGmail(config)).rejects.toThrow(
        "Gmail reconnect required",
      );
      expect(f).toHaveBeenCalledTimes(stage + 1);
    }
});
it("GM05 HTTP rejection evidence stays permanent only when definite; transient or malformed errors remain uncertain", async () => {
  for (const status of [400, 401, 403, 404, 422, 408, 409, 429, 500]) {
    const f = fetcher(),
      provider = await authorizeGmail(config);
    f.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: status,
            message: "Private provider detail",
            status: "REJECTED",
          },
        }),
        { status },
      ),
    );
    expect(await provider.send(submission)).toEqual(
      status < 500 && ![408, 409, 429].includes(status)
        ? { outcome: "failed", providerId: null, error: "provider-rejected" }
        : {
            outcome: "uncertain",
            providerId: null,
            error: "provider-unavailable",
          },
    );
    expect(f).toHaveBeenCalledTimes(3);
  }
  const f = fetcher(),
    provider = await authorizeGmail(config);
  f.mockResolvedValue(new Response("{}", { status: 400 }));
  expect((await provider.send(submission)).outcome).toBe("uncertain");
  expect(f).toHaveBeenCalledTimes(3);
  const mismatch = fetcher(),
    transport = await authorizeGmail(config);
  mismatch.mockResolvedValue(
    new Response(
      JSON.stringify({
        error: { code: 403, message: "Private", status: "REJECTED" },
      }),
      { status: 400 },
    ),
  );
  expect((await transport.send(submission)).outcome).toBe("uncertain");
});
it("GM05 even well-formed token/identity payloads are rejected on unsuccessful HTTP responses", async () => {
  for (const stage of [0, 1]) {
    const f = fetcher(),
      token = {
        access_token: "access-fixture",
        token_type: "Bearer",
        expires_in: 3600,
      },
      identity = {
        email: config.from,
        email_verified: true,
        sub: binding.subject,
      };
    f.mockReset();
    if (stage === 1)
      f.mockResolvedValueOnce(new Response(JSON.stringify(token)));
    f.mockResolvedValue(
      new Response(JSON.stringify(stage === 0 ? token : identity), {
        status: 401,
      }),
    );
    await expect(authorizeGmail(config)).rejects.toThrow(
      "Gmail reconnect required",
    );
    expect(f).toHaveBeenCalledTimes(stage + 1);
  }
});
it("GM05 cached access credentials require at least twenty seconds before a POST", async () => {
  const start = Date.now(),
    clock = vi.spyOn(Date, "now");
  try {
    for (const remaining of [20000, 19999]) {
      clock.mockReturnValue(start);
      const f = fetcher({
          access_token: "access-fixture",
          token_type: "Bearer",
          expires_in: 60,
        }),
        provider = await authorizeGmail(config);
      clock.mockReturnValue(start + 60000 - remaining);
      expect((await provider.send(submission)).outcome).toBe(
        remaining === 20000 ? "accepted" : "uncertain",
      );
      expect(f).toHaveBeenCalledTimes(remaining === 20000 ? 3 : 2);
    }
  } finally {
    clock.mockRestore();
  }
});
it("GM03 genuine message IDs have an inclusive 128-character bound and never accept a suffix or path", async () => {
  for (const value of [
    "a".repeat(128),
    "a".repeat(129),
    "19a8df!",
    "!19a8df",
    "",
  ]) {
    const f = fetcher(),
      provider = await authorizeGmail(config);
    f.mockResolvedValue(new Response(JSON.stringify({ id: value })));
    expect((await provider.send(submission)).outcome).toBe(
      value.length === 128 ? "accepted" : "uncertain",
    );
  }
});
it("GM03 Unicode MIME content is encoded in complete 76-character lines", () => {
  const mime = gmailMime(
    {
      ...submission,
      payload: {
        ...submission.payload,
        text: "✓".repeat(200),
        html: "<p>" + "✓".repeat(200) + "</p>",
      },
    },
    config,
  );
  const parts = mime.split(`--license-radar-${id}`);
  for (const index of [1, 2]) {
    const lines = parts[index].split("\r\n\r\n")[1].trim().split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(0, -1).every((line) => line.length === 76)).toBe(true);
    expect(lines.at(-1)!.length).toBeLessThanOrEqual(76);
  }
});
it("GM05 invalid MIME is refused without POST even after a valid authorization", async () => {
  const f = fetcher(),
    provider = await authorizeGmail(config);
  expect(
    await provider.send({
      ...submission,
      payload: { ...submission.payload, to: ["other@gmail.com"] },
    }),
  ).toEqual({
    outcome: "uncertain",
    providerId: null,
    error: "invalid-response",
  });
  expect(f).toHaveBeenCalledTimes(2);
});
it("GM01 malformed or missing binding never enables Gmail", () => {
  const env = {
    EMAIL_PROVIDER: "gmail",
    EMAIL_REMINDERS_ENABLED: "true",
    GMAIL_PROVIDER_NAMESPACE: config.namespace,
    GMAIL_SENDER_EMAIL: config.from,
    GMAIL_REPLY_TO: config.replyTo,
    GMAIL_ALLOWED_RECIPIENT: config.allowedRecipient,
    GMAIL_OAUTH_CLIENT_ID: config.clientId,
    GMAIL_OAUTH_CLIENT_SECRET: config.clientSecret,
    GMAIL_OAUTH_REFRESH_TOKEN: config.refreshToken,
    REMINDER_APP_URL: config.appUrl,
  };
  for (const raw of [undefined, "", "{", "x".repeat(4097)])
    expect(gmailConfig({ ...env, GMAIL_OAUTH_BINDING: raw })).toBeNull();
  for (const field of [
    "GMAIL_PROVIDER_NAMESPACE",
    "GMAIL_OAUTH_CLIENT_SECRET",
    "GMAIL_OAUTH_REFRESH_TOKEN",
    "GMAIL_OAUTH_CLIENT_ID",
  ] as const) {
    const valid = { ...env, GMAIL_OAUTH_BINDING: JSON.stringify(binding) };
    expect(gmailConfig({ ...valid, [field]: valid[field] + "\n" })).toBeNull();
  }
});
