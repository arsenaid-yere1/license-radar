import fc from "fast-check";
import { expect, it } from "vitest";
import {
  preferenceInputSchema,
  preferenceSchema,
  scheduleSchema,
} from "./schema";
import {
  emailPayloadSchema,
  submissionSchema,
  preferenceFormInput,
} from "./messages";
const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const payload = {
  from: "reminders@example.com",
  to: ["fixture@example.test"],
  reply_to: "support@example.com",
  subject: "Credential renewal reminder: 60 days",
  text: "Sign in.",
  html: "<p>Sign in.</p>",
  tags: [{ name: "reminder_attempt", value: id }],
};
const options = { seed: 20261008, numRuns: 1000 };
it("RP01 preferences preserve exact boolean and PostgreSQL version boundaries without posted authority", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -2, max: 2147483650 }),
      fc.boolean(),
      (version, enabled) => {
        const valid = version >= 1 && version <= 2147483647,
          input = { requestId: id, enabled, expectedVersion: version };
        expect(preferenceInputSchema.safeParse(input).success).toBe(valid);
        expect(
          preferenceSchema.safeParse({ enabled, version, canEnable: false })
            .success,
        ).toBe(valid);
        for (const key of ["practiceId", "userId", "email", "smsConsent"])
          expect(
            preferenceInputSchema.safeParse({ ...input, [key]: id }).success,
          ).toBe(false);
      },
    ),
    options,
  );
  for (const input of [
    { requestId: "bad", enabled: false, expectedVersion: 1 },
    { requestId: id, enabled: "false", expectedVersion: 1 },
    { requestId: id, enabled: true, expectedVersion: 1.5 },
  ])
    expect(preferenceInputSchema.safeParse(input).success).toBe(false);
});
it("RP02 frozen payloads bind one destination, exact opaque tag/key and bounded bodies", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 3001 }), (length) => {
      expect(
        emailPayloadSchema.safeParse({ ...payload, text: "x".repeat(length) })
          .success,
      ).toBe(length >= 1 && length <= 2000);
      expect(
        emailPayloadSchema.safeParse({ ...payload, html: "x".repeat(length) })
          .success,
      ).toBe(length >= 1 && length <= 3000);
    }),
    options,
  );
  const submission = {
    status: "submit",
    attemptId: id,
    token: other,
    key: `reminder-email/${id}`,
    payload,
  };
  expect(submissionSchema.parse(submission)).toEqual(submission);
  for (const patch of [
    { key: "" },
    { key: `reminder-email/${other}` },
    { attemptId: other },
    { token: "bad" },
    { status: "accepted" },
    { extra: "private" },
    {
      payload: {
        ...payload,
        tags: [{ name: "reminder_attempt", value: other }],
      },
    },
  ])
    expect(
      submissionSchema.safeParse({ ...submission, ...patch }).success,
    ).toBe(false);
  for (const patch of [
    { from: "bad" },
    { reply_to: "bad" },
    { to: [] },
    { to: ["one@example.com", "two@example.com"] },
    { to: ["bad"] },
    { subject: "changed" },
    { tags: [] },
    { tags: [{ name: "foreign", value: id }] },
    { tags: [{ name: "reminder_attempt", value: "bad" }] },
    { tags: [{ name: "reminder_attempt", value: id, private: true }] },
    { scheduled_at: "2030-01-01" },
  ])
    expect(emailPayloadSchema.safeParse({ ...payload, ...patch }).success).toBe(
      false,
    );
});
it("RP03 status projections are bounded and reject private fields at every level", () => {
  const row = {
    id,
    title: "Record",
    cycleId: other,
    dueDate: "2030-03-02",
    datePurpose: "end-date",
    timezone: "UTC",
    target: "2030-01-01T09:00:00Z",
    nextSendAt: null,
    state: "queued",
    delivery: null,
    reason: null,
  };
  const schedule = {
    rows: [row],
    nextCursor: null,
    emailReadiness: "ready",
    smsOptional: true,
    lastSuccessAt: null,
    oldestDueAt: null,
    preference: { enabled: true, version: 1, canEnable: true },
  };
  expect(scheduleSchema.parse(schedule)).toEqual(schedule);
  expect(
    scheduleSchema.safeParse({
      ...schedule,
      rows: Array.from({ length: 101 }, () => row),
    }).success,
  ).toBe(false);
  for (const key of ["payload", "email", "token", "providerId"]) {
    expect(
      scheduleSchema.safeParse({ ...schedule, [key]: "private" }).success,
    ).toBe(false);
    expect(
      scheduleSchema.safeParse({
        ...schedule,
        rows: [{ ...row, [key]: "private" }],
      }).success,
    ).toBe(false);
    expect(
      scheduleSchema.safeParse({
        ...schedule,
        preference: { ...schedule.preference, [key]: "private" },
      }).success,
    ).toBe(false);
  }
  for (const field of ["id", "cycleId", "datePurpose", "state"])
    expect(
      scheduleSchema.safeParse({
        ...schedule,
        rows: [{ ...row, [field]: "invalid" }],
      }).success,
    ).toBe(false);
});

