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
type Actor = Awaited<ReturnType<typeof account>>;
type PracticeActor = Awaited<ReturnType<typeof practice>>;
afterAll(() => pool.end());
async function create(a: PracticeActor, patch: Record<string, unknown> = {}) {
  const r = await a.client.rpc("create_practice_credential_with_details", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_title: "Confirmed policy",
    p_type: "malpractice_policy",
    p_owner_kind: "practice",
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [],
    p_issuer: "Insurer",
    p_jurisdiction: "CA",
    p_end_date: "2000-03-02",
    p_action_deadline: "2000-02-01",
    ...patch,
  });
  expect(r.error).toBeNull();
  return r.data.credential;
}
type RecordData = Awaited<ReturnType<typeof create>>;
function args(
  a: PracticeActor,
  c: RecordData,
  patch: Record<string, unknown> = {},
) {
  return {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: c.current_cycle.date_revision,
    p_expected_renewal_version: c.renewal?.workflow.version ?? 1,
    p_end_date: "2090-03-02",
    p_action_deadline: null,
    p_confirmed: true,
    ...patch,
  };
}
async function current(a: PracticeActor, c: RecordData) {
  const r = await a.client.rpc("list_practice_register_with_renewal", {
    p_practice_id: a.practice.id,
    p_include_archived: true,
  });
  expect(r.error).toBeNull();
  return r.data.credentials.find((r: RecordData) => r.id === c.id);
}
async function complete(
  a: PracticeActor,
  c: RecordData,
  patch: Record<string, unknown> = {},
) {
  const r = await a.client.rpc(
    "complete_credential_renewal",
    args(a, c, patch),
  );
  expect(r.error).toBeNull();
  return r.data;
}
async function history(
  a: Actor,
  practiceId: string,
  id: string,
  before: number | null = null,
) {
  const r = await a.client.rpc("get_credential_renewal_history", {
    p_practice_id: practiceId,
    p_credential_id: id,
    p_before_cycle_number: before,
  });
  expect(r.error).toBeNull();
  return r.data;
}
async function snapshot(practiceId: string) {
  const tables = (
    await pool.query(
      "select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='private' or (n.nspname='public' and c.relname in ('practices','practice_memberships','clinicians','credentials','policy_coverage','credential_cycles'))) order by 1,2",
    )
  ).rows;
  const result: Record<string, unknown> = {};
  for (const t of tables)
    result[`${t.schema}.${t.name}`] = (
      await pool.query(
        `select to_jsonb(t) row from ${t.schema}.${t.name} t where to_jsonb(t)->>'practice_id'=$1 or not (to_jsonb(t) ? 'practice_id') order by to_jsonb(t)::text`,
        [practiceId],
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
async function selectRecipient(a: PracticeActor) {
  const m = await membership(a.practice.id, a.user.id);
  expect(
    (
      await a.client.rpc("set_practice_reminder_recipient", {
        p_practice_id: a.practice.id,
        p_membership_id: m.id,
        p_expected_version: 1,
      })
    ).error,
  ).toBeNull();
}
const config = {
  namespace: "fixture-completion",
  from: "reminders@example.test",
  replyTo: "support@example.test",
  appUrl: "http://127.0.0.1:3000",
};
async function reconcile(a: PracticeActor, now: string) {
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
      return;
  }
  throw new Error("Outbox not drained");
}
it("RC02 RC04 confirmed renewal preserves prior facts and all latest-cycle writes", async () => {
  const a = await practice();
  for (const type of [
    "state_license",
    "dea_registration",
    "malpractice_policy",
  ]) {
    let c = await current(a, await create(a, { p_type: type }));
    for (const [name, value] of [
      ["set_credential_renewal_link", "https://board.example.test"],
      ["set_credential_renewal_progress", "awaiting-approval"],
      ["acknowledge_credential_renewal", null],
    ] as const) {
      const r = await a.client.rpc(name, {
        p_practice_id: a.practice.id,
        p_request_id: randomUUID(),
        p_credential_id: c.id,
        p_expected_version: c.version,
        p_expected_cycle_id: c.current_cycle.id,
        p_expected_date_revision: c.current_cycle.date_revision,
        p_expected_renewal_version: name.includes("link")
          ? c.renewal.link.version
          : c.renewal.workflow.version,
        ...(value === null
          ? {}
          : name.includes("link")
            ? { p_url: value }
            : { p_status: value }),
      });
      expect(r.error).toBeNull();
      c = await current(a, c);
    }
    const prior = (
        await pool.query("select * from public.credential_cycles where id=$1", [
          c.current_cycle.id,
        ])
      ).rows[0],
      work = (
        await pool.query(
          "select * from private.credential_renewal_workflows where cycle_id=$1",
          [c.current_cycle.id],
        )
      ).rows;
    const r = await complete(a, c, { p_action_deadline: "2090-02-01" });
    expect(r.status).toBe("success");
    expect(r.completedCycle.id).toBe(c.current_cycle.id);
    let saved = await current(a, c);
    expect(saved.current_cycle).toMatchObject({
      cycle_number: 2,
      date_revision: 1,
      end_date: "2090-03-02",
      action_deadline: "2090-02-01",
    });
    expect(saved.version).toBe(c.version + 1);
    expect(saved.renewal).toMatchObject({
      link: c.renewal.link,
      workflow: {
        cycleId: saved.current_cycle.id,
        status: "not-started",
        version: 1,
        acknowledgedAt: null,
      },
    });
    const old = (
      await pool.query("select * from public.credential_cycles where id=$1", [
        c.current_cycle.id,
      ])
    ).rows[0];
    expect(old).toMatchObject({
      ...prior,
      completed_at: expect.any(Date),
      updated_at: expect.any(Date),
    });
    expect(old.completed_at).toEqual(old.updated_at);
    expect(
      (
        await pool.query(
          "select * from private.credential_renewal_workflows where cycle_id=$1",
          [c.current_cycle.id],
        )
      ).rows,
    ).toEqual(work);
    const progress = await a.client.rpc("set_credential_renewal_progress", {
      p_practice_id: a.practice.id,
      p_request_id: randomUUID(),
      p_credential_id: c.id,
      p_expected_version: saved.version,
      p_expected_cycle_id: saved.current_cycle.id,
      p_expected_date_revision: 1,
      p_expected_renewal_version: 1,
      p_status: "in-progress",
    });
    expect(progress.data.status).toBe("success");
    saved = await current(a, c);
    expect((await complete(a, saved)).status).toBe("success");
    saved = await current(a, c);
    expect(saved.current_cycle.cycle_number).toBe(3);
    const h = await history(a, a.practice.id, c.id);
    expect(h.status).toBe("success");
    expect(h.cycles.map((x: { cycleNumber: number }) => x.cycleNumber)).toEqual(
      [3, 2, 1],
    );
    expect(h.cycles[2]).toMatchObject({
      completedAt: expect.any(String),
      successorId: h.cycles[1].id,
      progress: "awaiting-approval",
      acknowledgedAt: c.renewal.workflow.acknowledgedAt,
    });
    expect(JSON.stringify(h)).not.toContain(a.user.id);
    expect(JSON.stringify(h)).not.toContain("board.example");
  }
});
it("RC01 invalid dates and unchecked confirmation make zero writes", async () => {
  const a = await practice(),
    c = await current(a, await create(a)),
    before = await snapshot(a.practice.id);
  const today = (
    await pool.query(
      "select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD') today",
    )
  ).rows[0].today;
  for (const p of [
    { p_end_date: null },
    { p_end_date: "" },
    { p_end_date: today },
    { p_end_date: "2000-01-01" },
    { p_end_date: "2090-02-29" },
    { p_end_date: "0000-01-01" },
    { p_end_date: "10000-01-01" },
    { p_action_deadline: today },
    { p_action_deadline: "2090-03-02" },
    { p_action_deadline: "2090-03-03" },
    { p_action_deadline: "bad" },
    { p_confirmed: false },
    { p_confirmed: null },
  ])
    expect((await complete(a, c, p)).status).toBe("invalid");
  expect(await snapshot(a.practice.id)).toEqual(before);
  for (const p of [
    { p_end_date: null, p_action_deadline: null },
    { p_end_date: null, p_action_deadline: "2000-01-01" },
  ]) {
    const unknown = await current(a, await create(a, p));
    expect((await complete(a, unknown, { p_action_deadline: "" })).status).toBe(
      "success",
    );
  }
});
it("RC03 concurrent exact replay and competing keys never fork successors", async () => {
  const a = await practice(),
    c = await current(a, await create(a)),
    input = args(a, c);
  const rs = await Promise.all(
    Array.from({ length: 6 }, () =>
      a.client.rpc("complete_credential_renewal", input),
    ),
  );
  for (const r of rs) {
    expect(r.error).toBeNull();
    expect(r.data.status).toBe("success");
    expect(r.data).toEqual(rs[0].data);
  }
  for (const p of [
    { p_end_date: "2091-01-01" },
    { p_expected_version: 2 },
    { p_expected_cycle_id: randomUUID() },
    { p_confirmed: false },
    { p_credential_id: randomUUID() },
  ]) {
    const r = await a.client.rpc("complete_credential_renewal", {
      ...input,
      ...p,
    });
    expect(r.data.status).toBe(
      p.p_confirmed === false ? "invalid" : "request-conflict",
    );
  }
  let saved = await current(a, c);
  const race = await Promise.all(
    Array.from({ length: 5 }, () => complete(a, saved)),
  );
  expect(race.map((r) => r.status).sort()).toEqual([
    "conflict",
    "conflict",
    "conflict",
    "conflict",
    "success",
  ]);
  saved = await current(a, c);
  expect(saved.current_cycle.cycle_number).toBe(3);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.credential_renewal_completions where credential_id=$1",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(2);
  const archive = await a.client.rpc("archive_practice_credential", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: saved.version,
    p_expected_cycle_id: saved.current_cycle.id,
    p_expected_date_revision: 1,
  });
  expect(archive.data.status).toBe("success");
  expect(
    (await a.client.rpc("complete_credential_renewal", input)).data,
  ).toEqual(rs[0].data);
  expect((await complete(a, saved)).status).toBe("archived");
  expect((await history(a, a.practice.id, c.id)).archivedAt).not.toBeNull();
});
it("RC04 context tokens terminal cycles and overflow are fail closed", async () => {
  const a = await practice(),
    c = await current(a, await create(a)),
    before = await snapshot(a.practice.id);
  for (const p of [
    { p_expected_version: 2 },
    { p_expected_cycle_id: randomUUID() },
    { p_expected_date_revision: 2 },
    { p_expected_renewal_version: 2 },
  ])
    expect((await complete(a, c, p)).status).toBe("conflict");
  for (const p of [
    { p_expected_version: null },
    { p_expected_version: 0 },
    { p_expected_cycle_id: null },
    { p_expected_date_revision: 0 },
    { p_expected_renewal_version: 0 },
    { p_request_id: null },
  ])
    expect((await complete(a, c, p)).status).toBe("invalid");
  expect(await snapshot(a.practice.id)).toEqual(before);
  await pool.query(
    "update public.credentials set version=2147483647 where id=$1",
    [c.id],
  );
  let saved = await current(a, c);
  expect((await complete(a, saved)).status).toBe("conflict");
  await pool.query("update public.credentials set version=1 where id=$1", [
    c.id,
  ]);
  await pool.query(
    "update public.credential_cycles set cycle_number=2147483647 where id=$1",
    [c.current_cycle.id],
  );
  saved = await current(a, c);
  expect((await complete(a, saved)).status).toBe("conflict");
  await pool.query(
    "update public.credential_cycles set completed_at=clock_timestamp() where id=$1",
    [c.current_cycle.id],
  );
  expect((await complete(a, saved)).status).toBe("completed");
});
it("RC07 current roles tenants raw helpers and lineage are protected", async () => {
  const a = await practice(),
    b = await practice(),
    c = await current(a, await create(a)),
    foreign = await current(b, await create(b)),
    v = await staff(a, "viewer"),
    m = await staff(a);
  for (const who of [b, v, { client: anonymous() }]) {
    expect(
      (await who.client.rpc("complete_credential_renewal", args(a, c))).error
        ?.code,
    ).toBe("42501");
  }
  expect((await history(v, a.practice.id, c.id)).status).toBe("success");
  for (const id of [foreign.id, randomUUID()])
    expect((await complete(a, c, { p_credential_id: id })).status).toBe(
      "not-found",
    );
  expect((await history(a, a.practice.id, foreign.id)).status).toBe(
    "not-found",
  );
  const input = args(a, c),
    r = await m.client.rpc("complete_credential_renewal", input);
  expect(r.data.status).toBe("success");
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        p_membership_id: m.member.id,
        p_expected_version: 1,
      })
    ).error,
  ).toBeNull();
  expect(
    (await m.client.rpc("complete_credential_renewal", input)).error?.code,
  ).toBe("42501");
  const db = await pool.connect();
  try {
    for (const q of [
      "select * from private.credential_renewal_completions",
      "select * from private.renewal_completion_requests",
      "select private.renewal_completion_clock()",
      "select private.current_credential_cycle(null,null)",
    ]) {
      await db.query("begin;set local role authenticated");
      await expect(db.query(q)).rejects.toMatchObject({ code: "42501" });
      await db.query("rollback");
    }
  } finally {
    await db.query("rollback");
    db.release();
  }
  await expect(
    pool.query(
      "update private.credential_renewal_completions set successor_id=$2 where credential_id=$1",
      [c.id, foreign.current_cycle.id],
    ),
  ).rejects.toMatchObject({ code: "23503" });
});
it("RC07 history is bounded keyset paginated and read only", async () => {
  const a = await practice(),
    c = await current(a, await create(a));
  let saved = c;
  for (let i = 0; i < 22; i++) {
    expect((await complete(a, saved)).status).toBe("success");
    saved = await current(a, c);
  }
  const before = await snapshot(a.practice.id),
    first = await history(a, a.practice.id, c.id);
  expect(first.cycles).toHaveLength(20);
  expect(first.currentCycleId).toBe(saved.current_cycle.id);
  expect(first.nextBeforeCycleNumber).toBe(4);
  const second = await history(a, a.practice.id, c.id, 4);
  expect(
    second.cycles.map((x: { cycleNumber: number }) => x.cycleNumber),
  ).toEqual([3, 2, 1]);
  expect(second.nextBeforeCycleNumber).toBeNull();
  expect((await history(a, a.practice.id, c.id, 0)).status).toBe("invalid");
  expect(await snapshot(a.practice.id)).toEqual(before);
});
it("RC09 atomic faults restore predecessor successor audit receipt and outbox", async () => {
  const a = await practice();
  for (const [schema, table, event, when] of [
    ["public", "credential_cycles", "update", "before"],
    ["public", "credential_cycles", "insert", "before"],
    ["private", "credential_renewal_completions", "insert", "before"],
    ["private", "renewal_audit_events", "insert", "before"],
    ["private", "renewal_completion_requests", "insert", "before"],
    ["private", "reminder_reconcile_outbox", "update", "before"],
  ]) {
    const c = await current(a, await create(a)),
      input = args(a, c),
      before = await snapshot(a.practice.id);
    await pool.query(
      `create function private.completion_fixture_fault() returns trigger language plpgsql as $$begin raise exception 'completion fixture fault';end$$;create trigger completion_fixture_fault ${when} ${event} on ${schema}.${table} for each row execute function private.completion_fixture_fault()`,
    );
    try {
      const r = await a.client.rpc("complete_credential_renewal", input);
      expect(r.error?.code).toBe("P0001");
      expect(await snapshot(a.practice.id)).toEqual(before);
    } finally {
      await pool.query(
        `drop trigger completion_fixture_fault on ${schema}.${table};drop function private.completion_fixture_fault()`,
      );
    }
    expect(
      (await a.client.rpc("complete_credential_renewal", input)).data.status,
    ).toBe("success");
  }
});
it("RC05 RC06 completion cancels claims and successor gets independent scheduling permission", async () => {
  const a = await practice(),
    c = await current(
      a,
      await create(a, { p_end_date: "2090-03-02", p_action_deadline: null }),
    );
  await selectRecipient(a);
  const now = "2090-01-01T10:00:00Z";
  await pool.query(
    "update public.credential_cycles set updated_at=$2 where id=$1",
    [c.current_cycle.id, now],
  );
  await reconcile(a, now);
  const old = (
    await pool.query("select * from private.reminder_jobs where cycle_id=$1", [
      c.current_cycle.id,
    ])
  ).rows[0];
  expect(old.state).toBe("queued");
  const token = randomUUID();
  await pool.query(
    "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3 where id=$1",
    [old.id, token, "2090-01-01T10:00:30Z"],
  );
  expect((await complete(a, c, { p_end_date: "2091-03-02" })).status).toBe(
    "success",
  );
  expect(
    (
      await pool.query(
        "select private.begin_email_reminder_at($1,$2,$3,$4) result",
        [old.id, token, config, now],
      )
    ).rows[0].result.status,
  ).not.toBe("submit");
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.reminder_message_attempts where cycle_id=$1",
        [c.current_cycle.id],
      )
    ).rows[0].n,
  ).toBe(0);
  await reconcile(a, now);
  const saved = await current(a, c),
    jobs = (
      await pool.query(
        "select * from private.reminder_jobs where cycle_id=$1",
        [saved.current_cycle.id],
      )
    ).rows;
  expect(jobs).toHaveLength(1);
  expect(jobs[0].state).toBe("queued");
  expect(jobs[0].nominal_target.toISOString()).toBe("2091-01-01T09:00:00.000Z");
});
it("RC09 post-lock clock and changed authority defeat queued saves", async () => {
  const original = (
    await pool.query(
      "select pg_get_functiondef('private.renewal_completion_clock()'::regprocedure) body",
    )
  ).rows[0].body;
  const setTime = (time: string) =>
    pool.query(
      `create or replace function private.renewal_completion_clock() returns timestamptz language sql volatile security invoker set search_path='' as $$select '${time}'::timestamptz$$`,
    );
  try {
    const a = await practice(),
      c = await current(a, await create(a)),
      db = await pool.connect();
    await setTime("2030-01-01T23:59:59Z");
    await db.query("begin");
    await db.query("select 1 from public.practices where id=$1 for update", [
      a.practice.id,
    ]);
    const pending = Promise.resolve(
      a.client.rpc(
        "complete_credential_renewal",
        args(a, c, { p_end_date: "2030-01-02" }),
      ),
    );
    let waited = false;
    for (let n = 0; n < 200; n++) {
      if (
        (
          await pool.query(
            "select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%complete_credential_renewal%' ",
          )
        ).rowCount
      ) {
        waited = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(waited).toBe(true);
    await setTime("2030-01-02T00:00:01Z");
    await db.query("commit");
    db.release();
    expect((await pending).data).toEqual({
      status: "invalid",
      errors: {
        endDate: "Enter an end date after today in the practice timezone.",
      },
    });
    expect(
      (
        await a.client.rpc("update_practice", {
          p_practice_id: a.practice.id,
          p_name: a.practice.name,
          p_timezone: "America/Los_Angeles",
          p_expected_version: 1,
        })
      ).error,
    ).toBeNull();
    const input = args(a, c, { p_end_date: "2030-01-02" });
    const saved = await a.client.rpc("complete_credential_renewal", input);
    expect(saved.data.status).toBe("success");
    await setTime("2031-01-01T00:00:00Z");
    expect(
      (await a.client.rpc("complete_credential_renewal", input)).data,
    ).toEqual(saved.data);
    for (const revoke of [false, true]) {
      const m = await staff(a),
        record = await current(a, await create(a)),
        lock = await pool.connect();
      await lock.query("begin");
      await lock.query("select set_config('request.jwt.claim.sub',$1,true)", [
        a.user.id,
      ]);
      await lock.query("select private.mutate_member($1,1,$2,$3)", [
        m.member.id,
        revoke ? null : "viewer",
        revoke,
      ]);
      const request = Promise.resolve(
        m.client.rpc("complete_credential_renewal", args(a, record)),
      );
      let seen = false;
      for (let n = 0; n < 200; n++) {
        if (
          (
            await pool.query(
              "select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%complete_credential_renewal%' ",
            )
          ).rowCount
        ) {
          seen = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(seen).toBe(true);
      await lock.query("commit");
      lock.release();
      expect((await request).error?.code).toBe("42501");
    }
  } finally {
    await pool.query(original);
  }
});
it("RC05 RC06 begin-first retains consumed attempts while successor gets fresh catch-up", async () => {
  const original = (
    await pool.query(
      "select pg_get_functiondef('private.renewal_completion_clock()'::regprocedure) body",
    )
  ).rows[0].body;
  await pool.query(
    "create or replace function private.renewal_completion_clock() returns timestamptz language sql volatile security invoker set search_path='' as $$select '2090-01-01T10:00:00Z'::timestamptz$$",
  );
  try {
    const a = await practice(),
      c = await current(
        a,
        await create(a, { p_end_date: "2090-03-02", p_action_deadline: null }),
      );
    await selectRecipient(a);
    const now = "2090-01-01T10:00:00Z";
    await pool.query(
      "update public.credential_cycles set updated_at=$2 where id=$1",
      [c.current_cycle.id, now],
    );
    await reconcile(a, now);
    const j = (
        await pool.query(
          "select * from private.reminder_jobs where cycle_id=$1",
          [c.current_cycle.id],
        )
      ).rows[0],
      token = randomUUID();
    await pool.query(
      "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3 where id=$1",
      [j.id, token, "2090-01-01T10:00:30Z"],
    );
    const permission = (
      await pool.query(
        "select private.begin_email_reminder_at($1,$2,$3,$4) result",
        [j.id, token, config, now],
      )
    ).rows[0].result;
    expect(permission.status).toBe("submit");
    const frozen = (
      await pool.query(
        "select * from private.reminder_message_attempts where id=$1",
        [permission.attemptId],
      )
    ).rows[0];
    expect((await complete(a, c, { p_end_date: "2090-01-15" })).status).toBe(
      "success",
    );
    await pool.query(
      "select private.record_email_reminder($1,$2,'accepted',$3,null)",
      [permission.attemptId, permission.token, randomUUID()],
    );
    expect(
      (
        await pool.query(
          "select payload from private.reminder_message_attempts where id=$1",
          [permission.attemptId],
        )
      ).rows[0].payload,
    ).toEqual(frozen.payload);
    const saved = await current(a, c);
    await reconcile(a, now);
    const successor = (
      await pool.query(
        "select * from private.reminder_jobs where cycle_id=$1",
        [saved.current_cycle.id],
      )
    ).rows[0];
    expect(successor.schedule_kind).toBe("catch-up");
    expect(successor.state).toBe("queued");
    const nextToken = randomUUID();
    await pool.query(
      "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3 where id=$1",
      [successor.id, nextToken, "2090-01-01T10:00:30Z"],
    );
    const next = (
      await pool.query(
        "select private.begin_email_reminder_at($1,$2,$3,$4) result",
        [successor.id, nextToken, config, now],
      )
    ).rows[0].result;
    expect(next.status).toBe("submit");
    expect(next.attemptId).not.toBe(permission.attemptId);
    expect(
      (
        await pool.query(
          "select count(*)::int n from private.reminder_message_attempts where practice_id=$1",
          [a.practice.id],
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await pool.query(original);
  }
});
it("RC03 RC04 shared-policy ownership coverage and cross-actor stale edits are preserved", async () => {
  const a = await practice(),
    m = await staff(a),
    who = await a.client.rpc("create_practice_clinician", {
      p_practice_id: a.practice.id,
      p_request_id: randomUUID(),
      p_name: "Dr Cedar",
    });
  expect(who.error).toBeNull();
  const c = await current(
      a,
      await create(a, { p_covered_clinician_ids: [who.data.clinician.id] }),
    ),
    input = args(a, c),
    beforeCoverage = (
      await pool.query(
        "select * from public.policy_coverage where credential_id=$1",
        [c.id],
      )
    ).rows;
  const replies = await Promise.all([
    a.client.rpc("complete_credential_renewal", input),
    m.client.rpc("complete_credential_renewal", input),
  ]);
  expect(replies.map((r) => r.data.status).sort()).toEqual([
    "conflict",
    "success",
  ]);
  let saved = await current(a, c);
  expect(saved.covered_clinicians).toEqual(c.covered_clinicians);
  expect(
    (
      await pool.query(
        "select * from public.policy_coverage where credential_id=$1",
        [c.id],
      )
    ).rows,
  ).toEqual(beforeCoverage);
  const change = {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: saved.version,
    p_expected_cycle_id: saved.current_cycle.id,
    p_expected_date_revision: saved.current_cycle.date_revision,
    p_title: "Updated current policy",
    p_type: saved.type,
    p_owner_kind: saved.owner_kind,
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [who.data.clinician.id],
    p_issuer: saved.issuer,
    p_jurisdiction: saved.jurisdiction,
    p_end_date: "2091-03-02",
    p_action_deadline: null,
  };
  const update = await a.client.rpc("update_practice_credential", change);
  expect(update.data.status).toBe("success");
  saved = await current(a, c);
  expect(saved.current_cycle).toMatchObject({
    cycle_number: 2,
    date_revision: 2,
    end_date: "2091-03-02",
  });
  const old = (
    await pool.query(
      "select end_date::text,action_deadline::text,date_revision from public.credential_cycles where id=$1",
      [c.current_cycle.id],
    )
  ).rows[0];
  expect(old).toEqual({
    end_date: "2000-03-02",
    action_deadline: "2000-02-01",
    date_revision: 1,
  });
  expect(
    (
      await a.client.rpc("update_practice_credential", {
        ...change,
        p_request_id: randomUUID(),
        p_expected_cycle_id: c.current_cycle.id,
      })
    ).data.status,
  ).toBe("conflict");
  const key = randomUUID(),
    result = await complete(a, saved, { p_request_id: key });
  expect(result.status).toBe("success");
  await pool.query(
    "update public.credential_cycles set completed_at=clock_timestamp() where id=$1",
    [result.credential.current_cycle.id],
  );
  expect(
    (
      await a.client.rpc("update_practice_credential", {
        ...change,
        p_request_id: randomUUID(),
        p_expected_version: result.credential.version,
        p_expected_cycle_id: result.credential.current_cycle.id,
        p_expected_date_revision: 1,
      })
    ).data.status,
  ).toBe("completed");
});
