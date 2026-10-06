import { expect, it } from "vitest";
import fc from "fast-check";
import { recipientInputSchema, recipientSchema } from "./schema";
const id = "10000000-0000-4000-8000-000000000001";
it("R13 strict recipient intent version and identity properties", () => {
  for (const raw of [{}, null, undefined, [], "clear"])
    expect(recipientInputSchema.safeParse(raw).success).toBe(false);
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2147483647 }), (expectedVersion) => {
      for (const raw of [
        { intent: "clear", expectedVersion },
        { intent: "assign", expectedVersion, membershipId: id },
      ]) {
        expect(recipientInputSchema.parse(raw)).toEqual(raw);
        for (const key of ["actor", "practiceId", "role", "ready"])
          expect(
            recipientInputSchema.safeParse({ ...raw, [key]: id }).success,
          ).toBe(false);
      }
    }),
  );
  for (const expectedVersion of [
    0,
    -1,
    2147483648,
    NaN,
    Infinity,
    1.5,
    "1",
    null,
    undefined,
  ])
    expect(
      recipientInputSchema.safeParse({ intent: "clear", expectedVersion })
        .success,
    ).toBe(false);
  for (const membershipId of [undefined, null, "", "not-uuid", 1])
    expect(
      recipientInputSchema.safeParse({
        intent: "assign",
        expectedVersion: 1,
        membershipId,
      }).success,
    ).toBe(false);
  for (const intent of ["", undefined, "replace", true])
    expect(
      recipientInputSchema.safeParse({ intent, expectedVersion: 1 }).success,
    ).toBe(false);
  expect(
    recipientInputSchema.safeParse({
      intent: "clear",
      expectedVersion: 1,
      membershipId: id,
    }).success,
  ).toBe(false);
});
it("R14 coherent minimal recipient projection properties", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 2147483647 }),
      fc.boolean(),
      (version, canEdit) => {
        const base = {
          version,
          canEdit,
          ready: false,
          ...(canEdit ? { candidates: [] } : {}),
        };
        for (const role of ["administrator", "manager", "viewer"])
          for (const state of ["active", "revoked"]) {
            const selected = { id, email: "fixture@example.test", role, state };
            const eligible = state === "active" && role !== "viewer";
            for (const readiness of [
              "no-recipient",
              "sms-setup-pending",
              "member-unavailable",
            ])
              expect(
                recipientSchema.safeParse({ ...base, selected, readiness })
                  .success,
              ).toBe(
                readiness ===
                  (eligible ? "sms-setup-pending" : "member-unavailable"),
              );
          }
        const empty = { ...base, selected: null, readiness: "no-recipient" };
        expect(recipientSchema.parse({ ...empty, secret: "removed" })).toEqual(
          empty,
        );
        for (const readiness of [
          "sms-setup-pending",
          "member-unavailable",
          "unknown",
        ])
          expect(
            recipientSchema.safeParse({ ...empty, readiness }).success,
          ).toBe(false);
        for (const ready of [true, undefined, "false"])
          expect(recipientSchema.safeParse({ ...empty, ready }).success).toBe(
            false,
          );
        if (!canEdit)
          expect(
            recipientSchema.safeParse({ ...empty, candidates: [] }).success,
          ).toBe(false);
        else {
          expect(
            recipientSchema.safeParse({ ...empty, candidates: undefined })
              .success,
          ).toBe(false);
          for (const role of ["administrator", "manager", "viewer", "owner"])
            for (const state of ["active", "revoked"])
              expect(
                recipientSchema.safeParse({
                  ...empty,
                  candidates: [
                    { id, email: "fixture@example.test", role, state },
                  ],
                }).success,
              ).toBe(
                state === "active" &&
                  (role === "administrator" || role === "manager"),
              );
        }
        for (const field of [
          { version: 0 },
          { version: 2147483648 },
          { version: 1.5 },
          { canEdit: undefined },
          { selected: {} },
          {
            selected: {
              id: "bad",
              email: "bad",
              role: "manager",
              state: "active",
            },
          },
        ])
          expect(
            recipientSchema.safeParse({ ...empty, ...field }).success,
          ).toBe(false);
      },
    ),
  );
});
