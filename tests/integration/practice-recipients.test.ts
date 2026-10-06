import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import {
  account,
  practice,
  invite,
  membership,
  pool,
} from "../helpers/access-fixtures";
afterAll(async () => {
  await pool.end();
});
async function staff(
  a: Awaited<ReturnType<typeof practice>>,
  role = "manager",
) {
  const person = await account();
  const link = await invite(a, person.email, role);
  expect(
    (
      await person.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).error,
  ).toBeNull();
  return { ...person, member: await membership(a.practice.id, person.user.id) };
}
function get(a: Awaited<ReturnType<typeof account>>, id: string) {
  return a.client.rpc("get_practice_reminder_recipient", { p_practice_id: id });
}
function set(
  a: Awaited<ReturnType<typeof account>>,
  id: string,
  target: string | null,
  version: number,
) {
  return a.client.rpc("set_practice_reminder_recipient", {
    p_practice_id: id,
    p_membership_id: target,
    p_expected_version: version,
  });
}
async function history(id: string) {
  return (
    await pool.query(
      "select * from private.practice_recipient_events where practice_id=$1 order by after_version",
      [id],
    )
  ).rows;
}
async function change(
  a: Awaited<ReturnType<typeof practice>>,
  target: { id: string; version: number },
  role?: string,
) {
  return a.client.rpc(
    role ? "change_practice_member_role" : "revoke_practice_member",
    {
      p_membership_id: target.id,
      p_expected_version: target.version,
      ...(role ? { p_role: role } : {}),
    },
  );
}
async function blocked(name: string) {
  for (let i = 0; i < 200; i++) {
    const result = await pool.query(
      "select 1 from pg_stat_activity where wait_event_type='Lock' and query like $1",
      [`%${name}%`],
    );
    if (result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect.fail("Expected witnessed lock wait");
}
it("R01 R02 R03 recipient role matrix, tenant targets and minimal projection", async () => {
  const a = await practice(),
    b = await practice(),
    manager = await staff(a),
    viewer = await staff(a, "viewer"),
    revoked = await staff(a);
  const admin = await membership(a.practice.id, a.user.id),
    foreign = await membership(b.practice.id, b.user.id);
  expect((await change(a, revoked.member)).data).toEqual({ status: "success" });
  const pending = await invite(a, (await account()).email);
  expect((await get(a, a.practice.id)).data).toEqual({
    version: 1,
    selected: null,
    readiness: "no-recipient",
    ready: false,
    canEdit: true,
    candidates: [
      expect.objectContaining({ id: admin.id }),
      expect.objectContaining({ id: manager.member.id }),
    ],
  });
  for (const target of [
    foreign.id,
    randomUUID(),
    viewer.member.id,
    revoked.member.id,
    pending.invitation.id,
  ])
    expect((await set(a, a.practice.id, target, 1)).data).toEqual({
      status: "invalid-recipient",
    });
  for (const person of [viewer, revoked, b])
    expect((await set(person, a.practice.id, admin.id, 1)).error?.code).toBe(
      "42501",
    );
  for (const person of [revoked, b])
    expect((await get(person, a.practice.id)).error?.code).toBe("42501");
  expect(
    (await set(manager, a.practice.id, manager.member.id, 1)).data,
  ).toMatchObject({
    status: "success",
    recipient: {
      version: 2,
      selected: { id: manager.member.id },
      readiness: "sms-setup-pending",
      ready: false,
    },
  });
  expect((await get(viewer, a.practice.id)).data).toEqual({
    version: 2,
    selected: {
      id: manager.member.id,
      email: manager.email,
      role: "manager",
      state: "active",
    },
    readiness: "sms-setup-pending",
    ready: false,
    canEdit: false,
  });
  expect(
    (
      await manager.client.rpc("list_practice_team", {
        p_practice_id: a.practice.id,
      })
    ).error?.code,
  ).toBe("42501");
  expect(await history(a.practice.id)).toHaveLength(1);
});
it("R04 versioned assignment replacement clear audit and no-op preserve profile", async () => {
  const a = await practice(),
    m = await staff(a),
    admin = await membership(a.practice.id, a.user.id);
  for (const bad of [0, -1, null])
    expect(
      (await set(a, a.practice.id, admin.id, bad as never)).error?.code,
    ).toBe("23514");
  expect((await set(a, a.practice.id, null, 1)).data).toMatchObject({
    status: "success",
    recipient: { version: 1 },
  });
  expect((await set(a, a.practice.id, admin.id, 1)).data).toMatchObject({
    status: "success",
    recipient: { version: 2 },
  });
  expect((await set(a, a.practice.id, admin.id, 1)).data).toEqual({
    status: "conflict",
  });
  expect((await set(a, a.practice.id, admin.id, 2)).data).toMatchObject({
    status: "success",
    recipient: { version: 2 },
  });
  expect((await set(a, a.practice.id, m.member.id, 2)).data).toMatchObject({
    status: "success",
    recipient: { version: 3 },
  });
  expect((await set(a, a.practice.id, null, 3)).data).toMatchObject({
    status: "success",
    recipient: { version: 4, selected: null },
  });
  const events = await history(a.practice.id);
  expect(
    events.map((e) => [
      e.operation,
      e.before_membership_id,
      e.after_membership_id,
      e.before_version,
      e.after_version,
      e.actor_user_id,
      e.reason,
    ]),
  ).toEqual([
    ["assigned", null, admin.id, 1, 2, a.user.id, null],
    ["replaced", admin.id, m.member.id, 2, 3, a.user.id, null],
    ["cleared", m.member.id, null, 3, 4, a.user.id, null],
  ]);
  expect(events.every((e) => e.occurred_at instanceof Date)).toBe(true);
  expect(
    (
      await pool.query("select version from public.practices where id=$1", [
        a.practice.id,
      ])
    ).rows[0].version,
  ).toBe(1);
});
it("R05 selected member invalidation is atomic and promotion/rejoin never restores", async () => {
  const a = await practice(),
    m = await staff(a);
  expect((await set(a, a.practice.id, m.member.id, 1)).error).toBeNull();
  expect((await change(a, m.member, "administrator")).data).toEqual({
    status: "success",
  });
  expect((await get(a, a.practice.id)).data).toMatchObject({
    version: 2,
    selected: { id: m.member.id },
  });
  expect((await change(a, { ...m.member, version: 2 }, "viewer")).data).toEqual(
    { status: "success" },
  );
  expect((await get(a, a.practice.id)).data).toMatchObject({
    version: 3,
    selected: null,
  });
  expect((await history(a.practice.id))[1]).toMatchObject({
    operation: "member-invalidated",
    reason: "role-viewer",
    before_membership_id: m.member.id,
    after_membership_id: null,
  });
  await change(a, { ...m.member, version: 3 }, "manager");
  expect((await get(a, a.practice.id)).data).toMatchObject({
    version: 3,
    selected: null,
  });
  await set(a, a.practice.id, m.member.id, 3);
  await change(a, { ...m.member, version: 4 });
  expect((await history(a.practice.id))[3]).toMatchObject({
    operation: "member-invalidated",
    reason: "revoked",
  });
  expect((await get(m, a.practice.id)).error?.code).toBe("42501");
  const link = await invite(a, m.email);
  await m.client.rpc("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
  expect((await get(m, a.practice.id)).data).toMatchObject({
    version: 5,
    selected: null,
  });
});
it("R06 concurrent saves witness waiting and exactly one same-version winner", async () => {
  const a = await practice(),
    m = await staff(a),
    admin = await membership(a.practice.id, a.user.id),
    db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      a.user.id,
    ]);
    await db.query("select private.set_practice_reminder_recipient($1,$2,1)", [
      a.practice.id,
      admin.id,
    ]);
    const late = Promise.resolve(set(m, a.practice.id, m.member.id, 1));
    await blocked("set_practice_reminder_recipient");
    await db.query("commit");
    expect((await late).data).toEqual({ status: "conflict" });
    expect((await get(a, a.practice.id)).data).toMatchObject({
      version: 2,
      selected: { id: admin.id },
    });
    expect(await history(a.practice.id)).toHaveLength(1);
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("R07 candidate and editor eligibility is rechecked after witnessed lock wait", async () => {
  for (const kind of [
    "candidate-demoted",
    "candidate-revoked",
    "editor-revoked",
    "assign-first",
  ]) {
    const a = await practice(),
      m = await staff(a),
      admin = await membership(a.practice.id, a.user.id),
      db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        a.user.id,
      ]);
      if (kind === "assign-first") {
        await db.query(
          "select private.set_practice_reminder_recipient($1,$2,1)",
          [a.practice.id, m.member.id],
        );
        const late = Promise.resolve(change(a, m.member, "viewer"));
        await blocked("change_practice_member_role");
        await db.query("commit");
        expect((await late).data).toEqual({ status: "success" });
        expect((await get(a, a.practice.id)).data).toMatchObject({
          version: 3,
          selected: null,
        });
      } else {
        await db.query("select private.mutate_member($1,1,$2,$3)", [
          m.member.id,
          kind === "candidate-demoted" ? "viewer" : null,
          kind !== "candidate-demoted",
        ]);
        const late = Promise.resolve(
          set(
            kind === "editor-revoked" ? m : a,
            a.practice.id,
            kind === "editor-revoked" ? admin.id : m.member.id,
            1,
          ),
        );
        await blocked("set_practice_reminder_recipient");
        await db.query("commit");
        const reply = await late;
        if (kind === "editor-revoked") expect(reply.error?.code).toBe("42501");
        else expect(reply.data).toEqual({ status: "invalid-recipient" });
        expect(await history(a.practice.id)).toHaveLength(0);
      }
    } finally {
      await db.query("rollback");
      db.release();
    }
  }
});
it("R08 audit failure rolls back assignment replacement clear and access invalidation", async () => {
  const a = await practice(),
    m = await staff(a),
    admin = await membership(a.practice.id, a.user.id);
  async function fault(run: () => PromiseLike<unknown>) {
    await pool.query(
      "create function private.recipient_audit_fault() returns trigger language plpgsql as $$begin raise exception 'fixture fault'; end;$$; create trigger recipient_audit_fault before insert on private.practice_recipient_events for each row execute function private.recipient_audit_fault()",
    );
    const before = (
      await pool.query(
        "select * from private.practice_reminder_settings where practice_id=$1",
        [a.practice.id],
      )
    ).rows;
    const memberBefore = (
      await pool.query(
        "select * from public.practice_memberships where practice_id=$1 order by id",
        [a.practice.id],
      )
    ).rows;
    const accessBefore = (
      await pool.query(
        "select * from private.practice_access_events where practice_id=$1 order by id",
        [a.practice.id],
      )
    ).rows;
    try {
      const result = (await run()) as { error: { code: string } };
      expect(result.error?.code).toBe("P0001");
      expect(
        (
          await pool.query(
            "select * from private.practice_reminder_settings where practice_id=$1",
            [a.practice.id],
          )
        ).rows,
      ).toEqual(before);
      expect(
        (
          await pool.query(
            "select * from public.practice_memberships where practice_id=$1 order by id",
            [a.practice.id],
          )
        ).rows,
      ).toEqual(memberBefore);
      expect(
        (
          await pool.query(
            "select * from private.practice_access_events where practice_id=$1 order by id",
            [a.practice.id],
          )
        ).rows,
      ).toEqual(accessBefore);
    } finally {
      await pool.query(
        "drop trigger recipient_audit_fault on private.practice_recipient_events; drop function private.recipient_audit_fault()",
      );
    }
  }
  await fault(() => set(a, a.practice.id, admin.id, 1));
  await set(a, a.practice.id, admin.id, 1);
  await fault(() => set(a, a.practice.id, m.member.id, 2));
  await set(a, a.practice.id, m.member.id, 2);
  await fault(() => set(a, a.practice.id, null, 3));
  await fault(() => change(a, m.member, "viewer"));
  await fault(() => change(a, m.member));
  expect(await history(a.practice.id)).toHaveLength(2);
});
it("R09 missing settings fail reads writes and even unselected member invalidation", async () => {
  const a = await practice(),
    m = await staff(a);
  await pool.query(
    "delete from private.practice_reminder_settings where practice_id=$1",
    [a.practice.id],
  );
  try {
    expect((await get(a, a.practice.id)).error?.code).toBe("XX000");
    expect((await set(a, a.practice.id, m.member.id, 1)).error?.code).toBe(
      "XX000",
    );
    expect((await change(a, m.member, "viewer")).error?.code).toBe("XX000");
    expect((await change(a, m.member)).error?.code).toBe("XX000");
    expect(await membership(a.practice.id, m.user.id)).toMatchObject({
      role: "manager",
      state: "active",
      version: 1,
    });
  } finally {
    await pool.query(
      "insert into private.practice_reminder_settings(practice_id) values($1)",
      [a.practice.id],
    );
  }
});
it("R10 initialization failure rolls back practice memberships and historical events", async () => {
  const person = await account();
  const before = (await pool.query("select count(*) from public.practices"))
    .rows;
  await pool.query(
    "create function private.recipient_init_fault() returns trigger language plpgsql as $$begin raise exception 'fixture fault'; end;$$; create trigger recipient_init_fault before insert on private.practice_reminder_settings for each row execute function private.recipient_init_fault()",
  );
  try {
    expect(
      (
        await person.client.rpc("create_practice", {
          p_name: "Atomic fixture",
          p_timezone: "UTC",
        })
      ).error?.code,
    ).toBe("P0001");
    expect(
      (await pool.query("select count(*) from public.practices")).rows,
    ).toEqual(before);
    for (const table of [
      "public.practice_memberships",
      "private.practice_access_events",
      "private.practice_audit_events",
    ])
      expect(
        (
          await pool.query(
            `select count(*)::int as n from ${table} where ${table === "public.practice_memberships" ? "user_id" : "actor_user_id"}=$1`,
            [person.user.id],
          )
        ).rows[0].n,
      ).toBe(0);
  } finally {
    await pool.query(
      "drop trigger recipient_init_fault on private.practice_reminder_settings; drop function private.recipient_init_fault()",
    );
  }
  const created = await person.client.rpc("create_practice", {
    p_name: "Atomic fixture",
    p_timezone: "UTC",
  });
  expect(created.error).toBeNull();
  expect((await get(person, created.data.id)).data).toMatchObject({
    version: 1,
    selected: null,
  });
  expect(
    (
      await person.client.rpc("create_practice", {
        p_name: "Ignored retry",
        p_timezone: "UTC",
      })
    ).data,
  ).toEqual(created.data);
});
it("R11 R12 private helper/storage denial and composite tenant constraints execute", async () => {
  const a = await practice(),
    b = await practice(),
    admin = await membership(a.practice.id, a.user.id),
    foreign = await membership(b.practice.id, b.user.id),
    db = await pool.connect();
  try {
    for (const sql of [
      "select * from private.practice_reminder_settings",
      "select * from private.practice_recipient_events",
      "select private.require_recipient_member($1,true)",
      "select private.change_reminder_recipient($1,$2,null)",
      "select private.invalidate_reminder_recipient($1,$2,'revoked')",
    ]) {
      await db.query("begin");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        a.user.id,
      ]);
      await db.query("set local role authenticated");
      await expect(
        db.query(
          sql,
          sql.includes("$2")
            ? [a.practice.id, admin.id]
            : sql.includes("$1")
              ? [a.practice.id]
              : [],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await db.query("rollback");
    }
    await db.query("begin");
    await expect(
      db.query(
        "update private.practice_reminder_settings set membership_id=$1 where practice_id=$2",
        [foreign.id, a.practice.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await db.query("rollback");
    for (const [before, after, operation] of [
      [null, foreign.id, "assigned"],
      [foreign.id, null, "cleared"],
    ]) {
      await db.query("begin");
      await expect(
        db.query(
          "insert into private.practice_recipient_events(practice_id,actor_user_id,operation,before_membership_id,after_membership_id,before_version,after_version) values($1,$2,$3,$4,$5,1,2)",
          [a.practice.id, a.user.id, operation, before, after],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await db.query("rollback");
    }
    await db.query("begin");
    await db.query(
      "update private.practice_reminder_settings set membership_id=$1 where practice_id=$2",
      [admin.id, a.practice.id],
    );
    await db.query(
      "update public.practice_memberships set role='viewer' where id=$1",
      [admin.id],
    ); // deliberately invalid privileged repair observed before rollback
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      a.user.id,
    ]);
    const result = (
      await db.query(
        "select private.get_practice_reminder_recipient($1) value",
        [a.practice.id],
      )
    ).rows[0].value;
    expect(result).toMatchObject({
      ready: false,
      readiness: "member-unavailable",
      canEdit: false,
      selected: { role: "viewer" },
    });
    await db.query("rollback");
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("R07 practice lock is acquired before recipient state or actor projection", async () => {
  const a = await practice(),
    m = await staff(a),
    db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select 1 from public.practices where id=$1 for update", [
      a.practice.id,
    ]);
    const late = Promise.resolve(set(m, a.practice.id, m.member.id, 1));
    await blocked("set_practice_reminder_recipient");
    await db.query("commit");
    expect((await late).data).toMatchObject({
      status: "success",
      recipient: { version: 2 },
    });
  } finally {
    await db.query("rollback");
    db.release();
  }
});
