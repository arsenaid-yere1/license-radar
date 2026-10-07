import { expect, it } from "vitest";
import fc from "fast-check";
import {
  maintenanceInputSchema,
  maintenanceCredentialSchema,
  maintenanceRegisterSchema,
  registerInputSchema,
  registerSchema,
  clinicianSchema,
  credentialSchema,
  typeLabels,
} from "./schema";
const id = "AAAAAAAA-0000-4000-8000-000000000001";
const other = "bbbbbbbb-0000-4000-8000-000000000002";
const clinician = { id: id.toLowerCase(), name: "Rivera", version: 1 };
const base = {
  intent: "credential",
  requestId: id,
  title: "Policy",
  type: "malpractice_policy",
  ownerKind: "practice",
  coveredClinicianIds: [],
};
it("P01 names accept every legal length, normalize whitespace and reject malformed text", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 120 }),
      fc.constantFrom("x", "🩺", "é"),
      (length, char) => {
        const name = char.repeat(length);
        const raw = {
          intent: "clinician",
          requestId: id,
          name: `\ufeff\u2000\r ${name}\u202f\n`,
        };
        expect(registerInputSchema.parse(raw)).toEqual({
          intent: "clinician",
          requestId: id.toLowerCase(),
          name,
        });
        for (const key of ["practiceId", "actor", "role", "version", "audit"])
          expect(
            registerInputSchema.safeParse({ ...raw, [key]: id }).success,
          ).toBe(false);
      },
    ),
    { seed: 20261006, numRuns: 1000 },
  );
  for (const name of [
    "",
    " \t\u00a0\u3000",
    "x".repeat(121),
    "🩺".repeat(121),
    "\0",
    "\ud800",
    "\udc00",
  ])
    expect(
      registerInputSchema.safeParse({
        intent: "clinician",
        requestId: id,
        name,
      }).success,
    ).toBe(false);
  expect(
    registerInputSchema.safeParse({
      intent: "clinician",
      requestId: id,
      name: "\u200b",
    }).success,
  ).toBe(true);
  for (const requestId of [null, undefined, "", "bad", 4])
    expect(
      registerInputSchema.safeParse({
        intent: "clinician",
        requestId,
        name: "Rivera",
      }).success,
    ).toBe(false);
  for (const raw of [
    null,
    {},
    [],
    "clinician",
    { intent: "unknown", requestId: id, name: "Rivera" },
  ])
    expect(registerInputSchema.safeParse(raw).success).toBe(false);
});
it("P02 ownership and canonical coverage accept precisely eligible combinations", () => {
  fc.assert(
    fc.property(
      fc.shuffledSubarray([id, other], { minLength: 0, maxLength: 2 }),
      (coverage) => {
        for (const type of [
          "state_license",
          "dea_registration",
          "malpractice_policy",
        ])
          for (const ownerKind of ["practice", "clinician"])
            for (const ownerClinicianId of [undefined, id]) {
              const raw = {
                ...base,
                type,
                ownerKind,
                ...(ownerClinicianId ? { ownerClinicianId } : {}),
                coveredClinicianIds: coverage,
              };
              const allowed =
                (ownerKind === "clinician"
                  ? ownerClinicianId === id
                  : ownerClinicianId === undefined) &&
                (!coverage.length ||
                  (type === "malpractice_policy" && ownerKind === "practice"));
              const result = registerInputSchema.safeParse(raw);
              expect(result.success).toBe(allowed);
              if (result.success)
                expect(result.data).toEqual({
                  ...raw,
                  issuer: null,
                  jurisdiction: null,
                  endDate: null,
                  actionDeadline: null,
                  requestId: id.toLowerCase(),
                  ...(ownerClinicianId
                    ? { ownerClinicianId: id.toLowerCase() }
                    : {}),
                  coveredClinicianIds: coverage
                    .map((x) => x.toLowerCase())
                    .sort(),
                });
            }
      },
    ),
    { seed: 20261006, numRuns: 1000 },
  );
  expect(
    registerInputSchema.parse({ ...base, coveredClinicianIds: undefined }),
  ).toEqual({
    ...base,
    requestId: id.toLowerCase(),
    issuer: null,
    jurisdiction: null,
    endDate: null,
    actionDeadline: null,
  });
  for (const patch of [
    { type: "other" },
    { ownerKind: "other" },
    { title: " " },
    { title: "🩺".repeat(121) },
    { ownerClinicianId: null },
    { coveredClinicianIds: [id, id.toLowerCase()] },
    { coveredClinicianIds: [null] },
    { coveredClinicianIds: ["bad"] },
    { coveredClinicianIds: null },
  ])
    expect(registerInputSchema.safeParse({ ...base, ...patch }).success).toBe(
      false,
    );
});
it("P02 safe projections require coherent ownership and strip private metadata", () => {
  const record = {
    id: other,
    title: "Policy",
    type: "malpractice_policy",
    owner_kind: "practice",
    owner_clinician_id: null,
    owner_name: "Practice",
    version: 1,
    covered_clinicians: [{ id: clinician.id, name: clinician.name }],
    issuer: null,
    jurisdiction: null,
    current_cycle: {
      id: other,
      cycle_number: 1,
      date_revision: 1,
      end_date: null,
      action_deadline: null,
    },
  };
  expect(
    registerSchema.parse({
      clinicians: [{ ...clinician, secret: "private" }],
      credentials: [{ ...record, actor: "private" }],
      receipt: "private",
    }),
  ).toEqual({ clinicians: [clinician], credentials: [record] });
  for (const version of [0, -1, 1.5, 2147483648, undefined])
    expect(clinicianSchema.safeParse({ ...clinician, version }).success).toBe(
      false,
    );
  for (const patch of [
    { owner_kind: "clinician" },
    { owner_kind: "clinician", owner_clinician_id: clinician.id },
    { owner_kind: "unknown" },
    { owner_clinician_id: clinician.id },
    { type: "state_license" },
    { type: "dea_registration" },
    { type: "other" },
    { covered_clinicians: undefined },
    { owner_name: "" },
    { title: "" },
    { id: "bad" },
    { covered_clinicians: [{ id: "bad", name: "Rivera" }] },
  ])
    expect(credentialSchema.safeParse({ ...record, ...patch }).success).toBe(
      false,
    );
  expect(
    credentialSchema.parse({
      ...record,
      owner_kind: "clinician",
      owner_clinician_id: clinician.id,
      covered_clinicians: [],
    }),
  ).toMatchObject({ owner_kind: "clinician" });
  expect(
    credentialSchema.parse({
      ...record,
      type: "state_license",
      covered_clinicians: [],
    }),
  ).toMatchObject({ type: "state_license" });
});

