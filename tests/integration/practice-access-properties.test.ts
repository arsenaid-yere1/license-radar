import { afterAll, expect, it } from "vitest";
import fc from "fast-check";
import { writeFileSync } from "node:fs";
import { validateInvitation } from "@/lib/team/schema";
import {
  account,
  capability,
  events,
  invite,
  membership,
  pool,
  practice,
} from "../helpers/access-fixtures";
afterAll(() => pool.end());
it("P01 1000 seeded email variants agree with actual SQL canonicalization", async () => {
  const samples = fc.sample(
    fc.oneof(
      fc
        .tuple(
          fc.constantFrom("", " ", "  "),
          fc.constantFrom("Manager+Renewals", "A.b", "Staff"),
          fc.constantFrom("EXAMPLE.test", "Example.TEST"),
          fc.constantFrom("", " ", "  "),
        )
        .map(
          ([left, local, domain, right]) => `${left}${local}@${domain}${right}`,
        ),
      fc.constantFrom(
        "\ta@example.test",
        "a@example.test\n",
        "é@example.test",
        "a..b@example.test",
        ".a@example.test",
        "a@example",
        "a".repeat(255) + "@example.test",
        "a b@example.test",
      ),
    ),
    { seed: 20261005, numRuns: 1000 },
  );
  const db = await pool.connect();
  let valid = 0,
    invalid = 0;
  try {
    await db.query("begin");
    for (const email of samples) {
      const parsed = validateInvitation({ email, role: "manager" });
      await db.query("savepoint email_case");
      try {
        const stored = await db.query(
          "select private.canonical_invitation_email($1) email",
          [email],
        );
        expect(parsed.success).toBe(true);
        if (!parsed.success) throw new Error("SQL accepted app-invalid email");
        expect(stored.rows[0].email).toBe(parsed.data.email);
        valid++;
      } catch (error) {
        await db.query("rollback to savepoint email_case");
        if (parsed.success) throw error;
        expect((error as { code: string }).code).toBe("23514");
        invalid++;
      }
      await db.query("release savepoint email_case");
    }
  } finally {
    await db.query("rollback");
    db.release();
  }
  expect(valid).toBeGreaterThan(0);
  expect(invalid).toBeGreaterThan(0);
  writeFileSync(
    "reports/email-properties.json",
    JSON.stringify({
      seed: 20261005,
      examples: samples.length,
      valid,
      invalid,
    }),
  );
});
it("P03 20 seeded real two-practice lifecycle sequences preserve state, versions and exact event counts", async () => {
  let examples = 0,
    operations = 0;
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom("administrator", "manager", "viewer"), {
        minLength: 1,
        maxLength: 3,
      }),
      async (roles) => {
        const a = await practice(),
          q = await practice("Birch Clinic"),
          b = await account();
        let link = await invite(a, b.email),
          expectedEvents = 2,
          lastVersion = 0;
        const other = await invite(q, b.email);
        const invariant = async () => {
          expect(await events(a.practice.id)).toHaveLength(expectedEvents);
          expect(
            (
              await pool.query(
                "select count(*)::int n from public.practice_memberships where user_id=$1 and state='active'",
                [b.user.id],
              )
            ).rows[0].n,
          ).toBeLessThanOrEqual(1);
          for (const practiceId of [a.practice.id, q.practice.id])
            expect(
              (
                await pool.query(
                  "select count(*)::int n from public.practice_memberships where practice_id=$1 and role='administrator' and state='active'",
                  [practiceId],
                )
              ).rows[0].n,
            ).toBeGreaterThan(0);
        };
        await invariant();
        for (const role of roles) {
          const joined = await b.client.rpc("accept_practice_invitation", {
            p_token_digest: link.digest,
          });
          operations++;
          expect(joined.data.status).toBe("success");
          expectedEvents += 2;
          await invariant();
          let member = await membership(a.practice.id, b.user.id);
          expect(member.version).toBeGreaterThan(lastVersion);
          lastVersion = member.version;
          const otherBefore = await events(q.practice.id);
          const denied = await b.client.rpc("accept_practice_invitation", {
            p_token_digest: other.digest,
          });
          operations++;
          expect(denied.data).toEqual({ status: "other-practice" });
          expect(await events(q.practice.id)).toEqual(otherBefore);
          expect(
            (
              await pool.query(
                "select state,version from private.practice_invitations where id=$1",
                [other.invitation.id],
              )
            ).rows,
          ).toEqual([{ state: "pending", version: 1 }]);
          expect(await membership(q.practice.id, b.user.id)).toBeUndefined();
          await invariant();
          const changed = await a.client.rpc("change_practice_member_role", {
            p_membership_id: member.id,
            p_expected_version: member.version,
            p_role: role,
          });
          operations++;
          expect(changed.data.status).toBe("success");
          if (member.role !== role) expectedEvents++;
          await invariant();
          const beforeChange = member;
          member = await membership(a.practice.id, b.user.id);
          expect(member.version).toBe(
            beforeChange.version + (beforeChange.role === role ? 0 : 1),
          );
          const beforeReplay = await events(a.practice.id);
          expect(
            (
              await b.client.rpc("accept_practice_invitation", {
                p_token_digest: link.digest,
              })
            ).data,
          ).toMatchObject({ status: "already-member", role });
          operations++;
          expect(await membership(a.practice.id, b.user.id)).toEqual(member);
          expect(await events(a.practice.id)).toEqual(beforeReplay);
          const oldPending = await invite(a, b.email, "manager");
          expectedEvents++;
          await invariant();
          expect(
            (
              await a.client.rpc("revoke_practice_member", {
                p_membership_id: member.id,
                p_expected_version: member.version,
              })
            ).data.status,
          ).toBe("success");
          operations++;
          expectedEvents++;
          await invariant();
          expect((await membership(a.practice.id, b.user.id)).version).toBe(
            member.version + 1,
          );
          for (const digest of [link.digest, oldPending.digest]) {
            expect(
              (
                await b.client.rpc("accept_practice_invitation", {
                  p_token_digest: digest,
                })
              ).data,
            ).toEqual({ status: "invalid-invitation" });
            operations++;
          }
          const next = capability();
          expect(
            (
              await a.client.rpc("reissue_practice_invitation", {
                p_invitation_id: oldPending.invitation.id,
                p_expected_version: 1,
                p_token_digest: next.digest,
              })
            ).data.status,
          ).toBe("success");
          operations++;
          expectedEvents++;
          link = { ...oldPending, ...next };
          await invariant();
          expect(await events(a.practice.id)).toHaveLength(expectedEvents);
          expect(
            (
              await pool.query(
                "select count(*)::int n from public.practice_memberships where user_id=$1 and state='active'",
                [b.user.id],
              )
            ).rows[0].n,
          ).toBe(0);
          for (const practiceId of [a.practice.id, q.practice.id])
            expect(
              (
                await pool.query(
                  "select count(*)::int n from public.practice_memberships where practice_id=$1 and role='administrator' and state='active'",
                  [practiceId],
                )
              ).rows[0].n,
            ).toBeGreaterThan(0);
        }
        examples++;
      },
    ),
    { seed: 20261005, numRuns: 20, includeErrorInReport: true },
  );
  writeFileSync(
    "reports/access-properties.json",
    JSON.stringify({ seed: 20261005, examples, operations }),
  );
});
