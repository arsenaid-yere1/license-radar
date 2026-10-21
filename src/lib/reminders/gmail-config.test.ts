import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { gmailConfig, selectedEmailProvider } from "./gmail-config";
function environment(patch: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    EMAIL_PROVIDER: "gmail",
    EMAIL_REMINDERS_ENABLED: "true",
    GMAIL_PROVIDER_NAMESPACE: "gmail-pilot",
    GMAIL_SENDER_EMAIL: "fixture@gmail.com",
    GMAIL_REPLY_TO: "fixture@gmail.com",
    GMAIL_ALLOWED_RECIPIENT: "fixture@gmail.com",
    GMAIL_OAUTH_CLIENT_ID: "fixture.apps.googleusercontent.com",
    GMAIL_OAUTH_CLIENT_SECRET: "secret-fixture",
    GMAIL_OAUTH_REFRESH_TOKEN: "refresh-fixture",
    REMINDER_APP_URL: "https://example.com",
    ...patch,
  };
  const binding = {
    version: 1,
    email: env.GMAIL_SENDER_EMAIL,
    subject: "google-subject",
    clientId: env.GMAIL_OAUTH_CLIENT_ID,
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/userinfo.email",
      "openid",
    ],
    authorizedAt: new Date().toISOString(),
    publishingStatus: "production",
    testingExpiresAt: null,
    refreshTokenSha256: createHash("sha256")
      .update(env.GMAIL_OAUTH_REFRESH_TOKEN ?? "")
      .digest("hex"),
  };
  return { ...env, GMAIL_OAUTH_BINDING: JSON.stringify(binding) };
}
it("GM01 provider selection is explicit and does not inherit Resend secrets", () => {
  expect(selectedEmailProvider({})).toBe("resend");
  expect(selectedEmailProvider({ EMAIL_PROVIDER: "resend" })).toBe("resend");
  expect(selectedEmailProvider({ EMAIL_PROVIDER: "gmail" })).toBe("gmail");
  for (const value of ["", "GMAIL", "Resend", " gmail", "gmail ", "other"]) {
    expect(selectedEmailProvider({ EMAIL_PROVIDER: value })).toBeNull();
    expect(gmailConfig(environment({ EMAIL_PROVIDER: value }))).toBeNull();
  }
  for (const value of [undefined, "resend"])
    expect(gmailConfig(environment({ EMAIL_PROVIDER: value }))).toBeNull();
  const cleanEnvironment = environment(),
    clean = gmailConfig(cleanEnvironment);
  expect(clean).not.toBeNull();
  const retained = gmailConfig({
    ...cleanEnvironment,
    RESEND_API_KEY: "retained-fixture",
    RESEND_WEBHOOK_SECRET: "retained-fixture",
  });
  expect(retained).toEqual(clean);
  for (const field of [
    "EMAIL_PROVIDER_FIXTURE",
    "EMAIL_FIXTURE_URL",
    "EMAIL_FIXTURE_TOKEN",
  ])
    expect(gmailConfig(environment({ [field]: "fixture" }))).toBeNull();
});
it("GM01 Gmail namespace, credentials and client ID enforce exact grammar and inclusive bounds", () => {
  for (const value of ["a", "A_-0".repeat(20)])
    expect(
      gmailConfig(environment({ GMAIL_PROVIDER_NAMESPACE: value }))?.namespace,
    ).toBe(value);
  for (const value of [
    "",
    "x".repeat(81),
    "!gmail-pilot",
    "gmail-pilot!",
    "gmail-pilot\n",
    "gmail-pilot\u0000",
  ])
    expect(
      gmailConfig(environment({ GMAIL_PROVIDER_NAMESPACE: value })),
    ).toBeNull();
  for (const field of [
    "GMAIL_OAUTH_CLIENT_SECRET",
    "GMAIL_OAUTH_REFRESH_TOKEN",
  ]) {
    for (const size of [8, 4096])
      expect(
        gmailConfig(environment({ [field]: "x".repeat(size) })),
      ).not.toBeNull();
    for (const value of [
      "x".repeat(7),
      "x".repeat(4097),
      "\u0000secret-fixture",
      "secret-fixture\u0000",
      "secret-fixture\n",
      "secret fixture",
    ])
      expect(gmailConfig(environment({ [field]: value }))).toBeNull();
  }
  for (const id of [
    "!fixture.apps.googleusercontent.com",
    "fixture.apps.googleusercontent.com!",
    "fixture.apps.googleusercontentXcom",
    "fixture.appsXgoogleusercontent.com",
  ])
    expect(gmailConfig(environment({ GMAIL_OAUTH_CLIENT_ID: id }))).toBeNull();
});
it("GM01 only the same authorized Gmail sender/recipient/reply-to and a canonical public HTTPS origin are accepted", () => {
  for (const patch of [
    { GMAIL_REPLY_TO: "other@gmail.com" },
    { GMAIL_ALLOWED_RECIPIENT: "other@gmail.com" },
    {
      GMAIL_SENDER_EMAIL: "Fixture@gmail.com",
      GMAIL_REPLY_TO: "Fixture@gmail.com",
      GMAIL_ALLOWED_RECIPIENT: "Fixture@gmail.com",
    },
    {
      GMAIL_SENDER_EMAIL: "fixture@example.com",
      GMAIL_REPLY_TO: "fixture@example.com",
      GMAIL_ALLOWED_RECIPIENT: "fixture@example.com",
    },
  ])
    expect(gmailConfig(environment(patch))).toBeNull();
  for (const url of [
    "http://example.com",
    "https://localhost",
    "https://example.test",
    "https://example.invalid",
    "https://example.local",
    "https://example.com/",
    "https://example.com/path",
    "https://example.com?secret=x",
    "https://example.com#fragment",
    "https://name:password@example.com",
  ])
    expect(gmailConfig(environment({ REMINDER_APP_URL: url }))).toBeNull();
  expect(
    gmailConfig(
      environment({ REMINDER_APP_URL: "https://mail.test.example.com" }),
    )?.appUrl,
  ).toBe("https://mail.test.example.com");
});
it("GM02 binding size has a hard inclusive boundary and rejects private extras", () => {
  const env = environment(),
    raw = env.GMAIL_OAUTH_BINDING;
  expect(
    gmailConfig({ ...env, GMAIL_OAUTH_BINDING: raw.padEnd(4096, " ") }),
  ).not.toBeNull();
  expect(
    gmailConfig({ ...env, GMAIL_OAUTH_BINDING: raw.padEnd(4097, " ") }),
  ).toBeNull();
  expect(
    gmailConfig({
      ...env,
      GMAIL_OAUTH_BINDING: JSON.stringify({
        ...JSON.parse(raw),
        extra: "untrusted",
      }),
    }),
  ).toBeNull();
});
