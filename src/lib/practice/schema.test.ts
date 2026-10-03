import { describe, it, expect } from "vitest";
import { validatePractice } from "./schema";
const input = { name: "  Cedar Clinic  ", timezone: "America/Los_Angeles" };
describe("practice contract", () => {
  it("S08 trims name and preserves timezone", () =>
    expect(validatePractice(input)).toEqual({
      success: true,
      data: { name: "Cedar Clinic", timezone: input.timezone },
    }));
  it.each(["", "   ", "\t\n"])("S09 rejects blank %j", (name) =>
    expect(validatePractice({ ...input, name })).toMatchObject({
      success: false,
      errors: { name: "Enter a practice name." },
    }),
  );
  it("S10 counts Unicode code points", () => {
    expect(validatePractice({ ...input, name: "😀".repeat(120) }).success).toBe(
      true,
    );
    expect(
      validatePractice({ ...input, name: "😀".repeat(121) }),
    ).toMatchObject({
      success: false,
      errors: { name: "Use 120 characters or fewer." },
    });
  });
  it.each(["UTC", "America/New_York", "America/Los_Angeles"])(
    "S11 accepts %s",
    (timezone) =>
      expect(validatePractice({ ...input, timezone }).success).toBe(true),
  );
  it("S11 rejects unknown timezone", () =>
    expect(
      validatePractice({ ...input, timezone: "Mars/Olympus" }),
    ).toMatchObject({
      success: false,
      errors: { timezone: "Choose a valid timezone." },
    }));
  it.each(["owner_user_id", "role", "id"])(
    "S12 rejects identity field %s",
    (key) =>
      expect(validatePractice({ ...input, [key]: "forged" }).success).toBe(
        false,
      ),
  );
  it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1, undefined])(
    "S12 invalid edit version %j",
    (expectedVersion) =>
      expect(
        validatePractice({ ...input, expectedVersion }, true),
      ).toMatchObject({
        success: false,
        errors: { expectedVersion: "Reload the settings and try again." },
      }),
  );
  it("S12 accepts a positive safe edit version", () =>
    expect(
      validatePractice({ ...input, expectedVersion: 1 }, true),
    ).toMatchObject({ success: true, data: { expectedVersion: 1 } }));
  it("S12 rejects malformed objects", () => {
    for (const value of [null, [], true, { name: 5, timezone: 6 }])
      expect(validatePractice(value).success).toBe(false);
  });
});

it("S12 malformed field types have actionable field errors", () => {
  expect(validatePractice({ name: 5, timezone: "UTC" })).toMatchObject({
    success: false,
    errors: { name: "Enter a practice name." },
  });
  expect(validatePractice({ name: "Cedar", timezone: 5 })).toMatchObject({
    success: false,
    errors: { timezone: "Choose a valid timezone." },
  });
  const extra = validatePractice({ ...input, role: "admin" });
  expect(extra.success).toBe(false);
  if (!extra.success) expect(extra.errors.form).toBeTruthy();
});
