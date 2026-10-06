import { expect, it } from "vitest";
import fc from "fast-check";
import {
  detailLabels,
  isCredentialDate,
  formatCredentialDate,
  trackingDate,
} from "./dates";
import { registerInputSchema, credentialSchema } from "./schema";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
const input = {
  intent: "credential",
  requestId: id,
  title: "License",
  type: "state_license",
  ownerKind: "practice",
};
it("D03 exact Gregorian lexical and calendar boundaries", () => {
  for (const value of [
    "0001-01-01",
    "9999-12-31",
    "2000-02-29",
    "2028-02-29",
    "2026-04-30",
    "2026-02-28",
  ])
    expect(isCredentialDate(value), value).toBe(true);
  for (const value of [
    "",
    " ",
    "0000-01-01",
    "10000-01-01",
    "1900-02-29",
    "2100-02-29",
    "2026-02-29",
    "2026-04-31",
    "2026-00-01",
    "2026-13-01",
    "2026-01-00",
    "2026-01-32",
    "2026-1-01",
    "2026-01-1",
    "2026/01/01",
    "2026-01-01T00:00:00Z",
    "2026-01-01\n",
    "2026-01-01\r",
    "2026-01-01\u2028",
    "2026-01-01\u2029",
    "02026-01-01",
    "2026-01-010",
    " 2026-01-01",
    "infinity",
    "-0001-01-01",
    "2026-AA-01",
  ])
    expect(isCredentialDate(value), value).toBe(false);
});
it("D02 D04 metadata and dates normalize unknowns and enforce strict ordering", () => {
  expect(registerInputSchema.parse(input)).toMatchObject({
    issuer: null,
    jurisdiction: null,
    endDate: null,
    actionDeadline: null,
  });
  for (const value of [undefined, null, ""])
    expect(
      registerInputSchema.parse({
        ...input,
        endDate: value,
        actionDeadline: value,
        issuer: value,
        jurisdiction: value,
      }),
    ).toMatchObject({
      issuer: null,
      jurisdiction: null,
      endDate: null,
      actionDeadline: null,
    });
  expect(
    registerInputSchema.parse({
      ...input,
      issuer: " \ufeff🩺 ",
      jurisdiction: " CA ",
      endDate: "0001-01-01",
    }),
  ).toMatchObject({ issuer: "🩺", jurisdiction: "CA", endDate: "0001-01-01" });
  expect(
    registerInputSchema.parse({
      ...input,
      actionDeadline: "9999-12-31",
      issuer: "🩺".repeat(120),
    }),
  ).toMatchObject({ actionDeadline: "9999-12-31" });
  for (const field of ["issuer", "jurisdiction"])
    for (const value of ["x".repeat(121), "🩺".repeat(121), "\0", "\ud800", 3])
      expect(
        registerInputSchema.safeParse({ ...input, [field]: value }).success,
      ).toBe(false);
  for (const field of ["endDate", "actionDeadline"])
    for (const value of [" ", "1900-02-29", 3, "2026-01-01\n"])
      expect(
        registerInputSchema.safeParse({ ...input, [field]: value }).success,
      ).toBe(false);
  for (const deadline of ["2026-12-31", "2027-01-01"]) {
    const result = registerInputSchema.safeParse({
      ...input,
      endDate: "2026-12-31",
      actionDeadline: deadline,
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["actionDeadline"],
          message: "The action deadline must be earlier than the end date.",
        }),
      );
  }
  expect(
    registerInputSchema.safeParse({
      ...input,
      endDate: "2026-12-31",
      actionDeadline: "2026-12-30",
    }).success,
  ).toBe(true);
  for (const field of [
    "practiceId",
    "actor",
    "cycleId",
    "dateRevision",
    "effectiveDate",
  ])
    expect(
      registerInputSchema.safeParse({ ...input, [field]: id }).success,
    ).toBe(false);
});
it("D06 projections require coherent cycle data and preserve date purposes", () => {
  const record = {
    id,
    title: "License",
    type: "state_license",
    owner_kind: "practice",
    owner_clinician_id: null,
    owner_name: "Practice",
    version: 1,
    covered_clinicians: [],
    issuer: null,
    jurisdiction: null,
    current_cycle: {
      id,
      cycle_number: 1,
      date_revision: 1,
      end_date: null,
      action_deadline: null,
    },
  };
  expect(
    credentialSchema.parse({
      ...record,
      secret: "private",
      current_cycle: { ...record.current_cycle, private: "secret" },
    }),
  ).toEqual(record);
  for (const patch of [
    { current_cycle: undefined },
    { issuer: undefined },
    { jurisdiction: undefined },
    { current_cycle: { ...record.current_cycle, id: "bad" } },
    { current_cycle: { ...record.current_cycle, cycle_number: 2 } },
    { current_cycle: { ...record.current_cycle, date_revision: 0 } },
    { current_cycle: { ...record.current_cycle, end_date: "2026-02-29" } },
    {
      current_cycle: {
        ...record.current_cycle,
        end_date: "2026-12-01",
        action_deadline: "2026-12-01",
      },
    },
  ])
    expect(credentialSchema.safeParse({ ...record, ...patch }).success).toBe(
      false,
    );
  expect(trackingDate(null, null, "state_license")).toBeNull();
  for (const type of [
    "state_license",
    "dea_registration",
    "malpractice_policy",
  ]) {
    expect(trackingDate("2026-12-02", null, type)).toEqual({
      date: "2026-12-02",
      purpose: type === "malpractice_policy" ? "coverage end" : "expiration",
    });
    expect(trackingDate("2026-12-02", "2026-11-01", type)).toEqual({
      date: "2026-11-01",
      purpose: "earlier action deadline",
    });
    expect(trackingDate(null, "2026-11-01", type)).toEqual({
      date: "2026-11-01",
      purpose: "earlier action deadline",
    });
  }
  for (const timezone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    const previous = process.env.TZ;
    try {
      process.env.TZ = timezone;
      expect(formatCredentialDate("2028-02-29")).toBe("Feb 29, 2028");
      expect(formatCredentialDate("0001-01-01")).toBe("Jan 1, 1");
      expect(formatCredentialDate("9999-12-31")).toBe("Dec 31, 9999");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  }
});
it("P03 independent UTC calendar oracle preserves dates and adjacent invalid boundaries", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 9999 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 31 }),
      (year, month, day) => {
        const date = [
          String(year).padStart(4, "0"),
          String(month).padStart(2, "0"),
          String(day).padStart(2, "0"),
        ].join("-");
        const oracle = new Date(0);
        oracle.setUTCFullYear(year, month - 1, day);
        oracle.setUTCHours(0, 0, 0, 0);
        const valid =
          oracle.getUTCFullYear() === year &&
          oracle.getUTCMonth() === month - 1 &&
          oracle.getUTCDate() === day;
        expect(isCredentialDate(date)).toBe(valid);
        if (valid) {
          expect(
            registerInputSchema.parse({ ...input, endDate: date }),
          ).toMatchObject({ endDate: date });
          expect(trackingDate(date, null, "state_license")).toEqual({
            date,
            purpose: "expiration",
          });
        }
      },
    ),
    { seed: 20261006, numRuns: 3000 },
  );
});

