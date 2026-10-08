import { afterEach, expect, test, vi } from "vitest";
import { createProvider, matchingOutcome } from "@/lib/sms/provider";
import { callbackConfig, smsConfig, fixtureAllowed } from "@/lib/sms/config";
import type { Claim } from "@/lib/sms/repository";
const fixture = {
  SMS_PROVIDER_FIXTURE: "local-e4-s1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  SMS_FIXTURE_URL: "http://127.0.0.1:55325",
  SMS_APP_URL: "http://127.0.0.1:3000",
  SMS_FIXTURE_TOKEN: "local-fixture-only-e4-s1",
};
const live = {
  TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`,
  TWILIO_MESSAGING_SERVICE_SID: `MG${"2".repeat(32)}`,
  TWILIO_VERIFY_SERVICE_SID: `VA${"3".repeat(32)}`,
  SMS_SUPPORT_EMAIL: "help@example.test",
  TWILIO_API_KEY_SID: `SK${"4".repeat(32)}`,
  TWILIO_API_KEY_SECRET: "test-api-credential",
  TWILIO_AUTH_TOKEN: "test-auth-credential",
  SMS_WEBHOOK_URL: "https://app.example.test/api/sms/twilio/inbound",
  SMS_SENDER_ALLOWLIST: "+12025550000",
  SMS_LIVE_ENABLED: "true",
  SMS_TERMS_REVIEWED: "e4-s1-v1",
};
const claim: Claim = {
  status: "claimed",
  claimToken: crypto.randomUUID(),
  phone: "+12025550123",
  accountSid: live.TWILIO_ACCOUNT_SID,
  messagingServiceSid: live.TWILIO_MESSAGING_SERVICE_SID,
  verifyServiceSid: live.TWILIO_VERIFY_SERVICE_SID,
  verificationSid: null,
  challengeId: crypto.randomUUID(),
};
const response = {
  accountSid: claim.accountSid,
  serviceSid: claim.verifyServiceSid,
  to: claim.phone,
  sid: `VE${"5".repeat(32)}`,
  channel: "sms",
  status: "pending",
};
afterEach(() => vi.unstubAllGlobals());
test("Fixture mode fails closed", () => {
  expect(fixtureAllowed(fixture)).toBe(true);
  expect(smsConfig(fixture)?.mode).toBe("fixture");
  expect(callbackConfig(fixture)?.url).toBe(
    "http://127.0.0.1:3000/api/sms/twilio/inbound",
  );
  expect(smsConfig(fixture)).toEqual({
    mode: "fixture",
    accountSid: `AC${"1".repeat(32)}`,
    messagingServiceSid: `MG${"2".repeat(32)}`,
    verifyServiceSid: `VA${"3".repeat(32)}`,
    supportEmail: "sms-support@example.test",
    fixtureURL: "http://127.0.0.1:55325",
    fixtureToken: "local-fixture-only-e4-s1",
  });
  expect(callbackConfig(fixture)).toEqual({
    accountSid: `AC${"1".repeat(32)}`,
    messagingServiceSid: `MG${"2".repeat(32)}`,
    authToken: "local-callback-fixture-only",
    url: "http://127.0.0.1:3000/api/sms/twilio/inbound",
    senders: ["+12025550000"],
  });
  for (const [key, value] of Object.entries(fixture)) {
    expect(fixtureAllowed({ ...fixture, [key]: undefined })).toBe(false);
    expect(fixtureAllowed({ ...fixture, [key]: `${value}bad` })).toBe(false);
    expect(smsConfig({ ...fixture, [key]: "bad" })).toBeNull();
    expect(callbackConfig({ ...fixture, [key]: "bad" })).toBeNull();
  }
  for (const key of [
    "VERCEL",
    "VERCEL_ENV",
    "CI_DEPLOYMENT",
    "TWILIO_API_KEY_SID",
    "TWILIO_API_KEY_SECRET",
    "TWILIO_AUTH_TOKEN",
  ])
    expect(smsConfig({ ...fixture, [key]: "present" })).toBeNull();
  expect(smsConfig({ ...fixture, SMS_LIVE_ENABLED: "true" })).toBeNull();
});
test("Missing setup disables collection and sending", () => {
  expect(smsConfig({})).toBeNull();
  expect(callbackConfig({})).toBeNull();
  expect(smsConfig(live)?.mode).toBe("live");
  for (const key of Object.keys(live)) {
    expect(smsConfig({ ...live, [key]: undefined })).toBeNull();
  }
  expect(smsConfig({ ...live, SMS_LIVE_ENABLED: "false" })).toBeNull();
  expect(callbackConfig({ ...live, SMS_LIVE_ENABLED: "false" })).not.toBeNull();
  for (const key of [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_MESSAGING_SERVICE_SID",
    "TWILIO_VERIFY_SERVICE_SID",
    "TWILIO_API_KEY_SID",
  ] as const)
    for (const invalid of [
      "bad",
      `x${live[key]}`,
      `${live[key]}x`,
      live[key].slice(0, -1),
    ])
      expect(smsConfig({ ...live, [key]: invalid })).toBeNull();
  expect(
    callbackConfig({
      ...live,
      SMS_SENDER_ALLOWLIST: Array(20).fill("+12025550000").join(","),
    })?.senders,
  ).toHaveLength(20);
  for (const url of [
    "http://app.example.test/api/sms/twilio/inbound",
    "https://user:pass@app.example.test/api/sms/twilio/inbound",
    "https://app.example.test/other",
    "https://app.example.test/api/sms/twilio/inbound?bad=1",
    "https://app.example.test/api/sms/twilio/inbound#bad",
  ])
    expect(callbackConfig({ ...live, SMS_WEBHOOK_URL: url })).toBeNull();
  for (const sender of [
    "",
    "bad",
    "+012",
    "x+12",
    "+12x",
    Array(21).fill("+12025550000").join(","),
  ])
    expect(
      callbackConfig({ ...live, SMS_SENDER_ALLOWLIST: sender }),
    ).toBeNull();
});
test("Only trusted matching approval records proof", () => {
  expect(
    matchingOutcome({ ...response, private: "strip" }, claim, "send"),
  ).toEqual(response);
  for (const patch of [
    { accountSid: "bad" },
    { serviceSid: "bad" },
    { to: "bad" },
    { sid: "bad" },
    { sid: `x${response.sid}` },
    { sid: `${response.sid}x` },
    { channel: "call" },
    { status: "approved" },
    { status: "bad" },
  ])
    expect(matchingOutcome({ ...response, ...patch }, claim, "send")).toEqual({
      status: "uncertain",
    });
  expect(matchingOutcome(null, claim, "check")).toEqual({
    status: "uncertain",
  });
  expect(
    matchingOutcome(
      { ...response, status: "approved" },
      { ...claim, verificationSid: response.sid },
      "check",
    ),
  ).toEqual({ ...response, status: "approved" });
  expect(
    matchingOutcome(
      response,
      { ...claim, verificationSid: `VE${"6".repeat(32)}` },
      "check",
    ),
  ).toEqual({ status: "uncertain" });
  for (const status of [
    "pending",
    "canceled",
    "max_attempts_reached",
    "deleted",
    "failed",
    "expired",
  ])
    expect(matchingOutcome({ ...response, status }, claim, "check")).toEqual({
      ...response,
      status,
    });
});
test("Requests are immutable and claimed once", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => response });
  vi.stubGlobal("fetch", fetcher);
  const provider = createProvider(smsConfig(fixture)!);
  expect(await provider.send(claim)).toEqual(response);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:55325/send");
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    cache: "no-store",
    method: "POST",
    headers: {
      Authorization: "Bearer local-fixture-only-e4-s1",
      "Content-Type": "application/json",
    },
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ claim });
  await provider.check(claim, "123456");
  expect(fetcher.mock.calls[1][0]).toBe("http://127.0.0.1:55325/check");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    claim,
    code: "123456",
  });
  fetcher.mockResolvedValue({ ok: false });
  await expect(provider.send(claim)).rejects.toThrow(
    "Verification unavailable",
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test("Live adapter disables retries and binds the known verification SID", async () => {
  const sdk = await import("twilio");
  const send = vi.fn().mockResolvedValue(response),
    check = vi.fn().mockResolvedValue({ ...response, status: "approved" });
  const service = vi.fn().mockReturnValue({
    verifications: { create: send },
    verificationChecks: { create: check },
  });
  // Stub the SDK network boundary; the adapter and matching logic execute unchanged.
  const create = vi.spyOn(sdk.default, "Twilio");
  create.mockImplementation(function () {
    return {
      verify: { v2: { services: service } },
    } as unknown as ReturnType<typeof sdk.default>;
  });
  try {
    const provider = createProvider(smsConfig(live)!);
    await provider.send(claim);
    await provider.check({ ...claim, verificationSid: response.sid }, "123456");
    expect(create).toHaveBeenCalledWith(
      live.TWILIO_API_KEY_SID,
      live.TWILIO_API_KEY_SECRET,
      { accountSid: live.TWILIO_ACCOUNT_SID, autoRetry: false, timeout: 10000 },
    );
    expect(service).toHaveBeenCalledWith(live.TWILIO_VERIFY_SERVICE_SID);
    expect(send).toHaveBeenCalledWith({ to: claim.phone, channel: "sms" });
    expect(check).toHaveBeenCalledWith({
      verificationSid: response.sid,
      code: "123456",
    });
  } finally {
    create.mockRestore();
  }
});
