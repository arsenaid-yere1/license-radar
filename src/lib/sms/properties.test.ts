import { expect, test } from "vitest";
import fc from "fast-check";
import {
  codeSchema,
  databaseResultSchema,
  enrollmentSchema,
  phoneSchema,
  readinessSchema,
  smsInputSchema,
} from "./schema";
const options = { numRuns: 1000, seed: 20261008 };
const requestId = "11111111-1111-4111-8111-111111111111";
const blank = {
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
test("Phone syntax is explicit international ASCII — generated boundaries", () => {
  for (const whitespace of ["\t", "\n", "\r", "\f", "\v", " "])
    expect(phoneSchema.parse(`${whitespace}+12025550123${whitespace}`)).toBe(
      "+12025550123",
    );
  for (const invalid of [
    "x+12",
    "+12x",
    "+1 2",
    "+1\t2",
    "+1\v2",
    "+1\n2",
    "\u00a0+12",
    "+12\u00a0",
    "+１２",
    "+12025550123 ext 4",
  ])
    expect(phoneSchema.safeParse(invalid).success).toBe(false);
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 20 }),
      fc.boolean(),
      (digits, plus) => {
        const raw = (plus ? "+" : "") + digits.join("");
        const valid =
          plus && digits.length >= 2 && digits.length <= 15 && digits[0] !== 0;
        expect(phoneSchema.safeParse(raw).success).toBe(valid);
        expect(phoneSchema.safeParse(` \t${raw}\r\n`).success).toBe(valid);
      },
    ),
    options,
  );
  fc.assert(
    fc.property(fc.string(), (raw) => {
      const normalized = raw.replace(/^[\t\n\r\f\v ]+|[\t\n\r\f\v ]+$/g, "");
      const parsed = phoneSchema.safeParse(raw);
      expect(parsed.success).toBe(/^\+[1-9][0-9]{1,14}$/.test(normalized));
      if (parsed.success) expect(parsed.data).toBe(normalized);
    }),
    options,
  );
});
test("Code checks are bounded and serialized — generated syntax", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 10 }),
      (digits) => {
        expect(codeSchema.safeParse(digits.join("")).success).toBe(
          digits.length === 6,
        );
      },
    ),
    options,
  );
});
test("Only the active owner can prepare verification — strict inputs", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -10, max: 2147483650 }),
      fc.boolean(),
      (version, agreed) => {
        const valid = version >= 1 && version <= 2147483647 && agreed;
        for (const input of [
          {
            intent: "send",
            requestId,
            expectedVersion: version,
            phone: "+12025550123",
            otpPermission: agreed,
            changeConfirmed: false,
          },
          {
            intent: "consent",
            requestId,
            expectedVersion: version,
            consent: agreed,
          },
        ]) {
          expect(smsInputSchema.safeParse(input).success).toBe(valid);
          for (const key of [
            "actorId",
            "membershipId",
            "practiceId",
            "approved",
            "disclosureVersion",
          ])
            expect(
              smsInputSchema.safeParse({ ...input, [key]: "foreign" }).success,
            ).toBe(false);
        }
      },
    ),
    options,
  );
  for (const intent of ["send", "check", "consent", "withdraw"])
    expect(smsInputSchema.safeParse({ intent, requestId: "bad" }).success).toBe(
      false,
    );
  expect(
    smsInputSchema.parse({
      intent: "check",
      requestId,
      code: "123456",
      challengeId: requestId,
      expectedVersion: 2147483647,
    }).intent,
  ).toBe("check");
});
test("Selected readiness requires personal current enrollment — coherent safe projection", () => {
  for (const patch of [
    { phoneRevision: 0, phoneSuffix: "0123" },
    { phoneRevision: 1, phoneSuffix: null },
    { phoneRevision: 0, phoneSuffix: null },
  ])
    expect(
      enrollmentSchema.safeParse({ ...blank, verified: true, ...patch })
        .success,
    ).toBe(false);
  for (const field of ["expiresAt", "retryAfter"])
    for (const timestamp of [
      "2026-10-08T12:00:00Z",
      "2026-10-08T12:00:00-07:00",
      "2026-10-08T12:00:00+05:30",
    ])
      expect(
        enrollmentSchema.parse({ ...blank, [field]: timestamp })[
          field as "expiresAt" | "retryAfter"
        ],
      ).toBe(timestamp);
  for (const reason of [
    "no-recipient",
    "member-unavailable",
    "not-started",
    "verification-pending",
    "verification-uncertain",
    "consent-required",
    "withdrawn",
    "provider-opted-out",
    "enrolled",
  ]) {
    for (const ready of [true, false])
      expect(
        readinessSchema.safeParse({
          reason,
          enrollmentReady: ready,
          deliveryActive: false,
        }).success,
      ).toBe(ready === (reason === "enrolled"));
    expect(
      readinessSchema.safeParse({
        reason,
        enrollmentReady: reason === "enrolled",
        deliveryActive: true,
      }).success,
    ).toBe(false);
  }
  fc.assert(
    fc.property(
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      (verified, consented, enrolled) => {
        const input = {
          ...blank,
          phoneRevision: verified ? 1 : 0,
          phoneSuffix: verified ? "0123" : null,
          verified,
          consented,
          reason: enrolled ? "enrolled" : "not-started",
        };
        expect(enrollmentSchema.safeParse(input).success).toBe(
          consented === enrolled && (!consented || verified),
        );
      },
    ),
    options,
  );
  for (const status of [
    "success",
    "conflict",
    "blocked",
    "confirmation-required",
    "busy",
    "uncertain",
    "verification-required",
    "rate-limited",
    "wrong-code",
  ]) {
    expect(
      databaseResultSchema.parse({
        status,
        enrollment: blank,
        code: "private",
      }),
    ).toEqual({ status, enrollment: blank });
  }
  for (const field of ["version", "phoneRevision"])
    for (const value of [-1, 2147483648, 1.5, NaN])
      expect(
        enrollmentSchema.safeParse({ ...blank, [field]: value }).success,
      ).toBe(false);
  for (const phoneSuffix of ["123", "12345", "abcd"])
    expect(enrollmentSchema.safeParse({ ...blank, phoneSuffix }).success).toBe(
      false,
    );
  expect(
    enrollmentSchema.parse({
      ...blank,
      phoneSuffix: "0123",
      phoneRevision: 2147483647,
    }),
  ).toMatchObject({ phoneSuffix: "0123" });
});
