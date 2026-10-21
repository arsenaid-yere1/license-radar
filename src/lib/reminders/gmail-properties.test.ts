import { expect, it, afterEach, vi } from "vitest";
import fc from "fast-check";
import { createHash } from "node:crypto";
import {
  GMAIL_SCOPES,
  canonicalGmailScopes,
  gmailBinding,
  refreshDigest,
  googleJson,
  gmailAccessToken,
  verifiedGmailIdentity,
} from "./gmail-authorization";
import { gmailMime, authorizeGmail } from "./gmail-provider";
import type { GmailConfig } from "./gmail-config";
const now = Date.now(),
  email = "fixture@gmail.com",
  clientId = "fixture.apps.googleusercontent.com",
  refresh = "refresh-fixture";
const binding = {
  version: 1 as const,
  email,
  subject: "google-subject",
  clientId,
  scopes: [...GMAIL_SCOPES],
  authorizedAt: new Date(now).toISOString(),
  publishingStatus: "production" as const,
  testingExpiresAt: null,
  refreshTokenSha256: createHash("sha256").update(refresh).digest("hex"),
};
const config: GmailConfig = {
  kind: "gmail",
  namespace: "gmail-pilot",
  from: email,
  replyTo: email,
  allowedRecipient: email,
  appUrl: "https://example.com",
  clientId,
  clientSecret: "secret-fixture",
  refreshToken: refresh,
  binding,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("GM02 scope order/duplicates/aliases preserve exactly the same least-privileged grant", () => {
  expect(refreshDigest("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(
    canonicalGmailScopes(`  openid  email\t\n${GMAIL_SCOPES[0]} `),
  ).toEqual([...GMAIL_SCOPES]);
  const bounded = GMAIL_SCOPES.join(" ").padEnd(2048, " ");
  expect(canonicalGmailScopes(bounded)).toEqual([...GMAIL_SCOPES]);
  expect(canonicalGmailScopes(bounded + " ")).toBeNull();
  expect(canonicalGmailScopes(`${GMAIL_SCOPES[0]} openid unknown`)).toBeNull();
  expect(canonicalGmailScopes(`same-count unknown scope`)).toBeNull();
  fc.assert(
    fc.property(
      fc.shuffledSubarray([...GMAIL_SCOPES], { minLength: 3, maxLength: 3 }),
      fc.boolean(),
      (scopes, alias) => {
        const raw = [...scopes, ...scopes]
          .map((s) => (alias && s === GMAIL_SCOPES[1] ? "email" : s))
          .join(" ");
        expect(canonicalGmailScopes(raw)).toEqual([...GMAIL_SCOPES]);
      },
    ),
  );
  fc.assert(
    fc.property(
      fc
        .string({ maxLength: 80 })
        .filter(
          (s) =>
            s.trim() !== "" &&
            !GMAIL_SCOPES.includes(s as (typeof GMAIL_SCOPES)[number]) &&
            s !== "email",
        ),
      (extra) => {
        expect(
          canonicalGmailScopes(`${GMAIL_SCOPES.join(" ")} ${extra}`),
        ).toBeNull();
      },
    ),
  );
});
it("GM02 changing any client, token, identity or authorization lifetime breaks the credential binding", () => {
  const future = {
    ...binding,
    authorizedAt: new Date(now + 60000).toISOString(),
  };
  expect(gmailBinding(future, clientId, email, refresh, now)).toEqual(future);
  for (const expires of [now + 30000, now + 60000])
    expect(
      gmailBinding(
        {
          ...future,
          publishingStatus: "testing",
          testingExpiresAt: new Date(expires).toISOString(),
        },
        clientId,
        email,
        refresh,
        now,
      ),
    ).toBeNull();
  expect(
    gmailBinding(
      {
        ...future,
        publishingStatus: "testing",
        testingExpiresAt: new Date(now + 60001).toISOString(),
      },
      clientId,
      email,
      refresh,
      now,
    ),
  ).not.toBeNull();
  expect(
    gmailBinding(
      { ...binding, email: email.toUpperCase() },
      clientId,
      email.toUpperCase(),
      refresh,
      now,
    ),
  ).toBeNull();
  for (const subject of ["!google-subject", "google-subject!", "x".repeat(256)])
    expect(
      gmailBinding({ ...binding, subject }, clientId, email, refresh, now),
    ).toBeNull();
  expect(gmailBinding(binding, clientId, email, refresh, now)).toEqual(binding);
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s !== refresh),
      (token) => {
        expect(gmailBinding(binding, clientId, email, token, now)).toBeNull();
      },
    ),
  );
  for (const bad of [
    { ...binding, email: "other@gmail.com" },
    { ...binding, clientId: "other" },
    { ...binding, version: 2 },
    { ...binding, scopes: [GMAIL_SCOPES[0]] },
    { ...binding, authorizedAt: new Date(now + 60001).toISOString() },
    { ...binding, testingExpiresAt: new Date(now + 1).toISOString() },
    { ...binding, publishingStatus: "testing", testingExpiresAt: null },
    {
      ...binding,
      publishingStatus: "testing",
      testingExpiresAt: new Date(now + 7 * 86400000 + 1).toISOString(),
    },
  ])
    expect(gmailBinding(bad, clientId, email, refresh, now)).toBeNull();
  const testing = {
    ...binding,
    publishingStatus: "testing",
    testingExpiresAt: new Date(now + 7 * 86400000).toISOString(),
  };
  expect(gmailBinding(testing, clientId, email, refresh, now)).not.toBeNull();
  expect(
    gmailBinding(testing, clientId, email, refresh, now + 7 * 86400000),
  ).toBeNull();
});
it("GM03 MIME keeps arbitrary bounded Unicode content in encoded parts and cannot add recipients", () => {
  fc.assert(
    fc.property(
      fc.uuid(),
      fc.string({ minLength: 1, maxLength: 2000 }),
      fc.string({ minLength: 1, maxLength: 3000 }),
      (id, text, html) => {
        const raw = gmailMime(
          {
            status: "submit",
            attemptId: id,
            token: id,
            key: `reminder-email/${id}`,
            payload: {
              from: email,
              to: [email],
              reply_to: email,
              subject: "Credential renewal catch-up reminder",
              text,
              html,
              tags: [{ name: "reminder_attempt", value: id }],
            },
          },
          config,
        );
        const header = raw.split("\r\n\r\n")[0];
        expect(header.split("\r\n")).toEqual([
          `From: ${email}`,
          `To: ${email}`,
          `Reply-To: ${email}`,
          "Subject: Credential renewal catch-up reminder",
          "MIME-Version: 1.0",
          `Content-Type: multipart/alternative; boundary="license-radar-${id}"`,
        ]);
        expect(header.split("\r\n").filter((s) => s.startsWith("To:"))).toEqual(
          [`To: ${email}`],
        );
        expect(header).not.toContain("Bcc:");
        const parts = raw.split(`--license-radar-${id}`);
        expect(parts).toHaveLength(4);
        for (const [index, value] of [
          [1, text],
          [2, html],
        ] as const) {
          expect(parts[index].split("\r\n\r\n")[0].trim()).toBe(
            `Content-Type: text/${index === 1 ? "plain" : "html"}; charset=UTF-8\r\nContent-Transfer-Encoding: base64`,
          );
          const encoded = parts[index].split("\r\n\r\n")[1].trim();
          const lines = encoded.split("\r\n");
          expect(lines.every((line) => line.length <= 76)).toBe(true);
          expect(lines.slice(0, -1).every((line) => line.length === 76)).toBe(
            true,
          );
          expect(raw.endsWith(`--license-radar-${id}--\r\n`)).toBe(true);
          expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(
            Buffer.from(value, "utf8").toString("utf8"),
          );
        }
      },
    ),
    { numRuns: 100 },
  );
});
it("GM02 identity and access-token parsers return verified metadata and reject broadened grants or malformed headers", () => {
  const identity = {
    email: email.toUpperCase(),
    email_verified: true,
    sub: "google-subject",
  };
  expect(verifiedGmailIdentity(identity, email)).toEqual({
    email,
    subject: "google-subject",
  });
  expect(verifiedGmailIdentity(identity, email, "google-subject")).toEqual({
    email,
    subject: "google-subject",
  });
  expect(() => verifiedGmailIdentity(identity, email, "wrong")).toThrow(
    "Gmail identity unavailable",
  );
  for (const sub of ["!subject", "subject!", "x".repeat(256)])
    expect(() => verifiedGmailIdentity({ ...identity, sub }, email)).toThrow();
  const token = {
    access_token: "access-token",
    token_type: "Bearer",
    expires_in: 3600,
  };
  expect(gmailAccessToken(token)).toEqual(token);
  expect(
    gmailAccessToken({ ...token, scope: GMAIL_SCOPES.join(" ") }),
  ).toMatchObject(token);
  expect(() =>
    gmailAccessToken({ ...token, scope: GMAIL_SCOPES.join(" ") + " profile" }),
  ).toThrow("Gmail authorization unavailable");
  for (const access_token of [
    "\naccess-token",
    "access-token\n",
    "x".repeat(4097),
    "",
    "\u0000token",
    "access-token\r\n",
  ])
    expect(() => gmailAccessToken({ ...token, access_token })).toThrow();
  for (const sub of ["google-subject\n", "google-subject\r\n"]) {
    expect(() => verifiedGmailIdentity({ ...identity, sub }, email)).toThrow();
    expect(
      gmailBinding({ ...binding, subject: sub }, clientId, email, refresh, now),
    ).toBeNull();
  }
});
it("GM08 Google transport rejects redirect/empty/oversized bodies and cancels its stream and timer", async () => {
  vi.useFakeTimers();
  for (const status of [300, 302, 399]) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status })),
    );
    await expect(googleJson("send", {}, 10000)).rejects.toThrow(
      "Google request unavailable",
    );
    expect(vi.getTimerCount()).toBe(0);
  }
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
  await expect(googleJson("send", {}, 10000)).rejects.toThrow(
    "Google request unavailable",
  );
  for (const size of [65536, 65537]) {
    const cancel = vi.fn(),
      stream = new ReadableStream({
        start(controller) {
          const raw = JSON.stringify({ padding: "x".repeat(size - 14) });
          controller.enqueue(new TextEncoder().encode(raw.slice(0, 30000)));
          controller.enqueue(new TextEncoder().encode(raw.slice(30000)));
          controller.close();
        },
        cancel,
      });
    const f = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal("fetch", f);
    if (size === 65536)
      expect((await googleJson("send", {}, 10000)).body).toHaveProperty(
        "padding",
      );
    else
      await expect(googleJson("send", {}, 10000)).rejects.toThrow(
        "Google response unavailable",
      );
    expect(f.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  }
});
it("GM05 a deadline bounds delayed headers and bodies rather than only response arrival", async () => {
  vi.useFakeTimers();
  for (const kind of ["headers", "body"]) {
    const pending =
      kind === "headers"
        ? new Promise<Response>(() => {})
        : Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('{"id":"'));
                },
              }),
            ),
          );
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending));
    const result = googleJson("send", { method: "POST" }, 10000);
    const assertion = expect(result).rejects.toThrow(
      "Google request unavailable",
    );
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
  }
});
it("GM05 preauthorization bounds both Google calls and post-call cache never repeats a permission", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "access-fixture",
          token_type: "Bearer",
          expires_in: 60,
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ email, email_verified: true, sub: binding.subject }),
      ),
    )
    .mockResolvedValue(new Response(JSON.stringify({ id: "19a8df" })));
  vi.stubGlobal("fetch", f);
  const provider = await authorizeGmail(config),
    id = "10000000-0000-4000-8000-000000000001",
    s = {
      status: "submit" as const,
      attemptId: id,
      token: id,
      key: `reminder-email/${id}`,
      payload: {
        from: email,
        to: [email] as [string],
        reply_to: email,
        subject: "Credential renewal reminder: 60 days" as const,
        text: "Review",
        html: "<p>Review</p>",
        tags: [{ name: "reminder_attempt" as const, value: id }] as [
          { name: "reminder_attempt"; value: string },
        ],
      },
    };
  expect((await provider.send(s)).outcome).toBe("accepted");
  expect((await provider.send(s)).outcome).toBe("uncertain");
  expect(f).toHaveBeenCalledTimes(3);
});