it("RP04 status enumerations preserve every valid value and reject empty replacements", () => {
  const row = {
    id,
    title: "Record",
    cycleId: other,
    dueDate: null,
    datePurpose: "end-date",
    timezone: "UTC",
    target: null,
    nextSendAt: null,
    state: "queued",
    delivery: null,
    reason: null,
  };
  const schedule = {
    rows: [row],
    nextCursor: null,
    emailReadiness: "ready",
    smsOptional: true,
    lastSuccessAt: null,
    oldestDueAt: null,
    preference: { enabled: true, version: 1, canEnable: false },
  };
  for (const state of [
    "pending",
    "blocked",
    "queued",
    "claimed",
    "submitting",
    "accepted",
    "failed",
    "suppressed",
    "canceled",
    "uncertain",
  ])
    expect(
      scheduleSchema.safeParse({ ...schedule, rows: [{ ...row, state }] })
        .success,
    ).toBe(true);
  for (const emailReadiness of [
    "no-recipient",
    "member-unavailable",
    "email-unconfirmed",
    "email-disabled",
    "email-suppressed",
    "ready",
  ])
    expect(
      scheduleSchema.safeParse({ ...schedule, emailReadiness }).success,
    ).toBe(true);
  expect(
    scheduleSchema.safeParse({ ...schedule, emailReadiness: "" }).success,
  ).toBe(false);
  expect(
    scheduleSchema.safeParse({ ...schedule, rows: [{ ...row, state: "" }] })
      .success,
  ).toBe(false);
  for (const datePurpose of ["end-date", "action-deadline"])
    expect(
      scheduleSchema.safeParse({ ...schedule, rows: [{ ...row, datePurpose }] })
        .success,
    ).toBe(true);
  expect(
    scheduleSchema.safeParse({
      ...schedule,
      rows: [{ ...row, datePurpose: "" }],
    }).success,
  ).toBe(false);
});
it("RP05 form versions accept canonical multi-digit integers only", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 2147483647 }),
      fc.boolean(),
      (version, enabled) => {
        const form = new FormData();
        form.set("requestId", id);
        form.set("enabled", String(enabled));
        form.set("expectedVersion", String(version));
        expect(preferenceFormInput(form)).toEqual({
          requestId: id,
          enabled,
          expectedVersion: version,
        });
        for (const bad of [
          `${version}x`,
          `0${version}`,
          `+${version}`,
          `${version}\n`,
        ]) {
          form.set("expectedVersion", bad);
          expect(preferenceFormInput(form)).toBeNull();
        }
      },
    ),
    options,
  );
});
it("RP06 generated missing or duplicate preference fields never select one posted value", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("requestId", "enabled", "expectedVersion"),
      fc.boolean(),
      fc.integer({ min: 1, max: 2147483647 }),
      (field, enabled, version) => {
        const values = {
          requestId: id,
          enabled: String(enabled),
          expectedVersion: String(version),
        };
        const form = new FormData();
        for (const [key, value] of Object.entries(values)) form.set(key, value);
        expect(preferenceFormInput(form)).toEqual({
          requestId: id,
          enabled,
          expectedVersion: version,
        });
        form.append(field, values[field]);
        expect(preferenceFormInput(form)).toBeNull();
        form.delete(field);
        expect(preferenceFormInput(form)).toBeNull();
        form.set(field, new File(["fixture"], "field.txt"));
        expect(preferenceFormInput(form)).toBeNull();
      },
    ),
    options,
  );
});
