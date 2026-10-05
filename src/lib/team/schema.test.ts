import { expect, it } from "vitest";
import { normalizeEmail, validateInvitation } from "./schema";
import { generateInvitation, hashInvitationToken } from "./invitations";
import { createHash } from "node:crypto";
it("S08 S10 ASCII normalization preserves dots and plus tags", () => {
  expect(normalizeEmail("  Manager+Renewals@Example.test  ")).toBe(
    "manager+renewals@example.test",
  );
  expect(
    validateInvitation({
      email: "  Manager+Renewals@Example.test  ",
      role: "manager",
    }),
  ).toEqual({
    success: true,
    data: { email: "manager+renewals@example.test", role: "manager" },
  });
});
it.each([
  "bad",
  "\ta@example.test",
  "a@example.test\n",
  "é@example.test",
  "a".repeat(255) + "@example.test",
])("S09 invalid email case %j rejected", (email) => {
  expect(validateInvitation({ email, role: "manager" })).toMatchObject({
    success: false,
    errors: { email: expect.any(String) },
  });
});
it("S09 role and extra authority fields rejected", () => {
  for (const bad of [
    { role: "owner" },
    { actor: "victim" },
    { practiceId: "foreign" },
  ])
    expect(
      validateInvitation({
        email: "valid@example.test",
        role: "viewer",
        ...bad,
      }).success,
    ).toBe(false);
  for (const role of ["administrator", "manager", "viewer"])
    expect(
      validateInvitation({ email: "valid@example.test", role }),
    ).toMatchObject({ success: true, data: { role } });
});
it("S08 P02 cryptographic token is 32 bytes and hashes independently", () => {
  for (let i = 0; i < 1000; i++) {
    const link = generateInvitation();
    expect(Buffer.from(link.token, "base64url")).toHaveLength(32);
    expect(hashInvitationToken(link.token)).toBe(
      createHash("sha256").update(link.token).digest("hex"),
    );
    expect(link.digest).toBe(hashInvitationToken(link.token));
  }
});
it("S21 malformed or noncanonical token gives no capability", () => {
  for (const token of [
    null,
    {},
    "",
    "short",
    "a".repeat(44),
    "=".repeat(43),
    "A".repeat(42) + "B",
  ])
    expect(hashInvitationToken(token)).toBeNull();
});
