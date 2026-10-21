import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import {
  account,
  invite,
  membership,
  pool,
  practice,
} from "../helpers/access-fixtures";
import { anonymous } from "../helpers/local-fixtures";
type Actor = Awaited<ReturnType<typeof account>>;
type PracticeActor = Awaited<ReturnType<typeof practice>>;
const newTables = [
  "credential_renewal_links",
  "credential_renewal_workflows",
  "renewal_change_requests",
  "renewal_audit_events",
];
const cases = JSON.parse(
  readFileSync("tests/fixtures/renewal-urls.json", "utf8"),
) as { input: string | null; valid: boolean; normalized?: string | null }[];
afterAll(() => pool.end());
async function create(a: PracticeActor, patch: Record<string, unknown> = {}) {
  const r = await a.client.rpc("create_practice_credential_with_details", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_title: "Renewal policy",
    p_type: "malpractice_policy",
    p_owner_kind: "practice",
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [],
    p_issuer: "Insurer",
    p_jurisdiction: "CA",
    p_end_date: "2030-03-02",
    p_action_deadline: null,
    ...patch,
  });
  expect(r.error).toBeNull();
  expect(r.data.status).toBe("success");
  return r.data.credential;
}
type RecordData = Awaited<ReturnType<typeof create>>;
async function read(a: Actor, practiceId: string, archived = false) {
  const r = await a.client.rpc("list_practice_register_with_renewal", {
    p_practice_id: practiceId,
    p_include_archived: archived,
  });
  expect(r.error).toBeNull();
  return r.data.credentials as RecordData[];
}
async function current(a: PracticeActor, c: RecordData) {
  return (await read(a, a.practice.id, true)).find((r) => r.id === c.id)!;
}
function args(
  practiceId: string,
  c: RecordData,
  key = randomUUID(),
  kind = "progress",
) {
  return {
    p_practice_id: practiceId,
    p_request_id: key,
    p_credential_id: c.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: c.current_cycle.date_revision,
    p_expected_renewal_version:
      c.renewal[kind === "link" ? "link" : "workflow"].version,
  };
}
function change(
  a: Actor,
  practiceId: string,
  c: RecordData,
  kind = "progress",
  value: string | null = "in-progress",
  patch: Record<string, unknown> = {},
) {
  return a.client.rpc(
    kind === "link"
      ? "set_credential_renewal_link"
      : kind === "review"
        ? "acknowledge_credential_renewal"
        : "set_credential_renewal_progress",
    {
      ...args(practiceId, c, undefined, kind),
      ...(kind === "link"
        ? { p_url: value }
        : kind === "review"
          ? {}
          : { p_status: value }),
      ...patch,
    },
  );
}
async function success(r: Awaited<ReturnType<typeof change>>) {
  expect(r.error).toBeNull();
  expect(r.data.status).toBe("success");
  return r.data;
}
async function state(practiceId: string) {
  return Object.fromEntries(
    await Promise.all(
      newTables.map(async (table) => [
        table,
        (
          await pool.query(
            `select to_jsonb(t) row from private.${table} t where practice_id=$1 order by to_jsonb(t)::text`,
            [practiceId],
          )
        ).rows,
      ]),
    ),
  );
}
async function legacy() {
  const tables = (
    await pool.query(
      "select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='private' or (n.nspname='public' and c.relname in ('practices','practice_memberships','clinicians','credentials','policy_coverage','credential_cycles'))) order by n.nspname,c.relname",
    )
  ).rows.filter((t) => !newTables.includes(t.name));
  const result: Record<string, unknown> = {};
  for (const t of tables)
    result[`${t.schema}.${t.name}`] = (
      await pool.query(
        `select to_jsonb(t) row from ${t.schema}.${t.name} t order by to_jsonb(t)::text`,
      )
    ).rows;
  return result;
}
async function staff(a: PracticeActor, role = "manager") {
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
async function archive(a: PracticeActor, c: RecordData) {
  const tokens = args(a.practice.id, c);
  const { p_expected_renewal_version, ...input } = tokens;
  expect(p_expected_renewal_version).toBeGreaterThan(0);
  return success(await a.client.rpc("archive_practice_credential", input));
}
it("RW01 defaults and persisted links", async () => {
  const a = await practice(),
    c = await create(a),
    before = await legacy(),
    rows = await state(a.practice.id);
  let saved = await current(a, c);
  expect(saved.renewal).toEqual({
    link: { url: null, version: 1 },
    workflow: {
      cycleId: c.current_cycle.id,
      status: "not-started",
      version: 1,
      acknowledgedAt: null,
    },
  });
  expect(await state(a.practice.id)).toEqual(rows);
  expect(await legacy()).toEqual(before);
  for (const [url, expected, version] of [
    [
      " HTTPS://Board.example.test/renew?type=state#start ",
      "https://Board.example.test/renew?type=state#start",
      2,
    ],
    [
      "https://issuer.example.test/renew",
      "https://issuer.example.test/renew",
      3,
    ],
    [null, null, 4],
  ] as const) {
    const r = await success(await change(a, a.practice.id, saved, "link", url));
    expect(r.changed).toBe(true);
    saved = await current(a, c);
    expect(saved.renewal.link).toEqual({ url: expected, version });
    expect(saved.renewal.workflow.version).toBe(1);
  }
  expect((await state(a.practice.id)).credential_renewal_links).toHaveLength(1);
  expect(await legacy()).toEqual(before);
});
it("RW02 all progress transitions persist", async () => {
  const a = await practice();
  for (const from of ["not-started", "in-progress", "awaiting-approval"])
    for (const to of ["not-started", "in-progress", "awaiting-approval"]) {
      const c = await create(a);
      let saved = await current(a, c);
      await success(await change(a, a.practice.id, saved, "progress", from));
      saved = await current(a, c);
      const before = await state(a.practice.id),
        v = saved.renewal.workflow.version;
      const r = await success(
        await change(a, a.practice.id, saved, "progress", to),
      );
      expect(r.changed).toBe(from !== to);
      const after = await current(a, c);
      expect(after.renewal.workflow).toMatchObject({
        status: to,
        version: v + (from === to ? 0 : 1),
      });
      expect((await state(a.practice.id)).renewal_audit_events.length).toBe(
        before.renewal_audit_events.length + (from === to ? 0 : 1),
      );
    }
  const c = await current(a, await create(a));
  expect(
    (await change(a, a.practice.id, c, "progress", "completed")).data.status,
  ).toBe("invalid");
});
it("RW03 explicit review retains first facts", async () => {
  const a = await practice(),
    c = await current(a, await create(a)),
    start = Date.now();
  const first = await success(await change(a, a.practice.id, c, "review"));
  expect(first.changed).toBe(true);
  let saved = await current(a, c);
  const review = saved.renewal.workflow.acknowledgedAt;
  expect(new Date(review).getTime()).toBeGreaterThanOrEqual(start - 1000);
  expect(new Date(review).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  expect(saved.renewal.workflow).toMatchObject({
    status: "not-started",
    version: 2,
  });
  const m = await staff(a),
    before = await state(a.practice.id);
  expect(
    (await success(await change(m, a.practice.id, saved, "review"))).changed,
  ).toBe(false);
  expect((await state(a.practice.id)).renewal_audit_events).toEqual(
    before.renewal_audit_events,
  );
  for (const [kind, value] of [
    ["progress", "awaiting-approval"],
    ["link", "https://board.example.test/renew"],
  ]) {
    await success(await change(a, a.practice.id, saved, kind, value));
    saved = await current(a, c);
    expect(saved.renewal.workflow.acknowledgedAt).toBe(review);
  }
  const stored = (
    await pool.query(
      "select acknowledged_by from private.credential_renewal_workflows where cycle_id=$1",
      [c.current_cycle.id],
    )
  ).rows[0];
  expect(stored.acknowledged_by).toBe(a.user.id);
  expect(JSON.stringify(saved.renewal)).not.toContain(a.user.id);
});
it("RW05 current roles and tenants control access", async () => {
  const a = await practice(),
    c = await current(a, await create(a)),
    b = await practice(),
    v = await staff(a, "viewer"),
    m = await staff(a);
  expect((await read(v, a.practice.id))[0].renewal).toEqual(c.renewal);
  for (const who of [b, v, { client: anonymous() } as Actor])
    for (const kind of ["link", "progress", "review"])
      expect((await change(who, a.practice.id, c, kind)).error?.code).toBe(
        "42501",
      );
  for (const who of [b, { client: anonymous() } as Actor])
    expect(
      (
        await who.client.rpc("list_practice_register_with_renewal", {
          p_practice_id: a.practice.id,
          p_include_archived: false,
        })
      ).error?.code,
    ).toBe("42501");
  const foreign = await current(b, await create(b));
  for (const id of [foreign.id, randomUUID()])
    expect(
      (
        await change(a, a.practice.id, c, "progress", "in-progress", {
          p_credential_id: id,
        })
      ).data,
    ).toEqual({ status: "not-found" });
  await success(await change(m, a.practice.id, c));
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        p_membership_id: m.member.id,
        p_expected_version: 1,
      })
    ).error,
  ).toBeNull();
  expect((await change(m, a.practice.id, c)).error?.code).toBe("42501");
  expect(
    (
      await m.client.rpc("list_practice_register_with_renewal", {
        p_practice_id: a.practice.id,
        p_include_archived: false,
      })
    ).error?.code,
  ).toBe("42501");
});
it("RW06 immutable replay and independent concurrency", async () => {
  const a = await practice(),
    c = await current(a, await create(a)),
    key = randomUUID(),
    patch = { p_request_id: key };
  const replies = await Promise.all(
    Array.from({ length: 6 }, () =>
      change(a, a.practice.id, c, "progress", "in-progress", patch),
    ),
  );
  for (const r of replies) {
    await success(r);
    expect(r.data).toEqual(replies[0].data);
  }
  let saved = await current(a, c);
  const before = await state(a.practice.id);
  expect(before.renewal_audit_events).toHaveLength(1);
  expect(before.renewal_change_requests).toHaveLength(1);
  for (const changePatch of [
    { p_status: "awaiting-approval" },
    { p_expected_version: 2 },
    { p_expected_cycle_id: randomUUID() },
    { p_expected_date_revision: 2 },
    { p_expected_renewal_version: 2 },
    { p_credential_id: randomUUID() },
  ])
    expect(
      (
        await change(a, a.practice.id, c, "progress", "in-progress", {
          ...patch,
          ...changePatch,
        })
      ).data,
    ).toEqual({ status: "request-conflict" });
  expect(
    (await change(a, a.practice.id, c, "review", null, patch)).data,
  ).toEqual({ status: "request-conflict" });
  expect(await state(a.practice.id)).toEqual(before);
  const racing = await Promise.all(
    ["not-started", "awaiting-approval"].map((status) =>
      change(a, a.practice.id, saved, "progress", status),
    ),
  );
  expect(racing.map((r) => r.data.status).sort()).toEqual([
    "conflict",
    "success",
  ]);
  saved = await current(a, c);
  const independent = await Promise.all([
    change(a, a.practice.id, saved, "link", "https://board.example.test"),
    change(a, a.practice.id, saved, "review"),
  ]);
  for (const r of independent) await success(r);
  expect(
    (await change(a, a.practice.id, c, "progress", "in-progress", patch)).data,
  ).toEqual(replies[0].data);
  await archive(a, await current(a, c));
  expect(
    (await change(a, a.practice.id, c, "progress", "in-progress", patch)).data,
  ).toEqual(replies[0].data);
  expect(await read(a, a.practice.id)).toEqual([]);
});
it("RW06 context races and terminal records", async () => {
  const a = await practice(),
    c = await current(a, await create(a)),
    other = await create(a),
    before = await state(a.practice.id);
  for (const patch of [
    { p_expected_version: 2 },
    { p_expected_cycle_id: other.current_cycle.id },
    { p_expected_date_revision: 2 },
    { p_expected_renewal_version: 2 },
  ])
    expect(
      (await change(a, a.practice.id, c, "progress", "in-progress", patch)).data
        .status,
    ).toBe("conflict");
  expect(await state(a.practice.id)).toEqual(before);
  await pool.query(
    "update public.credential_cycles set completed_at=clock_timestamp() where id=$1",
    [c.current_cycle.id],
  );
  for (const kind of ["link", "progress", "review"])
    expect(
      (
        await change(
          a,
          a.practice.id,
          c,
          kind,
          kind === "link" ? "https://board.example.test" : "in-progress",
        )
      ).data,
    ).toEqual({ status: "completed" });
  const archived = await current(a, other);
  await archive(a, archived);
  for (const kind of ["link", "progress", "review"])
    expect(
      (
        await change(
          a,
          a.practice.id,
          archived,
          kind,
          kind === "link" ? "https://board.example.test" : "in-progress",
        )
      ).data,
    ).toEqual({ status: "archived" });
  const missing = await current(a, await create(a)),
    cy = (
      await pool.query("select * from public.credential_cycles where id=$1", [
        missing.current_cycle.id,
      ])
    ).rows[0];
  await pool.query("delete from public.credential_cycles where id=$1", [cy.id]);
  try {
    expect((await change(a, a.practice.id, missing)).error).not.toBeNull();
    expect(
      (
        await a.client.rpc("list_practice_register_with_renewal", {
          p_practice_id: a.practice.id,
          p_include_archived: true,
        })
      ).error,
    ).not.toBeNull();
  } finally {
    await pool.query(
      "insert into public.credential_cycles select * from jsonb_populate_record(null::public.credential_cycles,$1::jsonb)",
      [JSON.stringify(cy)],
    );
  }
});
it("RW06 integer max permits no-op but rejects required increment", async () => {
  const a = await practice(),
    c = await current(a, await create(a));
  await success(await change(a, a.practice.id, c));
  await success(
    await change(a, a.practice.id, c, "link", "https://board.example.test"),
  );
  await pool.query(
    "update private.credential_renewal_workflows set version=2147483647 where cycle_id=$1",
    [c.current_cycle.id],
  );
  await pool.query(
    "update private.credential_renewal_links set version=2147483647 where credential_id=$1",
    [c.id],
  );
  const saved = await current(a, c);
  for (const [kind, value] of [
    ["progress", "in-progress"],
    ["link", "https://board.example.test"],
  ])
    expect(
      (await success(await change(a, a.practice.id, saved, kind, value)))
        .changed,
    ).toBe(false);
  for (const [kind, value] of [
    ["progress", "awaiting-approval"],
    ["link", null],
    ["review", null],
  ] as const)
    expect(
      (await change(a, a.practice.id, saved, kind, value)).data.status,
    ).toBe("conflict");
});
it("RW06 atomic fault recovery", async () => {
  const a = await practice();
  for (const [table, event, kind] of [
    ["credential_renewal_links", "insert", "link"],
    ["credential_renewal_links", "update", "link"],
    ["credential_renewal_workflows", "insert", "progress"],
    ["credential_renewal_workflows", "update", "review"],
    ["renewal_audit_events", "insert", "progress"],
    ["renewal_change_requests", "insert", "progress"],
  ]) {
    let c = await current(a, await create(a));
    if (event === "update") {
      await success(
        await change(
          a,
          a.practice.id,
          c,
          kind === "link" ? "link" : "progress",
          kind === "link" ? "https://board.example.test" : "in-progress",
        ),
      );
      c = await current(a, c);
    }
    const before = await state(a.practice.id),
      old = await legacy(),
      patch = { p_request_id: randomUUID() };
    await pool.query(
      `create function private.renewal_fixture_fault() returns trigger language plpgsql as $$begin raise exception 'renewal fixture fault';end$$;create trigger renewal_fixture_fault before ${event} on private.${table} for each row execute function private.renewal_fixture_fault()`,
    );
    try {
      expect(
        (
          await change(
            a,
            a.practice.id,
            c,
            kind,
            kind === "link"
              ? "https://other.example.test"
              : "awaiting-approval",
            patch,
          )
        ).error?.code,
      ).toBe("P0001");
      expect(await state(a.practice.id)).toEqual(before);
      expect(await legacy()).toEqual(old);
    } finally {
      await pool.query(
        `drop trigger renewal_fixture_fault on private.${table};drop function private.renewal_fixture_fault()`,
      );
    }
    await success(
      await change(
        a,
        a.practice.id,
        c,
        kind,
        kind === "link" ? "https://other.example.test" : "awaiting-approval",
        patch,
      ),
    );
  }
});
it("RW05 waiting mutations and exact replay recheck demotion and revocation", async () => {
  const a = await practice();
  for (const revoke of [false, true])
    for (const kind of ["progress", "link", "review"]) {
      const m = await staff(a),
        c = await current(a, await create(a)),
        key = randomUUID(),
        value = kind === "link" ? "https://board.example.test" : "in-progress";
      const original = await success(
        await change(m, a.practice.id, c, kind, value, { p_request_id: key }),
      );
      expect(original.changed).toBe(true);
      const saved = await current(a, c),
        db = await pool.connect();
      try {
        await db.query("begin");
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          a.user.id,
        ]);
        await db.query("select private.mutate_member($1,1,$2,$3)", [
          m.member.id,
          revoke ? null : "viewer",
          revoke,
        ]);
        const pending = Promise.resolve(
          change(m, a.practice.id, saved, kind, value),
        );
        let witnessed = false;
        for (let n = 0; n < 200; n++) {
          if (
            (
              await pool.query(
                "select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%credential_renewal%' ",
              )
            ).rowCount
          ) {
            witnessed = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(witnessed).toBe(true);
        await db.query("commit");
        expect((await pending).error?.code).toBe("42501");
        expect(
          (
            await change(m, a.practice.id, c, kind, value, {
              p_request_id: key,
            })
          ).error?.code,
        ).toBe("42501");
      } finally {
        await db.query("rollback");
        db.release();
      }
    }
});
it("RW09 exact URL grammar and SQL parity", async () => {
  const a = await practice(),
    c = await current(a, await create(a));
  const boundary = [
    {
      input: "https://board.example.test/" + "a".repeat(2048 - 27),
      valid: true,
    },
    {
      input: "https://board.example.test/" + "a".repeat(2049 - 27),
      valid: false,
    },
    { input: "https://" + "a".repeat(63) + ".test/renew", valid: true },
    { input: "https://" + "a".repeat(64) + ".test/renew", valid: false },
    {
      input: "https://" + [63, 63, 63, 61].map((n) => "a".repeat(n)).join("."),
      valid: true,
    },
    {
      input: "https://" + [63, 63, 63, 62].map((n) => "a".repeat(n)).join("."),
      valid: false,
    },
  ];
  for (const item of [...cases, ...boundary]) {
    if (item.input?.includes("\0")) {
      const before = await state(a.practice.id);
      const rejected = await change(
        a,
        a.practice.id,
        await current(a, c),
        "link",
        item.input,
      );
      expect(rejected.error).not.toBeNull();
      expect(rejected.data).toBeNull();
      expect(await state(a.practice.id)).toEqual(before);
      continue; // PostgreSQL text rejects NUL at transport; no state/receipt can be written.
    }
    const result = await change(
      a,
      a.practice.id,
      await current(a, c),
      "link",
      item.input,
    );
    expect(result.error).toBeNull();
    expect(result.data.status, JSON.stringify(item.input)).toBe(
      item.valid ? "success" : "invalid",
    );
    if (item.valid && "normalized" in item)
      expect((await current(a, c)).renewal.link.url).toBe(item.normalized);
  }
});
it("RW09 nullable URL constraint rejects blank nonnull storage", async () => {
  const a = await practice(),
    c = await create(a),
    db = await pool.connect();
  try {
    await db.query("begin");
    for (const url of ["", "   ", "\t\n"]) {
      await db.query("savepoint invalid_url");
      await expect(
        db.query(
          "insert into private.credential_renewal_links(practice_id,credential_id,url,version) values($1,$2,$3,2)",
          [a.practice.id, c.id, url],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await db.query("rollback to invalid_url");
    }
    expect(
      (
        await db.query(
          "select count(*)::integer n from private.credential_renewal_links where practice_id=$1",
          [a.practice.id],
        )
      ).rows[0].n,
    ).toBe(0);
    for (const url of [null, "https://board.example.test"]) {
      await db.query("savepoint valid_url");
      await expect(
        db.query(
          "insert into private.credential_renewal_links(practice_id,credential_id,url,version) values($1,$2,$3,2)",
          [a.practice.id, c.id, url],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await db.query("rollback to valid_url");
    }
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("RW05 malformed SQL tokens and raw storage/helper access fail closed", async () => {
  const a = await practice(),
    b = await practice(),
    c = await current(a, await create(a)),
    foreign = await create(b),
    before = await state(a.practice.id);
  for (const patch of [
    { p_request_id: null },
    { p_credential_id: null },
    { p_expected_version: null },
    { p_expected_version: 0 },
    { p_expected_cycle_id: null },
    { p_expected_date_revision: null },
    { p_expected_date_revision: 0 },
    { p_expected_renewal_version: null },
    { p_expected_renewal_version: 0 },
  ])
    expect(
      (await change(a, a.practice.id, c, "progress", "in-progress", patch)).data
        .status,
    ).toBe("invalid");
  expect(
    (await change(a, a.practice.id, c, "progress", null)).data.status,
  ).toBe("invalid");
  expect(
    (
      await a.client.rpc("list_practice_register_with_renewal", {
        p_practice_id: a.practice.id,
        p_include_archived: null,
      })
    ).data.status,
  ).toBe("invalid");
  await expect(
    pool.query(
      "insert into private.credential_renewal_workflows(practice_id,cycle_id,status,version) values($1,$2,'in-progress',2)",
      [a.practice.id, foreign.current_cycle.id],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  const db = await pool.connect();
  try {
    for (const query of [
      "select * from private.credential_renewal_links",
      "select * from private.credential_renewal_workflows",
      "select * from private.renewal_change_requests",
      "select * from private.renewal_audit_events",
      "select private.renewal_url(null)",
      "select private.renewal_projection(null)",
    ]) {
      await db.query("begin;set local role authenticated");
      await expect(db.query(query)).rejects.toMatchObject({ code: "42501" });
      await db.query("rollback");
    }
  } finally {
    await db.query("rollback");
    db.release();
  }
  expect(await state(a.practice.id)).toEqual(before);
});
it("RW04 renewal writes preserve reminders dates and dispatch permission", async () => {
  const a = await practice(),
    member = await membership(a.practice.id, a.user.id),
    c = await current(a, await create(a));
  expect(
    (
      await a.client.rpc("set_practice_reminder_recipient", {
        p_practice_id: a.practice.id,
        p_membership_id: member.id,
        p_expected_version: 1,
      })
    ).error,
  ).toBeNull();
  const now = "2030-01-01T10:00:00Z",
    config = {
      namespace: "fixture-renewal",
      from: "reminders@example.test",
      replyTo: "support@example.test",
      appUrl: "http://127.0.0.1:3000",
    };
  await pool.query(
    "update public.credential_cycles set updated_at=$2 where id=$1",
    [c.current_cycle.id, now],
  );
  for (let n = 0; n < 100; n++) {
    await pool.query(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [a.practice.id],
    );
    await pool.query("select private.reconcile_email_reminders_at($1,$2)", [
      config.namespace,
      now,
    ]);
    if (
      !(
        await pool.query(
          "select 1 from private.reminder_reconcile_outbox where practice_id=$1",
          [a.practice.id],
        )
      ).rowCount
    )
      break;
  }
  const queued = (
    await pool.query(
      "select * from private.reminder_jobs where credential_id=$1",
      [c.id],
    )
  ).rows[0];
  expect(queued.state).toBe("queued");
  await pool.query(
    "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3 where id=$1",
    [queued.id, randomUUID(), "2030-01-01T10:00:30Z"],
  );
  const claimed = (
      await pool.query("select * from private.reminder_jobs where id=$1", [
        queued.id,
      ])
    ).rows[0],
    before = await legacy();
  let saved = c;
  for (const [kind, value] of [
    ["link", "https://board.example.test"],
    ["progress", "awaiting-approval"],
    ["review", null],
  ] as const) {
    await success(await change(a, a.practice.id, saved, kind, value));
    saved = await current(a, c);
    expect(await legacy()).toEqual(before);
  }
  const permission = (
    await pool.query(
      "select private.begin_email_reminder_at($1,$2,$3,$4) value",
      [claimed.id, claimed.claim_token, config, now],
    )
  ).rows[0].value;
  expect(permission.status).toBe("submit");
  expect(permission.payload.text).not.toContain("board.example.test");
  const consumed = await legacy();
  await success(
    await change(a, a.practice.id, saved, "progress", "not-started"),
  );
  expect(await legacy()).toEqual(consumed);
});