it("P01 field errors identify invalid input with precise useful messages", () => {
  const cases: [unknown, string, string][] = [
    [
      { intent: "clinician", requestId: id, name: "" },
      "name",
      "Use 1 to 120 characters.",
    ],
    [
      { intent: "clinician", requestId: id, name: "\0" },
      "name",
      "Use valid text.",
    ],
    [
      { ...base, ownerKind: "clinician" },
      "ownerClinicianId",
      "Choose a clinician for clinician ownership only.",
    ],
    [
      { ...base, type: "state_license", coveredClinicianIds: [id] },
      "coveredClinicianIds",
      "Coverage is available only for a practice-owned malpractice policy.",
    ],
    [
      { ...base, coveredClinicianIds: [id, id] },
      "coveredClinicianIds",
      "Choose each covered clinician once.",
    ],
  ];
  for (const [input, field, message] of cases) {
    const parsed = registerInputSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: [field], message }),
      );
  }
});

it("P01 adversarial Unicode and P02 public type labels remain truthful", () => {
  expect(typeLabels).toEqual({
    state_license: "State license",
    dea_registration: "DEA registration",
    malpractice_policy: "Malpractice policy",
  });
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 0x10ffff }), {
        minLength: 0,
        maxLength: 125,
      }),
      (codepoints) => {
        const content = codepoints
          .map((value) => String.fromCodePoint(value))
          .join("");
        const normalized = content.trim();
        const points = Array.from(normalized).map((char) =>
          char.codePointAt(0)!,
        );
        const allowed =
          points.length > 0 &&
          points.length <= 120 &&
          points.every(
            (value) => value !== 0 && (value < 0xd800 || value > 0xdfff),
          );
        const parsed = registerInputSchema.safeParse({
          intent: "clinician",
          requestId: id,
          name: content,
        });
        expect(parsed.success).toBe(allowed);
        if (parsed.success)
          expect(parsed.data).toEqual({
            intent: "clinician",
            requestId: id.toLowerCase(),
            name: normalized,
          });
      },
    ),
    { seed: 20261006, numRuns: 1000 },
  );
});

