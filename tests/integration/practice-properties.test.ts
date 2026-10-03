import { writeFileSync } from "node:fs";
import { it, expect, afterAll } from "vitest";
import fc from "fast-check";
import { account, pool } from "../helpers/local-fixtures";
import { createPractice, updatePractice } from "@/lib/practice/repository";
import { validatePractice } from "@/lib/practice/schema";
afterAll(() => pool.end());
it("P01 1000 seeded Unicode names agree with actual PostgreSQL writes", async () => {
  const a = await account();
  const first = await createPractice(a.client, {
    name: "Start",
    timezone: "UTC",
  });
  if (first.status !== "success") throw new Error("initial write failed");
  const names = fc.sample(
    fc
      .array(fc.constantFrom("a", "😀", "é", "中", " ", "\t", "\u00a0"), {
        maxLength: 140,
      })
      .map((parts) => parts.join("")),
    { seed: 20261003, numRuns: 1000 },
  );
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      a.user.id,
    ]);
    await db.query("set local role authenticated");
    for (const name of names) {
      const accepted = validatePractice({ name, timezone: "UTC" }).success;
      await db.query("savepoint name_case");
      try {
        const r = await db.query(
          "update public.practices set name=$1 where id=$2 returning name",
          [name, first.practice.id],
        );
        expect(accepted).toBe(true);
        expect(r.rows[0].name).toBe(name.trim());
      } catch (error) {
        await db.query("rollback to savepoint name_case");
        if (accepted) throw error;
        expect((error as { code?: string }).code).toBe("23514");
      }
      await db.query("release savepoint name_case");
    }
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("P03 20 generated actual API sequences preserve identity and monotonic version", async () => {
  const counts = { examples: 0, updates: 0, retries: 0 };
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
      async (steps) => {
        counts.examples++;
        const a = await account();
        const first = await createPractice(a.client, {
          name: "Start",
          timezone: "UTC",
        });
        expect(first.status).toBe("success");
        if (first.status !== "success") throw new Error("first failure");
        let version = 1;
        for (const edit of steps) {
          const result = edit
            ? await updatePractice(a.client, first.practice.id, {
                name: "Updated",
                timezone: "America/New_York",
                expectedVersion: version,
              })
            : await createPractice(a.client, {
                name: "Never overwritten",
                timezone: "UTC",
              });
          expect(result.status).toBe("success");
          if (result.status !== "success") throw new Error("sequence failure");
          if (edit) {
            version++;
            counts.updates++;
          } else counts.retries++;
          expect(result.practice.id).toBe(first.practice.id);
          expect(result.practice.owner_user_id).toBe(a.user.id);
          expect(result.practice.version).toBe(version);
        }
      },
    ),
    { seed: 20261005, numRuns: 20 },
  );
  writeFileSync(
    "reports/api-properties.json",
    JSON.stringify({ seed: 20261005, ...counts }),
  );
});
