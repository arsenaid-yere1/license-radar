import { expect, it } from "vitest";
import {
  emailConfig,
  emailWebhookConfig,
  reminderWorkerSecret,
} from "./config";
const secret =
  "whsec_" +
  Buffer.from("fixture-signing-secret-e4-s2-only!").toString("base64");
const live = {
  EMAIL_REMINDERS_ENABLED: "true",
  EMAIL_PROVIDER_NAMESPACE: "reminder-team",
  EMAIL_FROM: "reminders@clinic.example.com",
  EMAIL_REPLY_TO: "support@clinic.example.com",
  REMINDER_APP_URL: "https://radar.clinic.example.com",
  RESEND_API_KEY: "re_live_test_value_only",
  RESEND_WEBHOOK_SECRET: secret,
  REMINDER_WORKER_SECRET: "worker-secret-fixture-with-32-characters",
};
const fixture = {
  EMAIL_PROVIDER_FIXTURE: "local-e4-s2",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  EMAIL_FIXTURE_URL: "http://127.0.0.1:55326",
  EMAIL_FIXTURE_TOKEN: "local-fixture-only-e4-s2",
  REMINDER_APP_URL: "http://127.0.0.1:3000",
  EMAIL_REMINDERS_ENABLED: "true",
};
it("EC01 configuration defaults off and email never depends on SMS settings", () => {
  expect(emailConfig({})).toBeNull();
  expect(
    emailConfig({ ...live, EMAIL_REMINDERS_ENABLED: undefined }),
  ).toBeNull();
  expect(emailConfig(live)).toMatchObject({
    mode: "live",
    namespace: "reminder-team",
    baseUrl: "https://api.resend.com",
    from: live.EMAIL_FROM,
  });
  expect(emailConfig({ ...live, SMS_LIVE_ENABLED: "false" })).toEqual(
    emailConfig(live),
  );
});
it("EC02 callbacks remain configured with sending disabled", () => {
  const off = { ...live, EMAIL_REMINDERS_ENABLED: "false" };
  expect(emailConfig(off)).toBeNull();
  expect(emailWebhookConfig(off)).toMatchObject({
    webhookSecret: secret,
    namespace: "reminder-team",
  });
});
it("EC03 live config rejects missing keys, header injection, test senders and noncanonical app origins", () => {
  for (const key of [
    "EMAIL_PROVIDER_NAMESPACE",
    "EMAIL_FROM",
    "EMAIL_REPLY_TO",
    "REMINDER_APP_URL",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
  ])
    expect(emailConfig({ ...live, [key]: undefined }), key).toBeNull();
  for (const from of [
    "onboarding@resend.dev",
    "fixture@example.test",
    "a@example.com\r\nBcc: b@example.com",
  ])
    expect(emailConfig({ ...live, EMAIL_FROM: from })).toBeNull();
  for (const url of [
    "http://clinic.example.com",
    "https://user:password@clinic.example.com",
    "https://clinic.example.com/path",
    "https://clinic.example.com?x=1",
    "https://clinic.example.com#x",
  ])
    expect(emailConfig({ ...live, REMINDER_APP_URL: url })).toBeNull();
  for (const namespace of ["", "../../tenant", "unsafe namespace"])
    expect(
      emailConfig({ ...live, EMAIL_PROVIDER_NAMESPACE: namespace }),
    ).toBeNull();
  expect(
    emailWebhookConfig({ ...live, RESEND_WEBHOOK_SECRET: "bad-secret" }),
  ).toBeNull();
});
it("EC04 fixture config requires every fixed local guard and refuses deployments or live provider credentials", () => {
  expect(emailConfig(fixture)).toMatchObject({
    mode: "fixture",
    baseUrl: "http://127.0.0.1:55326",
    namespace: "fixture-reminders",
    from: "reminders@example.test",
  });
  for (const key of [
    "EMAIL_PROVIDER_FIXTURE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "EMAIL_FIXTURE_URL",
    "EMAIL_FIXTURE_TOKEN",
    "REMINDER_APP_URL",
  ])
    expect(emailConfig({ ...fixture, [key]: "unexpected" }), key).toBeNull();
  for (const key of [
    "VERCEL",
    "VERCEL_ENV",
    "CI_DEPLOYMENT",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
  ])
    expect(emailConfig({ ...fixture, [key]: "present" }), key).toBeNull();
});
it("EC05 worker bearer is separately configured and never falls back to a sending key", () => {
  expect(reminderWorkerSecret({})).toBeNull();
  expect(
    reminderWorkerSecret({ ...live, REMINDER_WORKER_SECRET: "short" }),
  ).toBeNull();
  expect(reminderWorkerSecret(live)).toBe(live.REMINDER_WORKER_SECRET);
  expect(reminderWorkerSecret(fixture)).toBe(
    "local-worker-fixture-only-e4-s2-authorization",
  );
  expect(reminderWorkerSecret({ ...fixture, VERCEL: "1" })).toBeNull();
});
it("EC06 canonical prefix/suffix and fixture return values preserve exact configuration", () => {
  expect(emailConfig(fixture)).toEqual({
    mode: "fixture",
    namespace: "fixture-reminders",
    from: "reminders@example.test",
    replyTo: "support@example.test",
    appUrl: fixture.REMINDER_APP_URL,
    baseUrl: fixture.EMAIL_FIXTURE_URL,
    apiKey: fixture.EMAIL_FIXTURE_TOKEN,
    webhookSecret: secret,
  });
  for (const from of [
    "mail@resend.dev.example.com",
    "mail@unit.test.example.com",
  ])
    expect(emailConfig({ ...live, EMAIL_FROM: from })?.from).toBe(from);
  for (const from of ["mail@RESEND.DEV", "mail@EXAMPLE.TEST"])
    expect(emailConfig({ ...live, EMAIL_FROM: from })).toBeNull();
  expect(
    emailConfig({ ...live, REMINDER_APP_URL: "https://unit.test.example.com/" })
      ?.appUrl,
  ).toBe("https://unit.test.example.com");
  for (const url of [
    "https://localhost",
    "https://mail.test",
    "https://mail.local",
    "https://mail.invalid",
  ])
    expect(emailConfig({ ...live, REMINDER_APP_URL: url })).toBeNull();
  for (const key of ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET"])
    for (const value of [
      "!" + live[key as "RESEND_API_KEY" | "RESEND_WEBHOOK_SECRET"],
      live[key as "RESEND_API_KEY" | "RESEND_WEBHOOK_SECRET"] + "!",
    ])
      expect(emailConfig({ ...live, [key]: value })).toBeNull();
  for (const value of [
    "!" + live.REMINDER_WORKER_SECRET,
    live.REMINDER_WORKER_SECRET + "!",
    "x".repeat(257),
  ])
    expect(
      reminderWorkerSecret({ ...live, REMINDER_WORKER_SECRET: value }),
    ).toBeNull();
});
