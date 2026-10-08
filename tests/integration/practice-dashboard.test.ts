import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import {
  account,
  invite,
  membership,
  pool,
  practice,
} from "../helpers/access-fixtures";
import { anonymous } from "../helpers/local-fixtures";
import { getMaintenanceRegister } from "@/lib/register/repository";
import { projectDashboard } from "@/lib/dashboard/summary";

afterAll(async () => {
  await pool.end();
});
type Actor = Awaited<ReturnType<typeof account>>;
const today = "2026-10-08";
async function create(
  a: Actor,
  practiceId: string,
  patch: Record<string, unknown> = {},
) {
  const { data, error } = await a.client.rpc(
    "create_practice_credential_with_details",
    {
      p_practice_id: practiceId,
      p_request_id: randomUUID(),
      p_title: "Policy",
      p_type: "malpractice_policy",
      p_owner_kind: "practice",
      p_owner_clinician_id: null,
      p_covered_clinician_ids: [],
      p_issuer: "Insurer",
      p_jurisdiction: "CA",
      p_end_date: "2028-02-29",
      p_action_deadline: "2028-02-01",
      ...patch,
    },
  );
  expect(error).toBeNull();
  expect(data.status).toBe("success");
  return data.credential;
}
async function read(a: Actor, id: string) {
  const r = await getMaintenanceRegister(a.client, id, false);
  expect(r.status).toBe("success");
  if (r.status !== "success") throw new Error("Fixture read failed");
  return r.register;
}
async function snapshot(id: string) {
  const rows: Record<string, unknown[]> = {};
  for (const table of [
    "public.credentials",
    "public.credential_cycles",
    "public.policy_coverage",
    "private.register_audit_events",
    "private.register_create_requests",
    "private.register_change_requests",
  ]) {
    rows[table] = (
      await pool.query(
        `select * from ${table} where practice_id=$1 order by ${table.endsWith("coverage") ? "credential_id,clinician_id" : "id"}`,
        [id],
      )
    ).rows;
  }
  return rows;
}
it("Q01 Q02 Q03 Q11 real record partitions and shared coverage preserve complete history", async () => {
  const a = await practice(),
    b = await practice();
  const people = [];
  for (const name of ["Rivera", "Chen"]) {
    const reply = await a.client.rpc("create_practice_clinician", {
      p_practice_id: a.practice.id,
      p_request_id: randomUUID(),
      p_name: name,
    });
    expect(reply.error).toBeNull();
    people.push(reply.data.clinician.id);
  }
  const created: Awaited<ReturnType<typeof create>>[] = [];
  for (const [title, type, end, action, coverage] of [
    ["Past", "state_license", "2026-10-07", null, []],
    ["Today", "dea_registration", today, null, []],
    ["Day60", "malpractice_policy", "2026-12-08", "2026-12-07", people],
    ["Later", "state_license", "2026-12-08", null, []],
    ["Unknown", "malpractice_policy", null, null, []],
    ["Action only", "dea_registration", null, today, []],
  ] as const)
    created.push(
      await create(a, a.practice.id, {
        p_title: title,
        p_type: type,
        p_end_date: end,
        p_action_deadline: action,
        p_covered_clinician_ids: coverage,
      }),
    );
  await create(b, b.practice.id, { p_title: "Foreign" });
  const before = await snapshot(a.practice.id),
    start = performance.now(),
    r = projectDashboard(await read(a, a.practice.id), today);
  expect(r.pastDue.map((e) => e.record.id)).toEqual([created[0].id]);
  expect(r.dueWithin60.map((e) => e.record.id)).toEqual([
    created[5].id,
    created[1].id,
    created[2].id,
  ]);
  expect(r.later.map((e) => e.record.id)).toEqual([created[3].id]);
  expect(r.undated.map((e) => e.record.id)).toEqual([created[4].id]);
  expect(r.missingEnd.map((e) => e.record.id)).toEqual([
    created[5].id,
    created[4].id,
  ]);
  expect(
    r.dueWithin60.find((e) => e.record.id === created[2].id)?.record
      .covered_clinicians,
  ).toHaveLength(2);
  expect(await snapshot(a.practice.id)).toEqual(before);
  console.log(
    `Q11 authorized read/projection: ${Math.round(performance.now() - start)}ms (observation, no SLA).`,
  );
});
it("Q10 Q11 checked corrections, clearing and archive update buckets while retaining history", async () => {
  const a = await practice();
  let c = await create(a, a.practice.id, {
    p_end_date: "2026-12-08",
    p_action_deadline: null,
  });
  const cycleId = c.current_cycle.id;
  const counts = async () => {
    const r = projectDashboard(await read(a, a.practice.id), today);
    return [
      r.pastDue.length,
      r.dueWithin60.length,
      r.later.length,
      r.undated.length,
      r.missingEnd.length,
    ];
  };
  expect(await counts()).toEqual([0, 0, 1, 0, 0]);
  for (const end of ["2026-10-07", null]) {
    const result = await a.client.rpc("update_practice_credential", {
      p_practice_id: a.practice.id,
      p_request_id: randomUUID(),
      p_credential_id: c.id,
      p_expected_version: c.version,
      p_expected_cycle_id: c.current_cycle.id,
      p_expected_date_revision: c.current_cycle.date_revision,
      p_title: c.title,
      p_type: c.type,
      p_owner_kind: c.owner_kind,
      p_owner_clinician_id: null,
      p_covered_clinician_ids: [],
      p_issuer: c.issuer,
      p_jurisdiction: c.jurisdiction,
      p_end_date: end,
      p_action_deadline: null,
    });
    expect(result.error).toBeNull();
    expect(result.data.status).toBe("success");
    c = result.data.credential;
    expect(await counts()).toEqual(end ? [1, 0, 0, 0, 0] : [0, 0, 0, 1, 1]);
  }
  const archive = await a.client.rpc("archive_practice_credential", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: c.current_cycle.date_revision,
  });
  expect(archive.error).toBeNull();
  expect(archive.data.status).toBe("success");
  const before = await snapshot(a.practice.id);
  expect(await counts()).toEqual([0, 0, 0, 0, 0]);
  expect(await snapshot(a.practice.id)).toEqual(before);
  expect(before["public.credential_cycles"]).toHaveLength(1);
  expect((before["public.credential_cycles"] as { id: string }[])[0].id).toBe(
    cycleId,
  );
  expect(before["private.register_change_requests"]).toHaveLength(3);
});
it("Q08 live member roles read and retained revoked tokens/outsider/anonymous are denied", async () => {
  const a = await practice(),
    b = await practice();
  await create(a, a.practice.id);
  for (const role of ["manager", "viewer"]) {
    const m = await account(),
      link = await invite(a, m.email, role);
    expect(
      (
        await m.client.rpc("accept_practice_invitation", {
          p_token_digest: link.digest,
        })
      ).error,
    ).toBeNull();
    expect(
      projectDashboard(await read(m, a.practice.id), "2028-02-01").dueWithin60,
    ).toHaveLength(1);
    if (role === "manager") {
      const member = await membership(a.practice.id, m.user.id);
      const revoked = await a.client.rpc("revoke_practice_member", {
        p_membership_id: member.id,
        p_expected_version: member.version,
      });
      expect(revoked.error).toBeNull();
      expect(
        await getMaintenanceRegister(m.client, a.practice.id, false),
      ).toEqual({ status: "forbidden" });
    }
  }
  expect(await getMaintenanceRegister(b.client, a.practice.id, false)).toEqual({
    status: "forbidden",
  });
  expect(
    await getMaintenanceRegister(anonymous(), a.practice.id, false),
  ).toEqual({ status: "forbidden" });
});
it("Q08 missing cycles fail as unavailable rather than invented undated records", async () => {
  const a = await practice(),
    c = await create(a, a.practice.id),
    row = (
      await pool.query("select * from public.credential_cycles where id=$1", [
        c.current_cycle.id,
      ])
    ).rows[0];
  await pool.query("delete from public.credential_cycles where id=$1", [
    row.id,
  ]);
  try {
    const before = await snapshot(a.practice.id);
    expect(
      await getMaintenanceRegister(a.client, a.practice.id, false),
    ).toEqual({ status: "unavailable" });
    expect(await snapshot(a.practice.id)).toEqual(before);
  } finally {
    await pool.query(
      "insert into public.credential_cycles select * from jsonb_populate_record(null::public.credential_cycles,$1::jsonb)",
      [JSON.stringify(row)],
    );
  }
});
