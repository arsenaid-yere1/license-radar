import fc from "fast-check";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import {
  practice,
  account,
  invite,
  membership,
  pool,
} from "../helpers/access-fixtures";
import { anonymous } from "../helpers/local-fixtures";
afterAll(async () => {
  await pool.end();
});
type Actor = Awaited<ReturnType<typeof account>>;
type Practice = Awaited<ReturnType<typeof practice>>;
async function staff(a: Practice, role = "manager") {
  const person = await account(),
    link = await invite(a, person.email, role);
  expect(
    (
      await person.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).error,
  ).toBeNull();
  return { ...person, member: await membership(a.practice.id, person.user.id) };
}
function list(a: Actor, id: string) {
  return a.client.rpc("list_practice_register", { p_practice_id: id });
}
function clinician(
  a: Actor,
  id: string,
  name: unknown = "Dr. Rivera",
  key = randomUUID(),
) {
  return a.client.rpc("create_practice_clinician", {
    p_practice_id: id,
    p_request_id: key,
    p_name: name,
  });
}
function record(a: Actor, id: string, input: Record<string, unknown> = {}) {
  return a.client.rpc("create_practice_credential", {
    p_practice_id: id,
    p_request_id: randomUUID(),
    p_title: "Shared policy",
    p_type: "malpractice_policy",
    p_owner_kind: "practice",
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [],
    ...input,
  });
}
async function person(a: Practice, name = "Dr. Rivera") {
  const r = await clinician(a, a.practice.id, name);
  expect(r.error).toBeNull();
  expect(r.data.status).toBe("success");
  return r.data.clinician;
}
async function snapshot(id: string) {
  const result: Record<string, unknown> = {};
  for (const table of [
    "public.clinicians",
    "public.credentials",
    "public.credential_cycles",
    "public.policy_coverage",
    "private.register_audit_events",
    "private.register_create_requests",
  ])
    result[table] = (
      await pool.query(
        `select * from ${table} where practice_id=$1 order by ${table.endsWith("policy_coverage") ? "credential_id,clinician_id" : "id"}`,
        [id],
      )
    ).rows;
  return result;
}
async function blocked(name: string) {
  for (let i = 0; i < 200; i++) {
    if (
      (
        await pool.query(
          "select 1 from pg_stat_activity where wait_event_type='Lock' and query like $1",
          [`%${name}%`],
        )
      ).rowCount
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(false, "Expected witnessed register lock wait").toBe(true);
}
it("G01 empty register is real", async () => {
  const a = await practice();
  const r = await list(a, a.practice.id);
  expect(r.error).toBeNull();
  expect(r.data).toEqual({ clinicians: [], credentials: [] });
});
it("G02 clinician is not a staff account", async () => {
  const a = await practice(),
    m = await staff(a);
  const before = (
    await pool.query(
      "select (select count(*) from public.practice_memberships) members,(select count(*) from private.practice_invitations) invitations,(select jsonb_agg(s order by practice_id) from private.practice_reminder_settings s) settings",
    )
  ).rows;
  const r = await clinician(m, a.practice.id, "  Dr. Rivera  ");
  expect(r.error).toBeNull();
  expect(r.data).toEqual({
    status: "success",
    clinician: { id: expect.any(String), name: "Dr. Rivera", version: 1 },
  });
  expect((await list(m, a.practice.id)).data.clinicians).toEqual([
    r.data.clinician,
  ]);
  expect(
    (
      await pool.query(
        "select (select count(*) from public.practice_memberships) members,(select count(*) from private.practice_invitations) invitations,(select jsonb_agg(s order by practice_id) from private.practice_reminder_settings s) settings",
      )
    ).rows,
  ).toEqual(before);
});
it("G03 G04 all types and owners and multiple records per clinician", async () => {
  const a = await practice(),
    c = await person(a);
  for (const type of [
    "state_license",
    "dea_registration",
    "malpractice_policy",
  ])
    for (const owner of ["practice", "clinician"])
      expect(
        (
          await record(a, a.practice.id, {
            p_type: type,
            p_owner_kind: owner,
            p_owner_clinician_id: owner === "clinician" ? c.id : null,
          })
        ).data,
      ).toMatchObject({
        status: "success",
        credential: {
          type,
          owner_kind: owner,
          owner_clinician_id: owner === "clinician" ? c.id : null,
          owner_name: owner === "clinician" ? c.name : a.practice.name,
          covered_clinicians: [],
          version: 1,
        },
      });
  expect(
    (
      await record(a, a.practice.id, {
        p_type: "state_license",
        p_owner_kind: "clinician",
        p_owner_clinician_id: c.id,
      })
    ).data.status,
  ).toBe("success");
  const result = (await list(a, a.practice.id)).data;
  expect(result.credentials).toHaveLength(7);
  expect(
    new Set(result.credentials.map((r: { id: string }) => r.id)).size,
  ).toBe(7);
});
it("G05 G06 shared policy identity zero coverage and unsupported coverage", async () => {
  const a = await practice(),
    c = await person(a),
    d = await person(a, "Dr. Chen");
  const r = await record(a, a.practice.id, {
    p_covered_clinician_ids: [d.id, c.id],
  });
  expect(r.error).toBeNull();
  expect(r.data.credential.covered_clinicians).toEqual(
    [c, d]
      .map((x) => ({ id: x.id, name: x.name }))
      .sort((x, y) => x.id.localeCompare(y.id)),
  );
  const listed = (await list(a, a.practice.id)).data.credentials;
  expect(listed).toEqual([
    {
      ...r.data.credential,
      issuer: null,
      jurisdiction: null,
      current_cycle: {
        id: expect.any(String),
        cycle_number: 1,
        date_revision: 1,
        end_date: null,
        action_deadline: null,
      },
    },
  ]);
  expect(
    (await snapshot(a.practice.id))["public.credential_cycles"],
  ).toHaveLength(1);
  expect(
    (await record(a, a.practice.id)).data.credential.covered_clinicians,
  ).toEqual([]);
  const before = await snapshot(a.practice.id);
  for (const input of [
    { p_type: "state_license" },
    { p_type: "dea_registration" },
    { p_owner_kind: "clinician", p_owner_clinician_id: c.id },
  ])
    expect(
      (
        await record(a, a.practice.id, {
          ...input,
          p_covered_clinician_ids: [c.id],
        })
      ).data,
    ).toEqual({ status: "invalid" });
  expect(await snapshot(a.practice.id)).toEqual(before);
});
it("G07 G08 foreign missing duplicate and NULL links cannot create partial records", async () => {
  const a = await practice(),
    b = await practice(),
    c = await person(a),
    f = await person(b),
    before = await snapshot(a.practice.id);
  for (const id of [f.id, randomUUID()])
    for (const input of [
      { p_owner_kind: "clinician", p_owner_clinician_id: id },
      { p_covered_clinician_ids: [c.id, id] },
    ])
      expect((await record(a, a.practice.id, input)).data).toEqual({
        status: "invalid-reference",
      });
  for (const ids of [
    [c.id, c.id],
    [c.id, c.id.toUpperCase()],
    [null],
    [[c.id]],
  ])
    expect(
      (await record(a, a.practice.id, { p_covered_clinician_ids: ids })).data,
    ).toEqual({ status: "invalid" });
  expect(await snapshot(a.practice.id)).toEqual(before);
});
it("G09 scalar limits and normalization at the real SQL API", async () => {
  const a = await practice();
  for (const name of [
    null,
    "",
    " \t\n\u00a0\ufeff ",
    "a".repeat(121),
    "😀".repeat(121),
  ]) {
    expect((await clinician(a, a.practice.id, name)).data).toEqual({
      status: "invalid",
    });
    expect((await record(a, a.practice.id, { p_title: name })).data).toEqual({
      status: "invalid",
    });
  }
  for (const name of ["x", "😀".repeat(120), " \t\u00a0Dr. Rivera\ufeff\n"])
    expect((await clinician(a, a.practice.id, name)).data.clinician.name).toBe(
      name.trim(),
    );
  for (const input of [
    { p_type: null },
    { p_type: "lab" },
    { p_owner_kind: null },
    { p_owner_kind: "staff" },
    { p_request_id: null },
    { p_owner_kind: "clinician", p_owner_clinician_id: null },
    { p_owner_clinician_id: randomUUID() },
  ])
    expect((await record(a, a.practice.id, input)).data).toEqual({
      status: "invalid",
    });
  expect(
    (await clinician(a, a.practice.id, "valid", null as never)).data,
  ).toEqual({ status: "invalid" });
});
it("G10 G11 immutable same-key retry and changed requests conflict", async () => {
  const a = await practice(),
    key = randomUUID();
  const r = await clinician(a, a.practice.id, "  Dr. Rivera ", key);
  expect(r.error).toBeNull();
  expect(r.data.status).toBe("success");
  const before = await snapshot(a.practice.id);
  expect((await clinician(a, a.practice.id, "Dr. Rivera", key)).data).toEqual(
    r.data,
  );
  expect((await clinician(a, a.practice.id, "Other", key)).data).toEqual({
    status: "request-conflict",
  });
  expect((await record(a, a.practice.id, { p_request_id: key })).data).toEqual({
    status: "request-conflict",
  });
  expect(await snapshot(a.practice.id)).toEqual(before);
  const k = randomUUID(),
    original = await record(a, a.practice.id, { p_request_id: k });
  const after = await snapshot(a.practice.id);
  expect((await record(a, a.practice.id, { p_request_id: k })).data).toEqual(
    original.data,
  );
  for (const input of [
    { p_title: "Changed" },
    { p_type: "state_license" },
    { p_owner_kind: "clinician", p_owner_clinician_id: r.data.clinician.id },
    { p_covered_clinician_ids: [r.data.clinician.id] },
  ])
    expect(
      (await record(a, a.practice.id, { p_request_id: k, ...input })).data,
    ).toEqual({ status: "request-conflict" });
  expect(await snapshot(a.practice.id)).toEqual(after);
  const event = (
    await pool.query(
      "select * from private.register_audit_events where practice_id=$1 order by occurred_at",
      [a.practice.id],
    )
  ).rows;
  expect(
    event.map((x) => [
      x.actor_user_id,
      x.operation,
      x.before_data,
      x.after_data,
    ]),
  ).toEqual([
    [a.user.id, "clinician-created", null, r.data.clinician],
    [a.user.id, "credential-created", null, original.data.credential],
  ]);
  expect(event.every((x) => x.occurred_at instanceof Date)).toBe(true);
});
it("G12 concurrent retry and reordered coverage commit once", async () => {
  const a = await practice(),
    c = await person(a),
    d = await person(a, "Dr. Chen"),
    key = randomUUID();
  const replies = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      record(a, a.practice.id, {
        p_request_id: key,
        p_covered_clinician_ids: i % 2 ? [c.id, d.id] : [d.id, c.id],
      }),
    ),
  );
  expect(replies.every((r) => r.error === null)).toBe(true);
  expect(
    replies.every(
      (r) => JSON.stringify(r.data) === JSON.stringify(replies[0].data),
    ),
  ).toBe(true);
  const s = await snapshot(a.practice.id);
  expect(s["public.credentials"]).toHaveLength(1);
  expect(s["public.policy_coverage"]).toHaveLength(2);
  expect(s["private.register_audit_events"]).toHaveLength(3);
  expect(s["private.register_create_requests"]).toHaveLength(3);
});
it("G13 atomic creation failures roll back entity coverage audit and receipt", async () => {
  const a = await practice(),
    c = await person(a);
  for (const table of [
    "public.clinicians",
    "public.credentials",
    "public.credential_cycles",
    "public.policy_coverage",
    "private.register_audit_events",
    "private.register_create_requests",
  ]) {
    const key = randomUUID(),
      before = await snapshot(a.practice.id);
    await pool.query(
      `create function private.register_fault() returns trigger language plpgsql as $$begin raise exception 'fixture fault'; end$$; create trigger register_fault before insert on ${table} for each row execute function private.register_fault()`,
    );
    try {
      const r =
        table === "public.clinicians"
          ? await clinician(a, a.practice.id, "Fail", key)
          : await record(a, a.practice.id, {
              p_request_id: key,
              p_covered_clinician_ids: [c.id],
            });
      expect(r.error?.code).toBe("P0001");
      expect(await snapshot(a.practice.id)).toEqual(before);
    } finally {
      await pool.query(
        `drop trigger register_fault on ${table}; drop function private.register_fault()`,
      );
    }
    expect(
      (table === "public.clinicians"
        ? await clinician(a, a.practice.id, "Fail", key)
        : await record(a, a.practice.id, {
            p_request_id: key,
            p_covered_clinician_ids: [c.id],
          })
      ).data.status,
    ).toBe("success");
  }
});
it("G14 authority after queued demotion and receipt replay", async () => {
  for (const role of ["viewer", null]) {
    const a = await practice(),
      m = await staff(a),
      key = randomUUID(),
      first = await clinician(m, a.practice.id, "First", key),
      db = await pool.connect();
    expect(first.data.status).toBe("success");
    try {
      await db.query("begin");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        a.user.id,
      ]);
      await db.query("select private.mutate_member($1,1,$2,$3)", [
        m.member.id,
        role,
        role === null,
      ]);
      const late = Promise.resolve(clinician(m, a.practice.id, "Late"));
      await blocked("create_practice_clinician");
      await db.query("commit");
      expect((await late).error?.code).toBe("42501");
      expect(
        (await clinician(m, a.practice.id, "First", key)).error?.code,
      ).toBe("42501");
      expect((await list(a, a.practice.id)).data.clinicians).toHaveLength(1);
      if (role === null) {
        expect((await list(m, a.practice.id)).error?.code).toBe("42501");
        expect((await m.client.from("clinicians").select("*")).data).toEqual(
          [],
        );
      }
    } finally {
      await db.query("rollback");
      db.release();
    }
  }
});
it("G15 independent read and create lock witnesses precede valid completion", async () => {
  const a = await practice(),
    db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select 1 from public.practices where id=$1 for update", [
      a.practice.id,
    ]);
    const lateRead = Promise.resolve(list(a, a.practice.id));
    await blocked("list_practice_register");
    const late = Promise.resolve(clinician(a, a.practice.id));
    await blocked("create_practice_clinician");
    expect(
      (
        await pool.query(
          "select count(*)::int n from public.clinicians where practice_id=$1",
          [a.practice.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await db.query("commit");
    expect((await late).data.status).toBe("success");
    expect((await lateRead).data).toEqual({ clinicians: [], credentials: [] });
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("A01 table RPC isolation private storage and direct DML denial", async () => {
  const a = await practice(),
    b = await practice(),
    v = await staff(a, "viewer"),
    c = await person(a),
    r = await record(a, a.practice.id, { p_covered_clinician_ids: [c.id] }),
    anon = anonymous();
  expect(r.data.status).toBe("success");
  expect((await list(v, a.practice.id)).data).toEqual(
    (await list(a, a.practice.id)).data,
  );
  for (const actor of [b, v])
    expect((await clinician(actor, a.practice.id)).error?.code).toBe("42501");
  expect((await list(b, a.practice.id)).error?.code).toBe("42501");
  for (const table of ["clinicians", "credentials", "policy_coverage"]) {
    expect(
      (await b.client.from(table).select("*").eq("practice_id", a.practice.id))
        .data,
    ).toEqual([]);
    expect((await anon.from(table).select("*")).error?.code).toBe("42501");
    expect(
      (await a.client.from(table).insert({ practice_id: a.practice.id })).error
        ?.code,
    ).toBe("42501");
    expect(
      (
        await a.client
          .from(table)
          .update({ practice_id: b.practice.id })
          .eq("practice_id", a.practice.id)
      ).error?.code,
    ).toBe("42501");
    expect(
      (await a.client.from(table).delete().eq("practice_id", a.practice.id))
        .error?.code,
    ).toBe("42501");
  }
  for (const rpc of ["list_practice_register", "create_practice_clinician"])
    expect(
      (
        await anon.rpc(
          rpc,
          rpc.startsWith("list")
            ? { p_practice_id: a.practice.id }
            : {
                p_practice_id: a.practice.id,
                p_request_id: randomUUID(),
                p_name: "Denied",
              },
        )
      ).error?.code,
    ).toBe("42501");
  const db = await pool.connect();
  try {
    for (const sql of [
      "select * from private.register_audit_events",
      "select * from private.register_create_requests",
      "select private.require_register_member(null,true)",
      "select private.register_name('name')",
    ]) {
      await db.query("begin");
      await db.query("set local role authenticated");
      await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
      await db.query("rollback");
    }
    const f = await person(b);
    for (const sql of [
      `insert into public.credentials(practice_id,title,type,owner_kind,owner_clinician_id) values('${a.practice.id}','bad','state_license','clinician','${f.id}')`,
      `insert into public.policy_coverage(practice_id,credential_id,clinician_id) values('${a.practice.id}','${r.data.credential.id}','${f.id}')`,
    ]) {
      await db.query("begin");
      await expect(db.query(sql)).rejects.toMatchObject({ code: "23503" });
      await db.query("rollback");
    }
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("P03 real create sequences preserve key actor and tenant invariants", async () => {
  const a = await practice(),
    m = await staff(a),
    other = await practice();
  const sequences = fc.sample(
    fc.tuple(
      fc.boolean(),
      fc.string({
        unit: fc.constantFrom("a", "b", "🩺"),
        minLength: 1,
        maxLength: 16,
      }),
    ),
    { seed: 20261006, numRuns: 20 },
  );
  for (const [i, [useAdministrator, suffix]] of sequences.entries()) {
    const key = randomUUID(),
      actor = useAdministrator ? a : m,
      name = `Sequence ${i} ${suffix}`,
      r = await clinician(actor, a.practice.id, name, key);
    expect(r.data.status).toBe("success");
    const before = await snapshot(a.practice.id);
    expect((await clinician(actor, a.practice.id, name, key)).data).toEqual(
      r.data,
    );
    expect(
      (await clinician(actor, a.practice.id, name + " changed", key)).data,
    ).toEqual({ status: "request-conflict" });
    expect((await clinician(other, a.practice.id, name, key)).error?.code).toBe(
      "42501",
    );
    expect(await snapshot(a.practice.id)).toEqual(before);
  }
  expect((await list(a, a.practice.id)).data.clinicians).toHaveLength(20);
});

it("G10 caller-scoped request cannot retrieve another actor's creation", async () => {
  const a = await practice(),
    m = await staff(a),
    key = randomUUID();
  const first = await clinician(a, a.practice.id, "Rivera", key);
  const second = await clinician(m, a.practice.id, "Rivera", key);
  expect(first.data.status).toBe("success");
  expect(second.data.status).toBe("success");
  expect(second.data.clinician.id).not.toBe(first.data.clinician.id);
  expect((await clinician(m, a.practice.id, "Rivera", key)).data).toEqual(
    second.data,
  );
  const rows = await snapshot(a.practice.id);
  expect(rows["public.clinicians"]).toHaveLength(2);
  expect(rows["private.register_audit_events"]).toHaveLength(2);
  expect(rows["private.register_create_requests"]).toHaveLength(2);
});
