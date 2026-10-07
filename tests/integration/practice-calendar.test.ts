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
import { projectCalendar } from "@/lib/calendar/events";
import { parseCalendarQuery } from "@/lib/calendar/query";
afterAll(async () => {
  await pool.end();
});
type Actor = Awaited<ReturnType<typeof account>>;
const query = parseCalendarQuery({ month: "2028-02" }, "2026-10-07");
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
it("C01 C02 C03 C13 real authorized reads project all dates and shared ownership without changing history", async () => {
  const a = await practice(),
    b = await practice();
  const person = await a.client.rpc("create_practice_clinician", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_name: "Rivera",
  });
  expect(person.error).toBeNull();
  const id = person.data.clinician.id;
  for (const type of [
    "state_license",
    "dea_registration",
    "malpractice_policy",
  ]) {
    await create(a, a.practice.id, { p_type: type, p_title: type });
  }
  const shared = await create(a, a.practice.id, {
      p_title: "Shared",
      p_covered_clinician_ids: [id],
    }),
    unknown = await create(a, a.practice.id, {
      p_title: "Unknown",
      p_end_date: null,
      p_action_deadline: null,
    });
  await create(b, b.practice.id, { p_title: "Foreign" });
  const before = await snapshot(a.practice.id),
    register = await read(a, a.practice.id),
    projected = projectCalendar(register, query);
  expect(projected.events).toHaveLength(8);
  expect(projected.undated.map((r) => r.id)).toEqual([unknown.id]);
  expect(projected.events.some((e) => e.record.title === "Foreign")).toBe(
    false,
  );
  expect(
    projectCalendar(register, { ...query, clinician: id }).events.map(
      (e) => e.record.id,
    ),
  ).toEqual([shared.id, shared.id]);
  expect(
    projectCalendar(register, {
      ...query,
      clinician: id,
      type: "state_license",
    }).events,
  ).toEqual([]);
  expect(await snapshot(a.practice.id)).toEqual(before);
});
it("C07 C08 live member roles read and retained revoked tokens/outsider/anonymous are denied", async () => {
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
      projectCalendar(await read(m, a.practice.id), query).events,
    ).toHaveLength(2);
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
it("C09 C13 real date corrections and archive replace events while preserving retained cycle history", async () => {
  const a = await practice(),
    c = await create(a, a.practice.id);
  const tokens = {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: c.current_cycle.date_revision,
  };
  const changed = await a.client.rpc("update_practice_credential", {
    ...tokens,
    p_title: c.title,
    p_type: c.type,
    p_owner_kind: c.owner_kind,
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [],
    p_issuer: c.issuer,
    p_jurisdiction: c.jurisdiction,
    p_end_date: "2028-03-01",
    p_action_deadline: null,
  });
  expect(changed.error).toBeNull();
  expect(changed.data.status).toBe("success");
  const latest = changed.data.credential,
    r = await read(a, a.practice.id);
  expect(projectCalendar(r, query)).toEqual({ events: [], undated: [] });
  expect(
    projectCalendar(r, { ...query, month: "2028-03" }).events.map((e) => [
      e.id,
      e.date,
      e.tracking,
      e.dateRevision,
    ]),
  ).toEqual([[c.current_cycle.id + ":end", "2028-03-01", true, 2]]);
  const archive = await a.client.rpc("archive_practice_credential", {
    ...tokens,
    p_request_id: randomUUID(),
    p_expected_version: latest.version,
    p_expected_date_revision: latest.current_cycle.date_revision,
  });
  expect(archive.error).toBeNull();
  expect(archive.data.status).toBe("success");
  const before = await snapshot(a.practice.id);
  expect(
    projectCalendar(await read(a, a.practice.id), {
      ...query,
      month: "2028-03",
    }),
  ).toEqual({ events: [], undated: [] });
  expect(await snapshot(a.practice.id)).toEqual(before);
  expect((before["public.credential_cycles"] as { id: string }[])[0].id).toBe(
    c.current_cycle.id,
  );
  expect(before["private.register_change_requests"]).toHaveLength(2);
});
it("C08 missing cycles fail as unavailable rather than invented undated records", async () => {
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
it("C11 dense read preserves every event and records observed pilot timing", async () => {
  const a = await practice();
  for (let i = 0; i < 40; i++)
    await create(a, a.practice.id, {
      p_title: `Dense ${String(i).padStart(2, "0")}`,
    });
  const start = performance.now(),
    r = await read(a, a.practice.id),
    events = projectCalendar(r, query).events;
  expect(events).toHaveLength(80);
  expect(new Set(events.map((e) => e.id)).size).toBe(80);
  console.log(
    `C11 dense fixture: 40 credentials / 80 events; authorized read + projection ${Math.round(performance.now() - start)}ms (observation, no latency SLA).`,
  );
});