it("D11 type-specific field purposes are exact", () => {
  expect(detailLabels).toEqual({
    state_license: {
      issuer: "Licensing board",
      jurisdiction: "State or territory",
      end: "Expiration date",
    },
    dea_registration: {
      issuer: "Issuing authority",
      jurisdiction: "Registration jurisdiction",
      end: "Expiration date",
    },
    malpractice_policy: {
      issuer: "Insurer",
      jurisdiction: "Coverage jurisdiction",
      end: "Coverage end date",
    },
  });
});

it("P04 ordered pairs, explicit unknowns, metadata boundaries and tracking purposes are independent properties", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 9999 }),
      fc.boolean(),
      fc.boolean(),
      fc.integer({ min: 0, max: 120 }),
      fc.constantFrom("x", "🩺", "é"),
      fc.constantFrom(
        "state_license",
        "dea_registration",
        "malpractice_policy",
      ),
      (year, hasEnd, hasAction, length, char, type) => {
        const yearText = String(year).padStart(4, "0"),
          end = `${yearText}-12-31`,
          action = `${yearText}-01-01`,
          text = char.repeat(length);
        const raw = {
          ...input,
          type,
          issuer: ` \ufeff${text}\u2000 `,
          jurisdiction: ` ${text} `,
          endDate: hasEnd ? end : null,
          actionDeadline: hasAction ? action : null,
        };
        const parsed = registerInputSchema.parse(raw);
        expect(parsed).toMatchObject({
          issuer: text || null,
          jurisdiction: text || null,
          endDate: hasEnd ? end : null,
          actionDeadline: hasAction ? action : null,
        });
        expect(registerInputSchema.parse(parsed)).toEqual(parsed);
        expect(
          trackingDate(hasEnd ? end : null, hasAction ? action : null, type),
        ).toEqual(
          hasAction
            ? { date: action, purpose: "earlier action deadline" }
            : hasEnd
              ? {
                  date: end,
                  purpose:
                    type === "malpractice_policy"
                      ? "coverage end"
                      : "expiration",
                }
              : null,
        );
        expect(
          registerInputSchema.safeParse({
            ...raw,
            endDate: action,
            actionDeadline: end,
          }).success,
        ).toBe(false);
        expect(
          registerInputSchema.safeParse({
            ...raw,
            endDate: end,
            actionDeadline: end,
          }).success,
        ).toBe(false);
      },
    ),
    { seed: 20261006, numRuns: 1000 },
  );
});

it("D03 deterministic display names every month and keeps all components", () => {
  for (const [month, label] of [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ].entries())
    expect(
      formatCredentialDate(`2026-${String(month + 1).padStart(2, "0")}-15`),
    ).toBe(`${label} 15, 2026`);
});
it("D11 metadata and date failures identify their exact public field messages", () => {
  for (const field of ["issuer", "jurisdiction"]) {
    for (const [value, message] of [
      ["\0", "Use valid text."],
      ["x".repeat(121), "Use 1 to 120 characters."],
    ]) {
      const parsed = registerInputSchema.safeParse({
        ...input,
        [field]: value,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(parsed.error.issues).toContainEqual(
          expect.objectContaining({ path: [field], message }),
        );
    }
  }
  for (const field of ["endDate", "actionDeadline"]) {
    const parsed = registerInputSchema.safeParse({
      ...input,
      [field]: "1900-02-29",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: [field],
          message: "Enter a valid date (YYYY-MM-DD).",
        }),
      );
  }
});
