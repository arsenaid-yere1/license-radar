import { expect, test } from "vitest";
import {
  codeSchema,
  enrollmentSchema,
  phoneSchema,
  smsInputSchema,
} from "./schema";
const requestId = "96c83e5d-d7f5-437f-a897-354311d9e617";
test("Phone syntax is explicit international ASCII", () => {
  expect(phoneSchema.parse(" \t+12025550123\n")).toBe("+12025550123");
  for (const value of [
    "2025550123",
    "+012",
    "+1",
    "+1234567890123456",
    "+１２３",
    "\u00a0+12025550123",
    "+12025550123 x5",
    "+1202 5550123",
    "+123\u00a0",
  ])
    expect(phoneSchema.safeParse(value).success).toBe(false);
  expect(phoneSchema.parse("+12")).toBe("+12");
  expect(phoneSchema.parse("+123456789012345")).toBe("+123456789012345");
});
test("Code checks are bounded and serialized", () => {
  expect(codeSchema.parse("123456")).toBe("123456");
  for (const code of [
    "12345",
    "1234567",
    "１２３４５６",
    " 123456",
    "123456\n",
    "abcdef",
  ])
    expect(codeSchema.safeParse(code).success).toBe(false);
});
test("Only the active owner can prepare verification", () => {
  const send = {
    intent: "send",
    requestId,
    phone: "+12025550123",
    expectedVersion: 1,
    otpPermission: true,
    changeConfirmed: false,
  };
  expect(smsInputSchema.parse(send)).toEqual(send);
  for (const extra of [
    { actorId: requestId },
    { practiceId: requestId },
    { approved: true },
    { disclosure: "fake" },
    { otpPermission: false },
    { expectedVersion: 0 },
  ])
    expect(smsInputSchema.safeParse({ ...send, ...extra }).success).toBe(false);
  expect(
    smsInputSchema.safeParse({
      intent: "consent",
      requestId,
      expectedVersion: 1,
      consent: false,
    }).success,
  ).toBe(false);
  expect(smsInputSchema.parse({ intent: "withdraw", requestId })).toEqual({
    intent: "withdraw",
    requestId,
  });
});
test("Verification needs separate reminder consent", () => {
  const base = {
    version: 1,
    phoneRevision: 0,
    phoneSuffix: null,
    verified: false,
    consented: false,
    canEdit: true,
    reason: "not-started",
    challengeId: null,
    expiresAt: null,
    retryAfter: null,
    deliveryActive: false,
  };
  expect(
    enrollmentSchema.parse({ ...base, code: "private", phone: "private" }),
  ).toEqual(base);
  expect(enrollmentSchema.safeParse({ ...base, consented: true }).success).toBe(
    false,
  );
  expect(
    enrollmentSchema.safeParse({ ...base, deliveryActive: true }).success,
  ).toBe(false);
});

test("Malformed state fails unavailable", () => {
  const base = {
    version: 1,
    phoneRevision: 0,
    phoneSuffix: null,
    verified: false,
    consented: false,
    canEdit: true,
    reason: "not-started",
    challengeId: null,
    expiresAt: null,
    retryAfter: null,
    deliveryActive: false,
  };
  expect(
    enrollmentSchema.safeParse({ ...base, reason: "enrolled" }).success,
  ).toBe(false);
  expect(
    enrollmentSchema.safeParse({
      ...base,
      verified: true,
      consented: true,
      reason: "enrolled",
    }).success,
  ).toBe(false);
  expect(
    enrollmentSchema.safeParse({
      ...base,
      phoneRevision: 1,
      phoneSuffix: "0123",
      verified: true,
      consented: true,
      reason: "enrolled",
    }).success,
  ).toBe(true);
});
