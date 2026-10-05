import { expect, it } from "vitest";
import fc from "fast-check";
import {
  invitationInputSchema,
  memberInputSchema,
  recordInputSchema,
  normalizeEmail,
  validateInvitation,
  roleLabels,
} from "./schema";
import { generateInvitation, hashInvitationToken } from "./invitations";
import { createHash } from "node:crypto";
it("P02 1000 strict generated role/version objects accept legitimate values and reject forged authority", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("administrator", "manager", "viewer"),
      fc.integer({ min: 1, max: 2147483647 }),
      fc.constantFrom("actor", "practiceId", "owner_user_id", "extra"),
      (role, expectedVersion, key) => {
        const member = {
          id: "10000000-0000-4000-8000-000000000001",
          role,
          expectedVersion,
        };
        expect(memberInputSchema.safeParse(member).success).toBe(true);
        expect(
          memberInputSchema.safeParse({ ...member, [key]: "forged" }).success,
        ).toBe(false);
        expect(
          recordInputSchema.safeParse({ id: member.id, expectedVersion })
            .success,
        ).toBe(true);
        for (const bad of [0, -1, 1.5, 2147483648, NaN, "1"])
          expect(
            memberInputSchema.safeParse({ ...member, expectedVersion: bad })
              .success,
          ).toBe(false);
        expect(
          invitationInputSchema.safeParse({ email: "valid@example.test", role })
            .success,
        ).toBe(true);
        expect(
          invitationInputSchema.safeParse({
            email: "valid@example.test",
            role: "owner",
          }).success,
        ).toBe(false);
      },
    ),
    { seed: 20261005, numRuns: 1000, includeErrorInReport: true },
  );
});
it("P01 P02 1000 generated canonical emails and opaque tokens retain exact identities", () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom("a", "b", "Z", "Q", "0", "9"), {
        minLength: 1,
        maxLength: 80,
      }),
      fc.integer({ min: 0, max: 5 }),
      fc.constantFrom("administrator", "manager", "viewer"),
      (chars, spaces, role) => {
        const local = chars.join("") + ".team+renewals",
          canonical = local.toLowerCase() + "@example.test",
          raw =
            " ".repeat(spaces) + local + "@Example.TEST" + " ".repeat(spaces);
        expect(normalizeEmail(raw)).toBe(canonical);
        expect(normalizeEmail(canonical)).toBe(canonical);
        expect(validateInvitation({ email: raw, role })).toEqual({
          success: true,
          data: { email: canonical, role },
        });
        expect(roleLabels[role]).toBe(
          {
            administrator: "Practice administrator",
            manager: "Office manager",
            viewer: "Viewer",
          }[role],
        );
        expect(
          validateInvitation({ email: raw, role, actor: "forged" }),
        ).toMatchObject({
          success: false,
          errors: { form: expect.any(String) },
        });
        for (const email of [
          "\t" + canonical,
          canonical + "\n",
          "é" + canonical,
        ])
          expect(validateInvitation({ email, role })).toMatchObject({
            success: false,
            errors: { email: expect.any(String) },
          });
        expect(
          validateInvitation({ email: "a".repeat(241) + "@example.test", role })
            .success,
        ).toBe(true);
        expect(
          validateInvitation({
            email: "a".repeat(242) + "@example.test",
            role,
          }),
        ).toMatchObject({
          success: false,
          errors: { email: expect.any(String) },
        });
        expect(
          validateInvitation({ email: local + " staff@example.test", role }),
        ).toMatchObject({
          success: false,
          errors: { email: expect.any(String) },
        });
        const link = generateInvitation();
        expect(Buffer.from(link.token, "base64url")).toHaveLength(32);
        expect(link.digest).toBe(
          createHash("sha256").update(link.token).digest("hex"),
        );
        expect(hashInvitationToken(link.token)).toBe(link.digest);
        for (const bad of [
          null,
          {},
          link.token + "=",
          link.token.slice(1),
          "=".repeat(43),
          "A".repeat(42) + "B",
          "A".repeat(44),
        ])
          expect(hashInvitationToken(bad)).toBeNull();
      },
    ),
    { seed: 20261005, numRuns: 1000, includeErrorInReport: true },
  );
});
