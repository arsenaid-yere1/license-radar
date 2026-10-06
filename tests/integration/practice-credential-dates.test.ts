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
const tables = [
  "public.clinicians",
  "public.credentials",
  "public.credential_cycles",
  "public.policy_coverage",
  "private.register_audit_events",
  "private.register_create_requests",
];
function create(a: Actor, id: string, patch: Record<string, unknown> = {}) {
  return a.client.rpc("create_practice_credential_with_details", {
    p_practice_id: id,
    p_request_id: randomUUID(),
    p_title: "Policy",
    p_type: "malpractice_policy",
    p_owner_kind: "practice",
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [],
    p_issuer: " Insurer ",
    p_jurisdiction: " California ",
    p_end_date: "2028-02-29",
    p_action_deadline: "2028-02-01",
    ...patch,
  });
}
async function saved(
  a: Actor,
  id: string,
  patch: Record<string, unknown> = {},
) {
  const r = await create(a, id, patch);
  expect(r.error).toBeNull();
  expect(r.data.status).toBe("success");
  return r.data.credential;
}
async function snapshot(id: string) {
  const result: Record<string, unknown[]> = {};
  for (const table of tables)
    result[table] = (
      await pool.query(
        `select * from ${table} where practice_id=$1 order by ${table.endsWith("policy_coverage") ? "credential_id,clinician_id" : "id"}`,
        [id],
      )
    ).rows;
  return result;
}
async function clinician(
  a: Awaited<ReturnType<typeof practice>>,
  name = "Rivera",
) {
  const r = await a.client.rpc("create_practice_clinician", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_name: name,
  });
  expect(r.error).toBeNull();
  return r.data.clinician;
}
async function staff(
  a: Awaited<ReturnType<typeof practice>>,
  role = "manager",
) {
  const m = await account(),
    link = await invite(a, m.email, role);
  expect(
    (
      await m.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).error,
  ).toBeNull();
  return { ...m, member: await membership(a.practice.id, m.user.id) };
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
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(false, "Expected witnessed date RPC lock").toBe(true);
}
it("D01 D02 all types and owners save explicit or unknown initial dates", async () => {
  const a = await practice(),
    c = await clinician(a);
  for (const type of [
    "state_license",
    "dea_registration",
    "malpractice_policy",
  ])
    for (const owner of ["practice", "clinician"]) {
      const r = await saved(a, a.practice.id, {
        p_type: type,
        p_owner_kind: owner,
        p_owner_clinician_id: owner === "clinician" ? c.id : null,
      });
      expect(r).toMatchObject({
        type,
        owner_kind: owner,
        issuer: "Insurer",
        jurisdiction: "California",
        current_cycle: {
          cycle_number: 1,
          date_revision: 1,
          end_date: "2028-02-29",
          action_deadline: "2028-02-01",
        },
      });
      expect(
        (
          await pool.query(
            "select after_data from private.register_audit_events where credential_id=$1",
            [r.id],
          )
        ).rows,
      ).toEqual([{ after_data: r }]);
    }
  for (const [end, action] of [
    [null, null],
    ["", ""],
    ["0001-01-01", null],
    [null, "9999-12-31"],
  ]) {
    const r = await saved(a, a.practice.id, {
      p_end_date: end,
      p_action_deadline: action,
      p_issuer: " \t\ufeff",
      p_jurisdiction: null,
    });
    expect(r.issuer).toBeNull();
    expect(r.jurisdiction).toBeNull();
    expect(r.current_cycle).toMatchObject({
      end_date: end || null,
      action_deadline: action || null,
    });
  }
  const rows = await snapshot(a.practice.id);
  expect(rows["public.credentials"]).toHaveLength(10);
  expect(rows["public.credential_cycles"]).toHaveLength(10);
});
it("D03 D04 strict Gregorian dates and earlier ordering reject without writes", async () => {
  const a = await practice();
  await saved(a, a.practice.id);
  for (const value of ["2000-02-29", "0001-01-01", "9999-12-31", "2026-10-06"])
    expect(
      (
        await saved(a, a.practice.id, {
          p_end_date: value,
          p_action_deadline: null,
        })
      ).current_cycle.end_date,
    ).toBe(value);
  const before = await snapshot(a.practice.id);
  for (const value of [
    "1900-02-29",
    "2100-02-29",
    "2026-04-31",
    "0000-01-01",
    "10000-01-01",
    "2026-01-00",
    "2026-00-01",
    "2026-13-01",
    "2026-1-01",
    " 2026-01-01",
    "2026-01-01 ",
    "2026-01-01T00:00:00Z",
    "12/02/2026",
    "infinity",
    "-infinity",
    "0001-01-01 BC",
    "\n",
    "2026-01-01\n",
  ])
    for (const field of ["p_end_date", "p_action_deadline"]) {
      const r = await create(a, a.practice.id, {
        p_end_date: null,
        p_action_deadline: null,
        [field]: value,
      });
      expect(r.error).toBeNull();
      expect(r.data).toEqual({
        status: "invalid",
        errors: {
          [field === "p_end_date" ? "endDate" : "actionDeadline"]:
            "Enter a valid date (YYYY-MM-DD).",
        },
      });
    }
  for (const value of ["2028-02-29", "2028-03-01"]) {
    const r = await create(a, a.practice.id, { p_action_deadline: value });
    expect(r.data).toEqual({
      status: "invalid",
      errors: {
        actionDeadline:
          "The action deadline must be earlier than the end date.",
      },
    });
  }
  expect(await snapshot(a.practice.id)).toEqual(before);
});
it("D05 metadata bounds and complete ownership checks persist no invalid data", async () => {
  const a = await practice(),
    b = await practice(),
    c = await clinician(a),
    foreign = await clinician(b);
  await saved(a, a.practice.id, {
    p_issuer: "🩺".repeat(120),
    p_jurisdiction: "\u2000NY\u202f",
  });
  const before = await snapshot(a.practice.id);
  for (const field of ["p_issuer", "p_jurisdiction"]) {
    const r = await create(a, a.practice.id, { [field]: "🩺".repeat(121) });
    expect(r.error).toBeNull();
    expect(r.data.status).toBe("invalid");
  }
  for (const patch of [
    { p_type: null },
    { p_type: "lab" },
    { p_owner_kind: null },
    { p_owner_kind: "staff" },
    { p_owner_kind: "clinician" },
    { p_owner_clinician_id: c.id },
    { p_request_id: null },
    { p_title: " " },
    { p_covered_clinician_ids: [c.id, c.id] },
    { p_covered_clinician_ids: [c.id, c.id.toUpperCase()] },
    { p_covered_clinician_ids: [null] },
    { p_covered_clinician_ids: [[c.id]] },
    { p_type: "state_license", p_covered_clinician_ids: [c.id] },
    {
      p_owner_kind: "clinician",
      p_owner_clinician_id: c.id,
      p_covered_clinician_ids: [c.id],
    },
  ])
    expect((await create(a, a.practice.id, patch)).data.status).toBe("invalid");
  for (const id of [foreign.id, randomUUID()])
    for (const patch of [
      { p_owner_kind: "clinician", p_owner_clinician_id: id },
      { p_covered_clinician_ids: [c.id, id] },
    ])
      expect((await create(a, a.practice.id, patch)).data).toEqual({
        status: "invalid-reference",
      });
  expect(await snapshot(a.practice.id)).toEqual(before);
});
it("D06 shared policy concurrent retry canonical payload and caller scope", async () => {
  const a = await practice(),
    c = await clinician(a),
    d = await clinician(a, "Chen"),
    key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      create(a, a.practice.id, {
        p_request_id: key,
        p_covered_clinician_ids: i % 2 ? [c.id, d.id] : [d.id, c.id],
      }),
    ),
  );
  for (const r of results) {
    expect(r.error).toBeNull();
    expect(r.data).toEqual(results[0].data);
  }
  expect(results[0].data.status).toBe("success");
  const before = await snapshot(a.practice.id);
  expect(before["public.credentials"]).toHaveLength(1);
  expect(before["public.credential_cycles"]).toHaveLength(1);
  expect(before["public.policy_coverage"]).toHaveLength(2);
  for (const patch of [
    { p_issuer: "Other" },
    { p_jurisdiction: "NY" },
    { p_end_date: "2028-03-01" },
    { p_action_deadline: "2028-01-01" },
    { p_title: "Other" },
    { p_type: "state_license", p_covered_clinician_ids: [] },
    {
      p_owner_kind: "clinician",
      p_owner_clinician_id: c.id,
      p_covered_clinician_ids: [],
    },
    { p_covered_clinician_ids: [] },
  ])
    expect(
      (
        await create(a, a.practice.id, {
          p_request_id: key,
          p_covered_clinician_ids: [c.id, d.id],
          ...patch,
        })
      ).data,
    ).toEqual({ status: "request-conflict" });
  expect(await snapshot(a.practice.id)).toEqual(before);
  const m = await staff(a),
    second = await saved(m, a.practice.id, {
      p_request_id: key,
      p_covered_clinician_ids: [c.id, d.id],
    });
  expect(second.id).not.toBe(results[0].data.credential.id);
});
it("D07 every detailed creation write failure rolls back then exact-key retry succeeds", async () => {
  const a = await practice(),
    c = await clinician(a);
  await saved(a, a.practice.id);
  for (const [table, event] of [
    ["public.credentials", "insert"],
    ["public.credential_cycles", "insert"],
    ["public.credential_cycles", "update"],
    ["public.policy_coverage", "insert"],
    ["private.register_audit_events", "insert"],
    ["private.register_create_requests", "insert"],
  ]) {
    const key = randomUUID(),
      before = await snapshot(a.practice.id);
    await pool.query(
      `create function private.date_fault() returns trigger language plpgsql as $$begin raise exception 'date fixture fault'; end$$; create trigger date_fault before ${event} on ${table} for each row execute function private.date_fault()`,
    );
    try {
      const r = await create(a, a.practice.id, {
        p_request_id: key,
        p_covered_clinician_ids: [c.id],
      });
      expect(r.error?.code).toBe("P0001");
      expect(await snapshot(a.practice.id)).toEqual(before);
    } finally {
      await pool.query(
        `drop trigger date_fault on ${table}; drop function private.date_fault()`,
      );
    }
    expect(
      (
        await saved(a, a.practice.id, {
          p_request_id: key,
          p_covered_clinician_ids: [c.id],
        })
      ).current_cycle.end_date,
    ).toBe("2028-02-29");
  }
});
it("D08 valid detailed request waits and stale demotion or revocation loses authority", async () => {
  const a = await practice();
  await saved(a, a.practice.id);
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select 1 from public.practices where id=$1 for update", [
      a.practice.id,
    ]);
    const read = Promise.resolve(
      a.client.rpc("list_practice_register", { p_practice_id: a.practice.id }),
    );
    await blocked("list_practice_register");
    const pending = Promise.resolve(create(a, a.practice.id));
    await blocked("create_practice_credential_with_details");
    await db.query("commit");
    expect((await pending).data.status).toBe("success");
    expect((await read).error).toBeNull();
  } finally {
    await db.query("rollback");
    db.release();
  }
  for (const role of ["viewer", null]) {
    const m = await staff(a),
      key = randomUUID();
    await saved(m, a.practice.id, { p_request_id: key });
    const before = await snapshot(a.practice.id),
      conn = await pool.connect();
    try {
      await conn.query("begin");
      await conn.query("select set_config('request.jwt.claim.sub',$1,true)", [
        a.user.id,
      ]);
      await conn.query("select private.mutate_member($1,1,$2,$3)", [
        m.member.id,
        role,
        role === null,
      ]);
      const pending = Promise.resolve(create(m, a.practice.id));
      await blocked("create_practice_credential_with_details");
      await conn.query("commit");
      expect((await pending).error?.code).toBe("42501");
      expect(
        (await create(m, a.practice.id, { p_request_id: key })).error?.code,
      ).toBe("42501");
      expect(await snapshot(a.practice.id)).toEqual(before);
      if (role === null)
        expect(
          (await m.client.from("credential_cycles").select("*")).data,
        ).toEqual([]);
    } finally {
      await conn.query("rollback");
      conn.release();
    }
  }
});
it("D09 legacy create and replay remain exact while list adds unknown cycle", async () => {
  const a = await practice(),
    key = randomUUID();
  await saved(a, a.practice.id);
  const args = {
    p_practice_id: a.practice.id,
    p_request_id: key,
    p_title: "Legacy",
    p_type: "state_license",
    p_owner_kind: "practice",
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [],
  };
  const r = await a.client.rpc("create_practice_credential", args);
  expect(r.error).toBeNull();
  expect(Object.keys(r.data.credential).sort()).toEqual(
    [
      "id",
      "title",
      "type",
      "owner_kind",
      "owner_clinician_id",
      "owner_name",
      "version",
      "covered_clinicians",
    ].sort(),
  );
  const before = await snapshot(a.practice.id);
  expect((await a.client.rpc("create_practice_credential", args)).data).toEqual(
    r.data,
  );
  expect(
    (
      await create(a, a.practice.id, {
        ...args,
        p_issuer: null,
        p_jurisdiction: null,
        p_end_date: null,
        p_action_deadline: null,
      })
    ).data,
  ).toEqual({ status: "request-conflict" });
  expect(await snapshot(a.practice.id)).toEqual(before);
  const list = await a.client.rpc("list_practice_register", {
    p_practice_id: a.practice.id,
  });
  expect(
    list.data.credentials.find(
      (c: { id: string }) => c.id === r.data.credential.id,
    ),
  ).toMatchObject({
    ...r.data.credential,
    issuer: null,
    jurisdiction: null,
    current_cycle: {
      end_date: null,
      action_deadline: null,
      cycle_number: 1,
      date_revision: 1,
    },
  });
});
it("A01 D10 cycles and detailed RPC enforce tenant role and private grants", async () => {
  const a = await practice(),
    b = await practice(),
    v = await staff(a, "viewer"),
    r = await saved(a, a.practice.id),
    anon = anonymous();
  expect(
    (await v.client.from("credential_cycles").select("*")).data,
  ).toHaveLength(1);
  expect((await b.client.from("credential_cycles").select("*")).data).toEqual(
    [],
  );
  expect((await anon.from("credential_cycles").select("*")).error?.code).toBe(
    "42501",
  );
  for (const actor of [b, v, { client: anon } as Actor]) {
    expect((await create(actor, a.practice.id)).error?.code).toBe("42501");
    expect(
      (
        await create(actor, a.practice.id, {
          p_issuer: "x".repeat(121),
          p_end_date: "bad",
        })
      ).error?.code,
    ).toBe("42501");
  }
  for (const actor of [a, v]) {
    expect(
      (
        await actor.client
          .from("credential_cycles")
          .insert({ practice_id: a.practice.id, credential_id: r.id })
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await actor.client
          .from("credential_cycles")
          .update({ end_date: "2030-01-01" })
          .eq("id", r.current_cycle.id)
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await actor.client
          .from("credential_cycles")
          .delete()
          .eq("id", r.current_cycle.id)
      ).error?.code,
    ).toBe("42501");
  }
  const db = await pool.connect();
  try {
    for (const sql of [
      "select private.credential_date('2026-01-01')",
      "select private.initialize_credential_cycle()",
    ]) {
      await db.query("begin");
      await db.query("set local role authenticated");
      await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
      await db.query("rollback");
    }
    for (const [sql, args, code] of [
      [
        "insert into public.credential_cycles(practice_id,credential_id) values($1,$2)",
        [b.practice.id, r.id],
        "23503",
      ],
      [
        "insert into public.credential_cycles(practice_id,credential_id) values($1,$2)",
        [a.practice.id, r.id],
        "23505",
      ],
      [
        "update public.credential_cycles set date_revision=0 where id=$1",
        [r.current_cycle.id],
        "23514",
      ],
      [
        "update public.credential_cycles set cycle_number=0 where id=$1",
        [r.current_cycle.id],
        "23514",
      ],
      [
        "update public.credential_cycles set end_date='infinity' where id=$1",
        [r.current_cycle.id],
        "23514",
      ],
      [
        "update public.credential_cycles set end_date='10000-01-01' where id=$1",
        [r.current_cycle.id],
        "23514",
      ],
      [
        "update public.credential_cycles set action_deadline=end_date where id=$1",
        [r.current_cycle.id],
        "23514",
      ],
      ["update public.credentials set issuer=' ' where id=$1", [r.id], "23514"],
    ] as const) {
      await db.query("begin");
      await expect(db.query(sql, [...args])).rejects.toMatchObject({ code });
      await db.query("rollback");
    }
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("D15 missing cycle is a read failure rather than fabricated unknown dates", async () => {
  const a = await practice(),
    r = await saved(a, a.practice.id);
  await pool.query("delete from public.credential_cycles where id=$1", [
    r.current_cycle.id,
  ]);
  try {
    expect(
      (
        await a.client.rpc("list_practice_register", {
          p_practice_id: a.practice.id,
        })
      ).error,
    ).not.toBeNull();
  } finally {
    await pool.query(
      "insert into public.credential_cycles(id,practice_id,credential_id,end_date,action_deadline) values($1,$2,$3,$4,$5)",
      [r.current_cycle.id, a.practice.id, r.id, "2028-02-29", "2028-02-01"],
    );
  }
});