it("P01 exact boundary and discriminant error locate a malformed intent", () => {
  for (const char of ["x", "🩺"])
    expect(
      registerInputSchema.parse({
        intent: "clinician",
        requestId: id,
        name: char.repeat(120),
      }),
    ).toMatchObject({ name: char.repeat(120) });
  const parsed = registerInputSchema.safeParse({
    intent: "forged",
    requestId: id,
    name: "Rivera",
  });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(["intent"]);
});

it("P05 maintenance tokens and full authored combinations have canonical round trips", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 2147483647 }),
      fc.boolean(),
      fc.shuffledSubarray([id, other]),
      (version, stringTokens, coverage) => {
        const tokens = {
          requestId: id,
          id: other,
          expectedCycleId: id,
          expectedVersion: stringTokens ? String(version) : version,
          expectedDateRevision: stringTokens ? String(version) : version,
        };
        const archive = { ...tokens, intent: "archive" };
        expect(maintenanceInputSchema.parse(archive)).toEqual({
          ...archive,
          requestId: id.toLowerCase(),
          expectedCycleId: id.toLowerCase(),
          expectedVersion: version,
          expectedDateRevision: version,
        });
        for (const type of [
          "state_license",
          "dea_registration",
          "malpractice_policy",
        ])
          for (const ownerKind of ["practice", "clinician"]) {
            const raw = {
              ...base,
              ...tokens,
              intent: "update",
              type,
              ownerKind,
              coveredClinicianIds: coverage,
              ...(ownerKind === "clinician" ? { ownerClinicianId: id } : {}),
            };
            const parsed = maintenanceInputSchema.safeParse(raw);
            expect(parsed.success).toBe(
              !coverage.length ||
                (type === "malpractice_policy" && ownerKind === "practice"),
            );
            if (parsed.success) {
              expect(parsed.data).toEqual({
                ...raw,
                requestId: id.toLowerCase(),
                expectedCycleId: id.toLowerCase(),
                expectedVersion: version,
                expectedDateRevision: version,
                ...(ownerKind === "clinician"
                  ? { ownerClinicianId: id.toLowerCase() }
                  : {}),
                issuer: null,
                jurisdiction: null,
                endDate: null,
                actionDeadline: null,
                coveredClinicianIds: coverage
                  .map((x) => x.toLowerCase())
                  .sort(),
              });
              expect(maintenanceInputSchema.parse(parsed.data)).toEqual(
                parsed.data,
              );
            }
          }
      },
    ),
    { seed: 20261007, numRuns: 1000 },
  );
  const raw = {
    ...base,
    intent: "update",
    id: other,
    expectedVersion: 1,
    expectedCycleId: id,
    expectedDateRevision: 1,
  };
  for (const field of ["expectedVersion", "expectedDateRevision"])
    for (const value of [
      "",
      "01",
      " 1",
      "1 ",
      "+1",
      "1.0",
      "1e2",
      "0",
      "-1",
      "2147483648",
      null,
      undefined,
      0,
      -1,
      1.1,
      2147483648,
    ])
      expect(
        maintenanceInputSchema.safeParse({ ...raw, [field]: value }).success,
      ).toBe(false);
  for (const field of [
    "practiceId",
    "actor",
    "archived_at",
    "version",
    "dateRevision",
    "effectiveDate",
  ])
    expect(
      maintenanceInputSchema.safeParse({ ...raw, [field]: id }).success,
    ).toBe(false);
  expect(
    maintenanceInputSchema.parse({ ...raw, coveredClinicianIds: undefined }),
  ).toEqual({
    ...raw,
    requestId: id.toLowerCase(),
    expectedCycleId: id.toLowerCase(),
    coveredClinicianIds: [],
    issuer: null,
    jurisdiction: null,
    endDate: null,
    actionDeadline: null,
  });
  for (const [field, message, value] of [
    [
      "ownerClinicianId",
      "Choose a clinician for clinician ownership only.",
      { ownerKind: "clinician" },
    ],
    [
      "coveredClinicianIds",
      "Choose each covered clinician once.",
      { coveredClinicianIds: [id, id] },
    ],
    [
      "coveredClinicianIds",
      "Coverage is available only for a practice-owned malpractice policy.",
      { type: "state_license", coveredClinicianIds: [id] },
    ],
    [
      "actionDeadline",
      "The action deadline must be earlier than the end date.",
      { endDate: "2028-02-29", actionDeadline: "2028-02-29" },
    ],
  ] as const) {
    const parsed = maintenanceInputSchema.safeParse({ ...raw, ...value });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ path: [field], message }),
      );
  }
});
it("P05 maintained projection requires valid archived timestamps and unique nonself active candidates", () => {
  const record = {
    id: other,
    title: "Policy",
    type: "state_license",
    owner_kind: "practice",
    owner_clinician_id: null,
    owner_name: "Practice",
    version: 1,
    covered_clinicians: [],
    issuer: null,
    jurisdiction: null,
    current_cycle: {
      id: other,
      cycle_number: 1,
      date_revision: 1,
      end_date: null,
      action_deadline: null,
    },
    archived_at: null,
  };
  expect(
    maintenanceCredentialSchema.parse({ ...record, secret: "private" }),
  ).toEqual(record);
  for (const archived_at of [undefined, "bad", 123, "2026-13-01T00:00:00Z"])
    expect(
      maintenanceCredentialSchema.safeParse({ ...record, archived_at }).success,
    ).toBe(false);
  for (const archived_at of [
    null,
    "2026-10-07T00:00:00Z",
    "2026-10-07T00:00:00+00:00",
  ])
    for (const suspected_duplicate_ids of [
      [],
      [id],
      [other],
      [id, id.toLowerCase()],
      ["bad"],
    ]) {
      const result = maintenanceRegisterSchema.safeParse({
        clinicians: [],
        credentials: [{ ...record, archived_at, suspected_duplicate_ids }],
      });
      const allowed =
        !suspected_duplicate_ids.includes(other) &&
        new Set(suspected_duplicate_ids.map((x) => x.toLowerCase())).size ===
          suspected_duplicate_ids.length &&
        !suspected_duplicate_ids.includes("bad") &&
        (!archived_at || !suspected_duplicate_ids.length);
      expect(result.success).toBe(allowed);
      if (result.success)
        expect(result.data).toEqual({
          clinicians: [],
          credentials: [
            {
              ...record,
              archived_at,
              suspected_duplicate_ids: suspected_duplicate_ids.map((x) =>
                x.toLowerCase(),
              ),
            },
          ],
        });
    }
});

it("P05 invalid maintenance intent identifies the discriminant for useful feedback", () => {
  const parsed = maintenanceInputSchema.safeParse({
    intent: "forged",
    requestId: id,
  });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(["intent"]);
});
