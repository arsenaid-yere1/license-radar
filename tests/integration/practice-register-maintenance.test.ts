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
type Actor = Awaited<ReturnType<typeof account>>;
afterAll(async () => {
  await pool.end();
});
const tables = [
  "public.clinicians",
  "public.credentials",
  "public.credential_cycles",
  "public.policy_coverage",
  "private.register_audit_events",
  "private.register_create_requests",
  "private.register_change_requests",
];
async function snapshot(id: string) {
  const rows: Record<string, unknown[]> = {};
  for (const table of tables)
    rows[table] = (
      await pool.query(
        `select * from ${table} where practice_id=$1 order by ${table.endsWith("coverage") ? "credential_id,clinician_id" : "id"}`,
        [id],
      )
    ).rows;
  return rows;
}
async function create(
  a: Actor,
  id: string,
  patch: Record<string, unknown> = {},
) {
  const r = await a.client.rpc("create_practice_credential_with_details", {
    p_practice_id: id,
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
  });
  expect(r.error).toBeNull();
  expect(r.data.status).toBe("success");
  return r.data.credential;
}
type RecordData = Awaited<ReturnType<typeof create>>;
function tokens(id: string, c: RecordData, key = randomUUID()) {
  return {
    p_practice_id: id,
    p_request_id: key,
    p_credential_id: c.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: c.current_cycle.date_revision,
  };
}
function authored(c: RecordData) {
  return {
    p_title: c.title,
    p_type: c.type,
    p_owner_kind: c.owner_kind,
    p_owner_clinician_id: c.owner_clinician_id,
    p_covered_clinician_ids: c.covered_clinicians.map(
      (p: { id: string }) => p.id,
    ),
    p_issuer: c.issuer,
    p_jurisdiction: c.jurisdiction,
    p_end_date: c.current_cycle.end_date,
    p_action_deadline: c.current_cycle.action_deadline,
  };
}
function update(
  a: Actor,
  id: string,
  c: RecordData,
  patch: Record<string, unknown> = {},
) {
  return a.client.rpc("update_practice_credential", {
    ...tokens(id, c),
    ...authored(c),
    ...patch,
  });
}
async function success(r: Awaited<ReturnType<typeof update>>) {
  expect(r.error).toBeNull();
  expect(r.data.status).toBe("success");
  return r.data.credential;
}
async function list(a: Actor, id: string, archived = false) {
  const r = await a.client.rpc("list_practice_register_with_maintenance", {
    p_practice_id: id,
    p_include_archived: archived,
  });
  expect(r.error).toBeNull();
  return r.data.credentials as RecordData[];
}
async function person(
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
async function blocked() {
  for (let i = 0; i < 200; i++) {
    if (
      (
        await pool.query(
          "select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%change_practice_credential%' or wait_event_type='Lock' and query like '%update_practice_credential%' or wait_event_type='Lock' and query like '%archive_practice_credential%'",
        )
      ).rowCount
    )
      return;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(false, "Expected witnessed maintenance lock").toBe(true);
}
it("M01 M02 corrections of every type owner and dates retain one initial cycle", async () => {
  const a = await practice(),
    c = await person(a);
  for (const type of [
    "state_license",
    "dea_registration",
    "malpractice_policy",
  ])
    for (const owner of ["practice", "clinician"]) {
      const original = await create(a, a.practice.id, {
        p_type: type,
        p_owner_kind: owner,
        p_owner_clinician_id: owner === "clinician" ? c.id : null,
      });
      const r = await success(
        await update(a, a.practice.id, original, {
          p_title: " Corrected ",
          p_issuer: " Board ",
          p_jurisdiction: " NY ",
          p_end_date: "2028-03-01",
        }),
      );
      expect(r).toMatchObject({
        id: original.id,
        title: "Corrected",
        issuer: "Board",
        jurisdiction: "NY",
        version: 2,
        archived_at: null,
        current_cycle: {
          id: original.current_cycle.id,
          cycle_number: 1,
          date_revision: 2,
          end_date: "2028-03-01",
          action_deadline: "2028-02-01",
        },
      });
      const audit = (
        await pool.query(
          "select * from private.register_audit_events where credential_id=$1 and operation='credential-updated'",
          [r.id],
        )
      ).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor_user_id: a.user.id,
        before_data: { ...original, archived_at: null },
        after_data: r,
      });
    }
  const r = await create(a, a.practice.id, {
    p_end_date: null,
    p_action_deadline: null,
  });
  let current = r;
  for (const [end, action] of [
    [null, "9999-12-31"],
    ["0001-01-01", null],
    [null, null],
    ["2028-02-29", "2028-02-01"],
  ]) {
    current = await success(
      await update(a, a.practice.id, current, {
        p_end_date: end,
        p_action_deadline: action,
      }),
    );
    expect(current.current_cycle).toMatchObject({
      id: r.current_cycle.id,
      end_date: end,
      action_deadline: action,
    });
  }
  expect(current.current_cycle.date_revision).toBe(5);
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.credential_cycles where credential_id=$1",
        [r.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("M01 M03 coverage replacement precedes discriminator change and normalized no-op changes no business rows", async () => {
  const a = await practice(),
    c = await person(a),
    d = await person(a, "Chen"),
    original = await create(a, a.practice.id, {
      p_covered_clinician_ids: [c.id, d.id],
    });
  await list(a, a.practice.id);
  const before = await snapshot(a.practice.id),
    noop = await update(a, a.practice.id, original, {
      p_title: " Policy ",
      p_covered_clinician_ids: [d.id, c.id],
    });
  await success(noop);
  expect(noop.data.changed).toBe(false);
  const after = await snapshot(a.practice.id);
  for (const table of tables.filter(
    (t) => t !== "private.register_change_requests",
  ))
    expect(after[table]).toEqual(before[table]);
  expect(after["private.register_change_requests"]).toHaveLength(1);
  const metadata = await success(
    await update(a, a.practice.id, original, { p_title: "Changed" }),
  );
  expect(metadata.version).toBe(2);
  expect(metadata.current_cycle).toEqual(original.current_cycle);
  const cy = (
    await pool.query(
      "select * from public.credential_cycles where credential_id=$1",
      [original.id],
    )
  ).rows;
  expect(cy).toEqual(before["public.credential_cycles"]);
  const changed = await success(
    await update(a, a.practice.id, metadata, {
      p_type: "state_license",
      p_owner_kind: "clinician",
      p_owner_clinician_id: c.id,
      p_covered_clinician_ids: [],
    }),
  );
  expect(changed.covered_clinicians).toEqual([]);
  expect(changed.owner_clinician_id).toBe(c.id);
  const policy = await success(
    await update(a, a.practice.id, changed, {
      p_type: "malpractice_policy",
      p_owner_kind: "practice",
      p_owner_clinician_id: null,
      p_covered_clinician_ids: [d.id],
    }),
  );
  expect(policy.covered_clinicians).toEqual([{ id: d.id, name: d.name }]);
});
it("M04 stale tokens conflict with safe current values and concurrent edits have one winner", async () => {
  const a = await practice(),
    c = await create(a, a.practice.id);
  const results = await Promise.all(
    ["A", "B"].map((p_title) => update(a, a.practice.id, c, { p_title })),
  );
  for (const r of results) expect(r.error).toBeNull();
  expect(results.map((r) => r.data.status).sort()).toEqual([
    "conflict",
    "success",
  ]);
  const current = results.find((r) => r.data.status === "success")!.data
      .credential,
    before = await snapshot(a.practice.id);
  for (const patch of [
    { p_expected_version: 1 },
    { p_expected_date_revision: 2 },
    { p_expected_cycle_id: randomUUID() },
  ]) {
    const r = await update(a, a.practice.id, current, patch);
    expect(r.data).toEqual({ status: "conflict", credential: current });
  }
  expect(await snapshot(a.practice.id)).toEqual(before);
});
it("M05 archive preserves cycle coverage and histories, hides legacy active reads, and prohibits new changes", async () => {
  const a = await practice(),
    c = await person(a),
    original = await create(a, a.practice.id, {
      p_covered_clinician_ids: [c.id],
    });
  const before = await list(a, a.practice.id),
    args = tokens(a.practice.id, original);
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      a.client.rpc("archive_practice_credential", args),
    ),
  );
  for (const r of results) {
    await success(r);
    expect(r.data).toEqual(results[0].data);
  }
  const archived = results[0].data.credential;
  expect(archived.version).toBe(2);
  expect(archived.archived_at).toEqual(expect.any(String));
  expect(archived.current_cycle).toEqual(original.current_cycle);
  expect(archived.covered_clinicians).toEqual(original.covered_clinicians);
  expect(await list(a, a.practice.id)).toEqual([]);
  expect((await list(a, a.practice.id, true))[0]).toEqual({
    ...archived,
    suspected_duplicate_ids: [],
  });
  expect(
    (
      await a.client.rpc("list_practice_register", {
        p_practice_id: a.practice.id,
      })
    ).data.credentials,
  ).toEqual([]);
  const rows = await snapshot(a.practice.id);
  expect(rows["private.register_audit_events"]).toHaveLength(3);
  expect(rows["private.register_change_requests"]).toHaveLength(1);
  expect((await update(a, a.practice.id, archived)).data).toEqual({
    status: "archived",
  });
  expect(
    (
      await a.client.rpc(
        "archive_practice_credential",
        tokens(a.practice.id, archived),
      )
    ).data,
  ).toEqual({ status: "archived" });
  expect(await snapshot(a.practice.id)).toEqual(rows);
  expect(before[0].archived_at).toBeNull();
});
it("M06 caller scoped replay precedes freshness and survives later edit archive and historical creation", async () => {
  const a = await practice(),
    m = await staff(a),
    creationKey = randomUUID();
  const c = await create(a, a.practice.id, { p_request_id: creationKey }),
    key = randomUUID(),
    patch = { p_request_id: key, p_title: "Updated" };
  const results = await Promise.all(
    Array.from({ length: 6 }, () => update(a, a.practice.id, c, patch)),
  );
  for (const r of results) {
    await success(r);
    expect(r.data).toEqual(results[0].data);
  }
  const first = results[0].data,
    current = await success(
      await update(a, a.practice.id, first.credential, { p_title: "Later" }),
    );
  const before = await snapshot(a.practice.id);
  expect((await update(a, a.practice.id, c, patch)).data).toEqual(first);
  for (const change of [
    { p_title: "Different" },
    { p_expected_version: 2 },
    { p_expected_date_revision: 2 },
    { p_expected_cycle_id: randomUUID() },
    { p_credential_id: randomUUID() },
    { p_issuer: "Other" },
    { p_jurisdiction: null },
    { p_end_date: "2028-03-01" },
    { p_action_deadline: null },
    { p_covered_clinician_ids: [], p_type: "dea_registration" },
  ])
    expect(
      (await update(a, a.practice.id, c, { ...patch, ...change })).data,
    ).toEqual({ status: "request-conflict" });
  expect(
    (
      await a.client.rpc(
        "archive_practice_credential",
        tokens(a.practice.id, c, key),
      )
    ).data,
  ).toEqual({ status: "request-conflict" });
  expect((await update(m, a.practice.id, c, patch)).data.status).toBe(
    "conflict",
  );
  expect(await snapshot(a.practice.id)).toEqual(before);
  await success(
    await a.client.rpc(
      "archive_practice_credential",
      tokens(a.practice.id, current),
    ),
  );
  expect((await update(a, a.practice.id, c, patch)).data).toEqual(first);
  const historical = await create(a, a.practice.id, {
    p_request_id: creationKey,
  });
  expect(historical).toEqual(c);
});
it("M07 every mutation write stage fails atomically then exact key retry succeeds", async () => {
  const a = await practice(),
    c = await person(a);
  await list(a, a.practice.id);
  for (const [table, event] of [
    ["public.credentials", "update"],
    ["public.credential_cycles", "update"],
    ["public.policy_coverage", "delete"],
    ["public.policy_coverage", "insert"],
    ["private.register_audit_events", "insert"],
    ["private.register_change_requests", "insert"],
  ]) {
    const original = await create(a, a.practice.id, {
        p_covered_clinician_ids: [c.id],
      }),
      patch = {
        p_request_id: randomUUID(),
        p_title: "Changed",
        p_end_date: "2028-03-01",
      },
      before = await snapshot(a.practice.id);
    await pool.query(
      `create function private.maintenance_fault() returns trigger language plpgsql as $$begin raise exception 'maintenance fixture fault';end$$;create trigger maintenance_fault before ${event} on ${table} for each row execute function private.maintenance_fault()`,
    );
    try {
      const r = await update(a, a.practice.id, original, patch);
      expect(r.error?.code).toBe("P0001");
      expect(await snapshot(a.practice.id)).toEqual(before);
    } finally {
      await pool.query(
        `drop trigger maintenance_fault on ${table};drop function private.maintenance_fault()`,
      );
    }
    await success(await update(a, a.practice.id, original, patch));
  }
  for (const table of [
    "public.credentials",
    "private.register_audit_events",
    "private.register_change_requests",
  ]) {
    const c = await create(a, a.practice.id),
      args = tokens(a.practice.id, c),
      before = await snapshot(a.practice.id);
    await pool.query(
      `create function private.maintenance_fault() returns trigger language plpgsql as $$begin raise exception 'maintenance fixture fault';end$$;create trigger maintenance_fault before ${table.endsWith("credentials") ? "update" : "insert"} on ${table} for each row execute function private.maintenance_fault()`,
    );
    try {
      expect(
        (await a.client.rpc("archive_practice_credential", args)).error?.code,
      ).toBe("P0001");
      expect(await snapshot(a.practice.id)).toEqual(before);
    } finally {
      await pool.query(
        `drop trigger maintenance_fault on ${table};drop function private.maintenance_fault()`,
      );
    }
    await success(await a.client.rpc("archive_practice_credential", args));
  }
});
it("M08 queued valid edits wait, demotion revocation and replay deny after the practice lock", async () => {
  const a = await practice(),
    original = await create(a, a.practice.id);
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select 1 from public.practices where id=$1 for update", [
      a.practice.id,
    ]);
    const pending = Promise.resolve(
      update(a, a.practice.id, original, { p_title: "Valid" }),
    );
    await blocked();
    await db.query("commit");
    await success(await pending);
  } finally {
    await db.query("rollback");
    db.release();
  }
  for (const revoke of [false, true])
    for (const archive of [false, true]) {
      const m = await staff(a),
        c = await create(a, a.practice.id),
        patch = { p_request_id: randomUUID(), p_title: "Manager" };
      const current = await success(await update(m, a.practice.id, c, patch)),
        before = await snapshot(a.practice.id),
        conn = await pool.connect();
      try {
        await conn.query("begin");
        await conn.query("select set_config('request.jwt.claim.sub',$1,true)", [
          a.user.id,
        ]);
        await conn.query("select private.mutate_member($1,1,$2,$3)", [
          m.member.id,
          revoke ? null : "viewer",
          revoke,
        ]);
        const pending = Promise.resolve(
          archive
            ? m.client.rpc(
                "archive_practice_credential",
                tokens(a.practice.id, current),
              )
            : update(m, a.practice.id, current, { p_title: "Denied" }),
        );
        await blocked();
        await conn.query("commit");
        expect((await pending).error?.code).toBe("42501");
        expect((await update(m, a.practice.id, c, patch)).error?.code).toBe(
          "42501",
        );
        expect(await snapshot(a.practice.id)).toEqual(before);
      } finally {
        await conn.query("rollback");
        conn.release();
      }
    }
});
it("M08 M09 M11 tenant roles direct writes helpers and foreign references deny safely", async () => {
  const a = await practice(),
    b = await practice(),
    v = await staff(a, "viewer"),
    c = await create(a, a.practice.id),
    foreign = await person(b),
    anon = { client: anonymous() } as Actor;
  await list(a, a.practice.id);
  const before = await snapshot(a.practice.id);
  for (const who of [b, v, anon])
    for (const patch of [{}, { p_title: "x".repeat(121), p_end_date: "bad" }]) {
      expect((await update(who, a.practice.id, c, patch)).error?.code).toBe(
        "42501",
      );
      expect(
        (
          await who.client.rpc(
            "archive_practice_credential",
            tokens(a.practice.id, c),
          )
        ).error?.code,
      ).toBe("42501");
    }
  expect(
    (
      await update(a, a.practice.id, c, {
        p_owner_kind: "clinician",
        p_owner_clinician_id: foreign.id,
      })
    ).data,
  ).toEqual({ status: "invalid-reference" });
  expect(
    (
      await update(a, a.practice.id, c, {
        p_covered_clinician_ids: [foreign.id],
      })
    ).data,
  ).toEqual({ status: "invalid-reference" });
  for (const id of [(await create(b, b.practice.id)).id, randomUUID()])
    expect(
      (await update(a, a.practice.id, c, { p_credential_id: id })).data,
    ).toEqual({ status: "not-found" });
  for (const who of [a, v]) {
    expect(
      (
        await who.client
          .from("credentials")
          .update({ archived_at: new Date().toISOString() })
          .eq("id", c.id)
      ).error?.code,
    ).toBe("42501");
    expect(
      (await who.client.from("credentials").delete().eq("id", c.id)).error
        ?.code,
    ).toBe("42501");
  }
  for (const sql of [
    "select * from private.register_change_requests",
    "select private.duplicate_text('Policy')",
    "select private.register_change_replay(null,null,null,null)",
    "select private.finish_register_change(null,null,null,null,null,null,null)",
    "select private.apply_credential_change(null,null,null,null,null,null,null)",
    "select private.credential_change_values(null,null,null,null,null,null,null,null,null)",
  ]) {
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        a.user.id,
      ]);
      await db.query("set local role authenticated");
      await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.query("rollback");
      db.release();
    }
  }
  expect(await snapshot(a.practice.id)).toEqual(before);
});
it("M10 duplicate matching is advisory reciprocal sorted active tenant scoped and excludes owner type metadata boundaries", async () => {
  const a = await practice(),
    b = await practice(),
    c = await person(a);
  const first = await create(a, a.practice.id),
    second = await create(a, a.practice.id, {
      p_title: " policy ",
      p_issuer: "INSURER",
      p_jurisdiction: "ca",
      p_end_date: null,
      p_action_deadline: null,
      p_covered_clinician_ids: [c.id],
    });
  for (const patch of [
    { p_title: "Other" },
    { p_type: "state_license" },
    { p_issuer: null },
    { p_jurisdiction: "NY" },
    { p_owner_kind: "clinician", p_owner_clinician_id: c.id },
  ])
    await create(a, a.practice.id, patch);
  await create(b, b.practice.id);
  const rows = await list(a, a.practice.id);
  expect(rows.find((r) => r.id === first.id).suspected_duplicate_ids).toEqual([
    second.id,
  ]);
  expect(rows.find((r) => r.id === second.id).suspected_duplicate_ids).toEqual([
    first.id,
  ]);
  for (const r of rows.filter((r) => ![first.id, second.id].includes(r.id)))
    expect(r.suspected_duplicate_ids).toEqual([]);
  const changed = await success(
    await update(a, a.practice.id, second, { p_title: "Other new" }),
  );
  expect(
    (await list(a, a.practice.id)).find((r) => r.id === first.id)
      .suspected_duplicate_ids,
  ).toEqual([]);
  const matching = await success(
    await update(a, a.practice.id, changed, { p_title: "POLICY" }),
  );
  await success(
    await a.client.rpc(
      "archive_practice_credential",
      tokens(a.practice.id, matching),
    ),
  );
  expect(
    (await list(a, a.practice.id, true)).every(
      (r) => r.suspected_duplicate_ids.length === 0,
    ),
  ).toBe(true);
  const null1 = await create(a, a.practice.id, {
      p_title: "Unknown",
      p_issuer: null,
      p_jurisdiction: null,
    }),
    null2 = await create(a, a.practice.id, {
      p_title: "unknown",
      p_issuer: " ",
      p_jurisdiction: "",
    });
  const null3 = await create(a, a.practice.id, {
    p_title: "UNKNOWN",
    p_issuer: null,
    p_jurisdiction: null,
  });
  expect(
    (await list(a, a.practice.id)).find((r) => r.id === null1.id)
      .suspected_duplicate_ids,
  ).toEqual([null2.id, null3.id].sort());
  const unicode = await create(a, a.practice.id, { p_title: "É" });
  await create(a, a.practice.id, { p_title: "é" });
  expect(
    (await list(a, a.practice.id)).find((r) => r.id === unicode.id)
      .suspected_duplicate_ids,
  ).toEqual([]);
});
it("M11 malformed SQL inputs and all inherited date ownership boundaries reject without writes", async () => {
  const a = await practice(),
    c = await create(a, a.practice.id);
  await list(a, a.practice.id);
  const before = await snapshot(a.practice.id);
  for (const patch of [
    { p_request_id: null },
    { p_credential_id: null },
    { p_expected_version: null },
    { p_expected_version: 0 },
    { p_expected_cycle_id: null },
    { p_expected_date_revision: 0 },
    { p_expected_date_revision: null },
    { p_title: " " },
    { p_type: null },
    { p_type: "other" },
    { p_owner_kind: null },
    { p_owner_kind: "other" },
    { p_owner_kind: "clinician" },
    { p_owner_clinician_id: randomUUID() },
    { p_covered_clinician_ids: [null] },
    { p_covered_clinician_ids: [[randomUUID()]] },
    { p_covered_clinician_ids: [c.id, c.id] },
    { p_type: "state_license", p_covered_clinician_ids: [c.id] },
    { p_issuer: "🩺".repeat(121) },
    { p_jurisdiction: "x".repeat(121) },
    { p_end_date: "1900-02-29" },
    { p_end_date: "2028-02-29\n" },
    { p_action_deadline: "infinity" },
    { p_action_deadline: "2028-02-29" },
  ]) {
    const r = await update(a, a.practice.id, c, patch);
    expect(r.error).toBeNull();
    expect(r.data.status).toBe("invalid");
  }
  expect(
    (
      await a.client.rpc("list_practice_register_with_maintenance", {
        p_practice_id: a.practice.id,
        p_include_archived: null,
      })
    ).data,
  ).toEqual({ status: "invalid" });
  expect(await snapshot(a.practice.id)).toEqual(before);
});
it("M15 missing cycle fails reads and mutations without fabricating dates or history", async () => {
  const a = await practice(),
    c = await create(a, a.practice.id);
  await list(a, a.practice.id);
  const cy = (
    await pool.query("select * from public.credential_cycles where id=$1", [
      c.current_cycle.id,
    ])
  ).rows[0];
  await pool.query("delete from public.credential_cycles where id=$1", [cy.id]);
  try {
    const before = await snapshot(a.practice.id);
    expect(
      (await update(a, a.practice.id, c, { p_title: "Changed" })).error,
    ).not.toBeNull();
    expect(
      (
        await a.client.rpc(
          "archive_practice_credential",
          tokens(a.practice.id, c),
        )
      ).error,
    ).not.toBeNull();
    expect(
      (
        await a.client.rpc("list_practice_register_with_maintenance", {
          p_practice_id: a.practice.id,
          p_include_archived: false,
        })
      ).error,
    ).not.toBeNull();
    expect(await snapshot(a.practice.id)).toEqual(before);
  } finally {
    await pool.query(
      "insert into public.credential_cycles select * from jsonb_populate_record(null::public.credential_cycles,$1::jsonb)",
      [JSON.stringify(cy)],
    );
  }
});
it("M17 integer exhaustion conflicts only for needed increments", async () => {
  const a = await practice(),
    c = await create(a, a.practice.id);
  await list(a, a.practice.id);
  await pool.query(
    "update public.credentials set version=2147483647 where id=$1",
    [c.id],
  );
  const max = { ...c, version: 2147483647 },
    before = await snapshot(a.practice.id);
  expect(
    (await update(a, a.practice.id, max, { p_title: "Different" })).data.status,
  ).toBe("conflict");
  expect(
    (
      await a.client.rpc(
        "archive_practice_credential",
        tokens(a.practice.id, max),
      )
    ).data.status,
  ).toBe("conflict");
  expect(await snapshot(a.practice.id)).toEqual(before);
  const noop = await update(a, a.practice.id, max);
  await success(noop);
  expect(noop.data.changed).toBe(false);
  await pool.query("update public.credentials set version=1 where id=$1", [
    c.id,
  ]);
  await pool.query(
    "update public.credential_cycles set date_revision=2147483647 where credential_id=$1",
    [c.id],
  );
  const maxDate = {
      ...c,
      current_cycle: { ...c.current_cycle, date_revision: 2147483647 },
    },
    rows = await snapshot(a.practice.id);
  expect(
    (await update(a, a.practice.id, maxDate, { p_end_date: "2028-03-01" })).data
      .status,
  ).toBe("conflict");
  expect(await snapshot(a.practice.id)).toEqual(rows);
  const metadata = await success(
    await update(a, a.practice.id, maxDate, { p_title: "Metadata" }),
  );
  expect(metadata.current_cycle.date_revision).toBe(2147483647);
});
