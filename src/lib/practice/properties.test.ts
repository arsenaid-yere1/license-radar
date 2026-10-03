import { it, expect } from "vitest";
import fc from "fast-check";
import { validatePractice } from "./schema";
const name = fc
  .array(fc.constantFrom("a", "Z", " ", "😀", "é", "\t", "中"), {
    maxLength: 140,
  })
  .map((a) => a.join(""));
it("P01 1000 Unicode names agree with trimmed code-point boundaries", () =>
  fc.assert(
    fc.property(name, (value) => {
      const result = validatePractice({ name: value, timezone: "UTC" });
      const count = Array.from(value.trim()).length;
      expect(result.success).toBe(count > 0 && count <= 120);
      if (result.success) expect(result.data?.name).toBe(value.trim());
    }),
    { seed: 20261003, numRuns: 1000 },
  ));
it("P02 1000 identity extras/unknown zones are rejected around valid inputs", () =>
  fc.assert(
    fc.property(
      fc.constantFrom("owner_user_id", "role", "id", "timezone"),
      fc.string(),
      (key, value) => {
        const valid = { name: "Cedar", timezone: "UTC" };
        expect(validatePractice(valid).success).toBe(true);
        expect(
          validatePractice({
            ...valid,
            [key]: key === "timezone" ? "Mars/" + value : value,
          }).success,
        ).toBe(false);
      },
    ),
    { seed: 20261004, numRuns: 1000 },
  ));

it("P01 generated explicit lower/upper boundaries accept and reject bidirectionally", () =>
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 140 }),
      fc.constantFrom("a", "😀", "中"),
      (count, character) => {
        const result = validatePractice({
          name: character.repeat(count),
          timezone: "UTC",
        });
        expect(result.success).toBe(count >= 1 && count <= 120);
        if (!result.success)
          expect(result.errors.name).toBe(
            count === 0
              ? "Enter a practice name."
              : "Use 120 characters or fewer.",
          );
      },
    ),
    { seed: 20261006, numRuns: 1000 },
  ));
it("P02 invalid types and versions retain actionable errors", () =>
  fc.assert(
    fc.property(
      fc.constantFrom("name", "timezone", "expectedVersion"),
      fc.constantFrom(null, undefined, true, {}, [], "malformed"),
      (field, value) => {
        const input = {
          name: "Cedar",
          timezone: "UTC",
          expectedVersion: 1,
          ...{
            [field]:
              field === "name" && typeof value === "string" ? null : value,
          },
        };
        const result = validatePractice(input, true);
        expect(result.success).toBe(false);
        if (!result.success)
          expect(result.errors[field]).toBe(
            field === "name"
              ? "Enter a practice name."
              : field === "timezone"
                ? "Choose a valid timezone."
                : "Reload the settings and try again.",
          );
      },
    ),
    { seed: 20261007, numRuns: 1000 },
  ));

it("P02 1000 safe integer versions accept valid edits and reject invalid bounds", () =>
  fc.assert(
    fc.property(
      fc.oneof(
        fc.integer({ min: -200, max: 200 }),
        fc.constantFrom(
          0.5,
          1.5,
          Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER + 1,
        ),
      ),
      (version) => {
        const result = validatePractice(
          { name: "Cedar", timezone: "UTC", expectedVersion: version },
          true,
        );
        expect(result.success).toBe(
          Number.isSafeInteger(version) && version > 0,
        );
        if (result.success) expect(result.data.expectedVersion).toBe(version);
        else
          expect(result.errors.expectedVersion).toBe(
            "Reload the settings and try again.",
          );
      },
    ),
    { seed: 20261008, numRuns: 1000 },
  ));
it("P02 rejection reports the form contract field as well as denying writes", () =>
  fc.assert(
    fc.property(
      fc.constantFrom("owner_user_id", "role", "id"),
      fc.string(),
      (key, value) => {
        const result = validatePractice({
          name: "Cedar",
          timezone: "UTC",
          [key]: value,
        });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.errors.form).toBeTruthy();
      },
    ),
    { seed: 20261009, numRuns: 1000 },
  ));
