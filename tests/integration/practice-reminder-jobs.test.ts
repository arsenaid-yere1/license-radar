import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { expireReminderSubmissions } from "@/lib/sms/privileged-repository";
import fc from "fast-check";
import { gregorianOrdinal } from "../helpers/dashboard-fixtures";
import {
  account,
  invite,
  membership,
  pool,
  practice,
} from "../helpers/access-fixtures";

afterAll(() => pool.end());
const namespace = "fixture-reminders";
const now = "2030-01-01T09:00:00Z";
const config = {
  namespace,
  from: "reminders@example.test",
  replyTo: "support@example.test",
  appUrl: "http://127.0.0.1:3000",
};
async function sql<T = Record<string, unknown>>(
  query: string,
  values: unknown[] = [],
) {
  return (await pool.query(query, values)).rows as T[];
}
async function setup(
  date: string | null = "2030-03-02",
  deadline: string | null = null,
) {
  const a = await practice();
  const member = await membership(a.practice.id, a.user.id);
  expect(
    (
      await a.client.rpc("set_practice_reminder_recipient", {
        p_practice_id: a.practice.id,
        p_membership_id: member.id,
        p_expected_version: 1,
      })
    ).error,
  ).toBeNull();
  const created = await a.client.rpc(
    "create_practice_credential_with_details",
    {
      p_practice_id: a.practice.id,
      p_request_id: randomUUID(),
      p_title: "License <private>",
      p_type: "state_license",
      p_owner_kind: "practice",
      p_owner_clinician_id: null,
      p_covered_clinician_ids: [],
      p_issuer: null,
      p_jurisdiction: null,
      p_end_date: date,
      p_action_deadline: deadline,
    },
  );
  expect(created.error).toBeNull();
  const credential = created.data.credential;
  // Real Auth/assignment transactions first; deterministic private clock only for schedule witnesses.
  await sql("select private.drain_email_reminder_accounts()");
  await reconcile(a.practice.id);
  const job = (
    await sql(
      "select *,due_date::text as due_date from private.reminder_jobs where credential_id=$1",
      [credential.id],
    )
  )[0];
  return { ...a, member, credential, job };
}
async function reconcile(practiceId: string) {
  for (let i = 0; i < 100; i++) {
    // Isolate this fixture's queue priority from practices created by other suites.
    // Preserve generation/cursor and exercise the same bounded production selector.
    await sql(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [practiceId],
    );
    await sql("select private.reconcile_email_reminders_at($1,$2)", [
      namespace,
      now,
    ]);
    if (
      !(
        await sql(
          "select 1 from private.reminder_reconcile_outbox where practice_id=$1",
          [practiceId],
        )
      ).length
    )
      return;
  }
  throw new Error("Fixture reconciliation did not finish");
}
async function claim(a: Awaited<ReturnType<typeof setup>>) {
  // Isolate due candidates in this fixture; other test records remain retained.
  await sql(
    "update private.reminder_jobs set state='canceled', claim_token=null, claim_until=null where practice_id<>$1 and state in ('queued','claimed')",
    [a.practice.id],
  );
  return (
    await sql<{ value: { jobId: string; token: string } | null }>(
      "select private.claim_email_reminder_at($1) value",
      [now],
    )
  )[0].value;
}
async function begin(job: { jobId: string; token: string }) {
  return (
    await sql<{
      value: {
        status: string;
        attemptId: string;
        token: string;
        payload: { to: string[]; text: string; html: string };
        key: string;
      };
    }>("select private.begin_email_reminder_at($1,$2,$3,$4) value", [
      job.jobId,
      job.token,
      config,
      now,
    ])
  )[0].value;
}
async function preference(
  a: Awaited<ReturnType<typeof setup>>,
  enabled: boolean,
  version: number,
  requestId = randomUUID(),
) {
  return a.client.rpc("set_my_email_reminder_preference", {
    p_practice_id: a.practice.id,
    p_request_id: requestId,
    p_enabled: enabled,
    p_expected_version: version,
  });
}

it("ER01 email scheduling has private SQL authority and ordinary callers cannot choose its clock", async () => {
  const result = await sql<{ target: string }>(
    "select to_regprocedure('private.reminder_target(date,text)')::text target",
  );
  expect(result[0].target).toBe("private.reminder_target(date,text)");
  for (const role of ["anon", "authenticated", "service_role"])
    expect(
      (
        await sql<{ allowed: boolean }>(
          "select has_function_privilege($1,'private.reconcile_email_reminders_at(text,timestamptz)','execute') allowed",
          [role],
        )
      )[0].allowed,
    ).toBe(false);
});
it("ER02 calendar targets use effective dates, local nine, leap years and skipped/range rejection", async () => {
  for (const [date, zone, target] of [
    ["2028-02-29", "UTC", "2027-12-31T09:00:00.000Z"],
    ["2030-03-02", "America/Los_Angeles", "2030-01-01T17:00:00.000Z"],
    ["2030-03-02", "Asia/Kathmandu", "2030-01-01T03:15:00.000Z"],
    ["2030-03-02", "Australia/Lord_Howe", "2029-12-31T22:00:00.000Z"],
    ["2012-02-28", "Pacific/Apia", null],
    ["0001-03-01", "UTC", null],
    [null, "UTC", null],
  ]) {
    const value = (
      await sql<{ target: Date | null }>(
        "select private.reminder_target($1::date,$2) target",
        [date, zone],
      )
    )[0].target;
    expect(value?.toISOString() ?? null).toBe(target);
  }
  const a = await setup("2030-03-03", "2030-03-02");
  expect(a.job).toMatchObject({
    due_date: "2030-03-02",
    state: "queued",
    timezone: "UTC",
    channel: "email",
    lead_days: 60,
  });
  expect(a.job.nominal_target).toEqual(new Date(now));
  expect(
    (
      await sql(
        "select count(*)::int n from private.practice_sms_enrollments where practice_id=$1",
        [a.practice.id],
      )
    )[0].n,
  ).toBe(0);
});
it("ER03 missing dates and late eligibility are visible blocks, never catch-up sends", async () => {
  const missing = await setup(null);
  expect(missing.job).toMatchObject({
    state: "blocked",
    reason: "missing-date",
    nominal_target: null,
  });
  const a = await setup();
  await sql(
    "update private.reminder_email_preferences set eligible_since='2030-01-01T09:00:01Z' where practice_id=$1",
    [a.practice.id],
  );
  await sql("select private.dirty_email_reminders($1,'fixture-late')", [
    a.practice.id,
  ]);
  await reconcile(a.practice.id);
  expect(
    (
      await sql("select state,reason from private.reminder_jobs where id=$1", [
        a.job.id,
      ])
    )[0],
  ).toEqual({ state: "blocked", reason: "catch-up-unavailable" });
  expect(await claim(a)).toBeNull();
});
it("ER04 reconciliation and concurrent claims grant exactly one immutable submission", async () => {
  const a = await setup();
  await sql("select private.dirty_email_reminders($1,'fixture-reconcile')", [
    a.practice.id,
  ]);
  await reconcile(a.practice.id);
  expect(
    (
      await sql(
        "select count(*)::int n from private.reminder_jobs where credential_id=$1",
        [a.credential.id],
      )
    )[0].n,
  ).toBe(1);
  const first = await claim(a);
  expect(first?.jobId).toBe(a.job.id);
  const second = (
    await sql<{ value: unknown }>(
      "select private.claim_email_reminder_at($1) value",
      [now],
    )
  )[0].value;
  expect(second).toBeNull();
  const permitted = await begin(first!);
  expect(permitted.status).toBe("submit");
  expect(permitted.payload.to).toEqual([a.email]);
  expect(permitted.payload.text).toContain(
    `/practice/register/${a.credential.id}`,
  );
  expect(permitted.payload.html).not.toContain("<private>");
  expect(permitted.key).toBe(`reminder-email/${permitted.attemptId}`);
  expect((await begin(first!)).status).toBe("stale");
  expect(
    (
      await sql(
        "select count(*)::int n from private.reminder_message_attempts where cycle_id=$1",
        [a.credential.current_cycle.id],
      )
    )[0].n,
  ).toBe(1);
});
it("ER05 personal preference is versioned, idempotent, tenant scoped and SMS independent", async () => {
  const a = await setup(),
    foreign = await practice();
  const id = randomUUID();
  const disabled = await preference(a, false, 1, id);
  expect(disabled.data).toMatchObject({
    status: "success",
    preference: { enabled: false, version: 2 },
  });
  expect((await preference(a, false, 1, id)).data).toEqual(disabled.data);
  expect((await preference(a, true, 1, id)).data).toEqual({
    status: "request-conflict",
  });
  expect((await preference(a, true, 1)).data).toEqual({ status: "conflict" });
  expect(
    (
      await foreign.client.rpc("get_my_email_reminder_preference", {
        p_practice_id: a.practice.id,
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await sql("select state,reason from private.reminder_jobs where id=$1", [
        a.job.id,
      ])
    )[0],
  ).toEqual({ state: "canceled", reason: "email-preference-changed" });
  expect(
    (
      await a.client.rpc("get_practice_reminder_recipient", {
        p_practice_id: a.practice.id,
      })
    ).data,
  ).toMatchObject({ version: 2, ready: false, readiness: "sms-setup-pending" });
  expect((await preference(a, true, 2)).data).toMatchObject({
    status: "success",
    preference: { enabled: true, version: 3 },
  });
  const viewer = await account();
  const invitation = await invite(a, viewer.email, "viewer");
  expect(
    (
      await viewer.client.rpc("accept_practice_invitation", {
        p_token_digest: invitation.digest,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await viewer.client.rpc("set_my_email_reminder_preference", {
        p_practice_id: a.practice.id,
        p_request_id: randomUUID(),
        p_enabled: true,
        p_expected_version: 1,
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await viewer.client.rpc("set_my_email_reminder_preference", {
        p_practice_id: a.practice.id,
        p_request_id: randomUUID(),
        p_enabled: false,
        p_expected_version: 1,
      })
    ).data,
  ).toMatchObject({ status: "success" });
});
it("ER06 live Auth edits invalidate old leases, metadata and pending email changes are no-ops", async () => {
  const a = await setup();
  const first = await claim(a);
  const before = (
    await sql(
      "select revision from private.reminder_email_account_state where user_id=$1",
      [a.user.id],
    )
  )[0].revision;
  await sql(
    "update auth.users set raw_user_meta_data=$2,email_change='fixture-pending@example.test' where id=$1",
    [a.user.id, { fixture: true }],
  );
  expect(
    (
      await sql(
        "select revision from private.reminder_email_account_state where user_id=$1",
        [a.user.id],
      )
    )[0].revision,
  ).toBe(before);
  const replacement = `fixture-${randomUUID()}@example.test`;
  await sql("update auth.users set email=$1 where id=$2", [
    replacement,
    a.user.id,
  ]);
  expect((await begin(first!)).status).toBe("stale");
  expect(
    (
      await sql(
        "select count(*)::int n from private.reminder_message_attempts where job_id=$1",
        [a.job.id],
      )
    )[0].n,
  ).toBe(0);
  expect(
    (
      await sql(
        "select revision,dirty from private.reminder_email_account_state where user_id=$1",
        [a.user.id],
      )
    )[0],
  ).toEqual({ revision: String(Number(before) + 1), dirty: true });
});
it("ER07 interrupted submissions expire without queue work and permanently consume the channel", async () => {
  const a = await setup(),
    lease = await claim(a),
    attempt = await begin(lease!);
  expect(attempt.status).toBe("submit");
  expect(
    (
      await sql<{ n: number }>(
        "select private.expire_email_submissions_at('2030-01-01T09:00:31Z') n",
      )
    )[0].n,
  ).toBeGreaterThanOrEqual(1);
  expect(
    (
      await sql(
        "select outcome,error_category from private.reminder_message_attempts where id=$1",
        [attempt.attemptId],
      )
    )[0],
  ).toEqual({ outcome: "uncertain", error_category: "interrupted" });
  await sql("select private.dirty_email_reminders($1,'fixture-revision')", [
    a.practice.id,
  ]);
  await reconcile(a.practice.id);
  expect(await claim(a)).toBeNull();
  const providerId = randomUUID();
  expect(
    (
      await sql<{ value: unknown }>(
        "select private.record_email_reminder($1,$2,'accepted',$3,null) value",
        [attempt.attemptId, attempt.token, providerId],
      )
    )[0].value,
  ).toEqual({ status: "recorded" });
  expect(
    (
      await sql(
        "select outcome,provider_id from private.reminder_message_attempts where id=$1",
        [attempt.attemptId],
      )
    )[0],
  ).toEqual({ outcome: "accepted", provider_id: providerId });
});
it("ER08 signed-event storage binds one consumed attempt, dedupes and retains suppression", async () => {
  const a = await setup(),
    lease = await claim(a),
    attempt = await begin(lease!);
  const providerId = randomUUID(),
    eventId = randomUUID();
  const apply = (status: string, id = randomUUID(), to = a.email) =>
    sql<{ value: unknown }>(
      "select private.apply_email_reminder_event($1,$2,$3,$4,$5,$6,$7) value",
      [namespace, id, providerId, attempt.attemptId, status, config.from, to],
    );
  expect(
    (await apply("delivered", randomUUID(), "fixture-foreign@example.test"))[0]
      .value,
  ).toEqual({ status: "conflict" });
  expect((await apply("bounced", eventId))[0].value).toEqual({
    status: "recorded",
  });
  expect((await apply("bounced", eventId))[0].value).toEqual({
    status: "recorded",
  });
  expect((await apply("delivered", eventId))[0].value).toEqual({
    status: "conflict",
  });
  expect((await apply("delivered"))[0].value).toEqual({ status: "recorded" });
  expect(
    (
      await sql(
        "select outcome,delivery from private.reminder_message_attempts where id=$1",
        [attempt.attemptId],
      )
    )[0],
  ).toEqual({ outcome: "accepted", delivery: "bounced" });
  expect(
    (
      await sql(
        "select suppressed,epoch,reason from private.reminder_email_endpoints where id=$1",
        [a.job.endpoint_id],
      )
    )[0],
  ).toEqual({ suppressed: true, epoch: "2", reason: "bounced" });
  expect(
    (
      await sql(
        "select count(*)::int n from private.reminder_delivery_events where attempt_id=$1",
        [attempt.attemptId],
      )
    )[0].n,
  ).toBe(2);
});
it("ER09 current authorized projection never exposes destination, payload, tokens or provider IDs", async () => {
  const a = await setup(),
    foreign = await practice();
  const projection = await a.client.rpc("get_email_reminder_schedule", {
    p_practice_id: a.practice.id,
    p_namespace: namespace,
    p_after: null,
  });
  expect(projection.error).toBeNull();
  expect(projection.data).toMatchObject({
    emailReadiness: "ready",
    smsOptional: true,
    rows: [{ id: a.credential.id, state: "queued" }],
    preference: { enabled: true, canEnable: true },
  });
  for (const privateValue of [
    a.email,
    "payload",
    "claim_token",
    "provider_id",
    "account_revision",
  ])
    expect(JSON.stringify(projection.data)).not.toContain(privateValue);
  expect(
    (
      await foreign.client.rpc("get_email_reminder_schedule", {
        p_practice_id: a.practice.id,
        p_namespace: namespace,
        p_after: null,
      })
    ).error?.code,
  ).toBe("42501");
});

it("ER11 a held practice/Auth/endpoint lock skips dispatch without consuming permission", async () => {
  for (const table of [
    "public.practices",
    "auth.users",
    "private.reminder_email_endpoints",
  ]) {
    const a = await setup(),
      lease = await claim(a),
      db = await pool.connect();
    try {
      await db.query("begin");
      await db.query(`select 1 from ${table} where id=$1 for update`, [
        table === "public.practices"
          ? a.practice.id
          : table === "auth.users"
            ? a.user.id
            : a.job.endpoint_id,
      ]);
      expect(["unavailable", "busy"]).toContain((await begin(lease!)).status);
      expect(
        (
          await sql(
            "select count(*)::int n from private.reminder_message_attempts where job_id=$1",
            [a.job.id],
          )
        )[0].n,
      ).toBe(0);
      await db.query("commit");
      expect((await begin(lease!)).status).toBe("submit");
    } finally {
      await db.query("rollback");
      db.release();
    }
  }
});
async function observeWait(fragment: string) {
  for (let i = 0; i < 200; i++) {
    if (
      (
        await sql(
          "select 1 from pg_stat_activity where wait_event_type='Lock' and query like $1",
          [`%${fragment}%`],
        )
      ).length
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected a witnessed database lock wait");
}
it("ER12 begin-submit commits first, then a witnessed Auth mutation cannot retract or repeat it", async () => {
  const a = await setup(),
    lease = await claim(a),
    db = await pool.connect();
  try {
    await db.query("begin");
    const attempted = (
      await db.query(
        "select private.begin_email_reminder_at($1,$2,$3,$4) value",
        [lease!.jobId, lease!.token, config, now],
      )
    ).rows[0].value;
    expect(attempted.status).toBe("submit");
    const late = pool.query("update auth.users set email=$1 where id=$2", [
      `fixture-${randomUUID()}@example.test`,
      a.user.id,
    ]);
    await observeWait("update auth.users set email");
    await db.query("commit");
    await late;
    expect((await begin(lease!)).status).toBe("stale");
    expect(
      (
        await sql(
          "select payload from private.reminder_message_attempts where id=$1",
          [attempted.attemptId],
        )
      )[0].payload,
    ).toEqual(attempted.payload);
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("ER13 archive/date/timezone/completion/selection changes revoke pre-submit leases atomically", async () => {
  for (const operation of [
    "archive",
    "date",
    "timezone",
    "complete",
    "clear",
    "disable",
  ] as const) {
    const a = await setup(),
      lease = await claim(a),
      cycle = a.credential.current_cycle;
    if (operation === "archive")
      expect(
        (
          await a.client.rpc("archive_practice_credential", {
            p_practice_id: a.practice.id,
            p_request_id: randomUUID(),
            p_credential_id: a.credential.id,
            p_expected_version: 1,
            p_expected_cycle_id: cycle.id,
            p_expected_date_revision: 1,
          })
        ).error,
      ).toBeNull();
    else if (operation === "date")
      expect(
        (
          await a.client.rpc("update_practice_credential", {
            p_practice_id: a.practice.id,
            p_request_id: randomUUID(),
            p_credential_id: a.credential.id,
            p_expected_version: 1,
            p_expected_cycle_id: cycle.id,
            p_expected_date_revision: 1,
            p_title: a.credential.title,
            p_type: "state_license",
            p_owner_kind: "practice",
            p_owner_clinician_id: null,
            p_covered_clinician_ids: [],
            p_issuer: null,
            p_jurisdiction: null,
            p_end_date: "2030-03-03",
            p_action_deadline: null,
          })
        ).error,
      ).toBeNull();
    else if (operation === "timezone")
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
    else if (operation === "complete")
      await sql(
        "update public.credential_cycles set completed_at=clock_timestamp() where id=$1",
        [cycle.id],
      );
    else if (operation === "clear")
      expect(
        (
          await a.client.rpc("set_practice_reminder_recipient", {
            p_practice_id: a.practice.id,
            p_membership_id: null,
            p_expected_version: 2,
          })
        ).error,
      ).toBeNull();
    else expect((await preference(a, false, 1)).error).toBeNull();
    expect((await begin(lease!)).status).toBe("stale");
    expect(
      (
        await sql(
          "select count(*)::int n from private.reminder_message_attempts where job_id=$1",
          [a.job.id],
        )
      )[0].n,
    ).toBe(0);
    expect(
      await sql(
        "select 1 from private.reminder_reconcile_outbox where practice_id=$1",
        [a.practice.id],
      ),
    ).toHaveLength(1);
  }
});
it("ER14 outbox fault rolls back date, audit, receipt, job invalidation and generation", async () => {
  const a = await setup(),
    cycle = a.credential.current_cycle;
  const snapshot = async () =>
    Promise.all(
      [
        "public.credentials",
        "public.credential_cycles",
        "private.register_audit_events",
        "private.register_change_requests",
        "private.reminder_jobs",
        "private.reminder_job_events",
        "private.reminder_reconcile_outbox",
      ].map((t) =>
        sql(
          `select * from ${t} where practice_id=$1 order by ${t.endsWith("outbox") ? "practice_id" : "id"}`,
          [a.practice.id],
        ),
      ),
    );
  const before = await snapshot();
  await sql(
    "create function private.reminder_outbox_fault() returns trigger language plpgsql as $$begin raise exception 'fixture reminder fault'; end;$$; create trigger reminder_outbox_fault before insert or update on private.reminder_reconcile_outbox for each row execute function private.reminder_outbox_fault()",
  );
  try {
    expect(
      (
        await a.client.rpc("archive_practice_credential", {
          p_practice_id: a.practice.id,
          p_request_id: randomUUID(),
          p_credential_id: a.credential.id,
          p_expected_version: 1,
          p_expected_cycle_id: cycle.id,
          p_expected_date_revision: 1,
        })
      ).error?.code,
    ).toBe("P0001");
    expect(await snapshot()).toEqual(before);
  } finally {
    await sql(
      "drop trigger reminder_outbox_fault on private.reminder_reconcile_outbox; drop function private.reminder_outbox_fault()",
    );
  }
});
it("ER15 latest completed cycle blocks dispatch instead of falling back to an older incomplete cycle", async () => {
  const a = await setup();
  await sql(
    "insert into public.credential_cycles(practice_id,credential_id,cycle_number,end_date,completed_at) values($1,$2,2,'2030-03-02',clock_timestamp())",
    [a.practice.id, a.credential.id],
  );
  const lease = await claim(a);
  expect((await begin(lease!)).status).toBe("stale");
  await sql("select private.dirty_email_reminders($1,'fixture-latest')", [
    a.practice.id,
  ]);
  await reconcile(a.practice.id);
  expect(
    (
      await sql(
        "select reason from private.reminder_jobs where credential_id=$1 order by date_revision,id",
        [a.credential.id],
      )
    ).some((r) => r.reason === "cycle-completed"),
  ).toBe(true);
});
it("ER16 unrelated Auth deletion is allowed and retained as a tombstone", async () => {
  const user = await account();
  await sql("delete from auth.users where id=$1", [user.user.id]);
  expect(
    (
      await sql(
        "select email,confirmed_at,dirty from private.reminder_email_account_state where user_id=$1",
        [user.user.id],
      )
    )[0],
  ).toEqual({ email: null, confirmed_at: null, dirty: true });
});
it("ER17 ordinary delayed work keeps its target and moves to the next local sending window", async () => {
  const a = await setup();
  await sql(
    "update private.reminder_jobs set state='canceled' where practice_id<>$1 and state in ('queued','claimed')",
    [a.practice.id],
  );
  expect(
    (
      await sql<{ value: unknown }>(
        "select private.claim_email_reminder_at('2030-01-01T17:00:00Z') value",
      )
    )[0].value,
  ).toBeNull();
  expect(
    (
      await sql(
        "select nominal_target,next_send_at,state from private.reminder_jobs where id=$1",
        [a.job.id],
      )
    )[0],
  ).toEqual({
    nominal_target: new Date(now),
    next_send_at: new Date("2030-01-02T09:00:00Z"),
    state: "queued",
  });
  const lease = (
    await sql<{ value: { jobId: string; token: string } }>(
      "select private.claim_email_reminder_at('2030-01-02T09:00:00Z') value",
    )
  )[0].value;
  expect(
    (
      await sql<{ value: { status: string } }>(
        "select private.begin_email_reminder_at($1,$2,$3,'2030-01-02T09:00:00Z') value",
        [lease.jobId, lease.token, config],
      )
    )[0].value.status,
  ).toBe("submit");
});

it("ER19 reconciliation persists a hundred-record cursor and read projections paginate", async () => {
  const a = await setup();
  await sql(
    "insert into public.credentials(practice_id,title,type,owner_kind) select $1,'Fixture '||n,'state_license','practice' from generate_series(1,100) n",
    [a.practice.id],
  );
  await sql("select private.dirty_email_reminders($1,'fixture-page')", [
    a.practice.id,
  ]);
  let cursor: unknown;
  for (let i = 0; i < 100; i++) {
    // Isolate this fixture's queue priority from practices created by other suites.
    // Preserve generation/cursor and exercise the same bounded production selector.
    await sql(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [a.practice.id],
    );
    await sql("select private.reconcile_email_reminders_at($1,$2)", [
      namespace,
      now,
    ]);
    const row = (
      await sql(
        "select cursor_id from private.reminder_reconcile_outbox where practice_id=$1",
        [a.practice.id],
      )
    )[0];
    if (row?.cursor_id) {
      cursor = row.cursor_id;
      break;
    }
  }
  expect(cursor).toEqual(expect.any(String));
  expect(
    (
      await sql(
        "select count(*)::int n from private.reminder_jobs where practice_id=$1",
        [a.practice.id],
      )
    )[0].n,
  ).toBe(100);
  await reconcile(a.practice.id);
  expect(
    (
      await sql(
        "select count(*)::int n from private.reminder_jobs where practice_id=$1",
        [a.practice.id],
      )
    )[0].n,
  ).toBe(101);
  const first = await a.client.rpc("get_email_reminder_schedule", {
    p_practice_id: a.practice.id,
    p_namespace: namespace,
    p_after: null,
  });
  expect(first.error).toBeNull();
  expect(first.data.rows).toHaveLength(100);
  expect(first.data.nextCursor).toEqual(expect.any(String));
  const second = await a.client.rpc("get_email_reminder_schedule", {
    p_practice_id: a.practice.id,
    p_namespace: namespace,
    p_after: first.data.nextCursor,
  });
  expect(second.error).toBeNull();
  expect(second.data.rows).toHaveLength(1);
  expect(second.data.nextCursor).toBeNull();
  expect(
    new Set(
      [...first.data.rows, ...second.data.rows].map(
        (r: { id: string }) => r.id,
      ),
    ).size,
  ).toBe(101);
});
it("ER20 begin-submit first makes personal disable wait and retains the consumed message", async () => {
  const a = await setup(),
    lease = await claim(a),
    db = await pool.connect();
  try {
    await db.query("begin");
    const attempted = (
      await db.query(
        "select private.begin_email_reminder_at($1,$2,$3,$4) value",
        [lease!.jobId, lease!.token, config, now],
      )
    ).rows[0].value;
    expect(attempted.status).toBe("submit");
    const late = Promise.resolve(preference(a, false, 1));
    await observeWait("set_my_email_reminder_preference");
    await db.query("commit");
    expect((await late).data).toMatchObject({
      status: "success",
      preference: { enabled: false },
    });
    expect(
      (
        await sql("select state from private.reminder_jobs where id=$1", [
          a.job.id,
        ])
      )[0].state,
    ).toBe("submitting");
    expect(
      (
        await sql(
          "select count(*)::int n from private.reminder_message_attempts where id=$1",
          [attempted.attemptId],
        )
      )[0].n,
    ).toBe(1);
    expect((await begin(lease!)).status).toBe("stale");
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("ER21 uncommitted submission is retryable and suppression cancels other pending jobs sharing its endpoint", async () => {
  const a = await setup();
  const second = await a.client.rpc("create_practice_credential_with_details", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_title: "Another license",
    p_type: "state_license",
    p_owner_kind: "practice",
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [],
    p_issuer: null,
    p_jurisdiction: null,
    p_end_date: "2030-03-02",
    p_action_deadline: null,
  });
  expect(second.error).toBeNull();
  await reconcile(a.practice.id);
  const lease = await claim(a),
    db = await pool.connect(),
    providerId = randomUUID();
  try {
    await db.query("begin");
    const attempted = (
      await db.query(
        "select private.begin_email_reminder_at($1,$2,$3,$4) value",
        [lease!.jobId, lease!.token, config, now],
      )
    ).rows[0].value;
    expect(attempted.status).toBe("submit");
    const late = pool.query(
      "select private.apply_email_reminder_event($1,$2,$3,$4,'complained',$5,$6) value",
      [
        namespace,
        randomUUID(),
        providerId,
        attempted.attemptId,
        config.from,
        a.email,
      ],
    );
    // The attempt is not visible before commit: callback must request retry, never bind by address.
    expect((await late).rows[0].value).toEqual({ status: "unavailable" });
    await db.query("commit");
    expect(
      (
        await sql<{ value: unknown }>(
          "select private.apply_email_reminder_event($1,$2,$3,$4,'complained',$5,$6) value",
          [
            namespace,
            randomUUID(),
            providerId,
            attempted.attemptId,
            config.from,
            a.email,
          ],
        )
      )[0].value,
    ).toEqual({ status: "recorded" });
    expect(
      (
        await sql(
          "select state from private.reminder_jobs where practice_id=$1 and id<>$2",
          [a.practice.id, lease!.jobId],
        )
      )[0].state,
    ).toBe("suppressed");
    expect(
      (
        await sql(
          "select outcome,delivery from private.reminder_message_attempts where id=$1",
          [attempted.attemptId],
        )
      )[0],
    ).toEqual({ outcome: "accepted", delivery: "complained" });
  } finally {
    await db.query("rollback");
    db.release();
  }
});

it("ER22 personal disable survives revoke/rejoin and optional SMS STOP never blocks email", async () => {
  const a = await setup(),
    person = await account();
  const join = await invite(a, person.email, "manager");
  expect(
    (
      await person.client.rpc("accept_practice_invitation", {
        p_token_digest: join.digest,
      })
    ).error,
  ).toBeNull();
  const member = await membership(a.practice.id, person.user.id);
  expect(
    (
      await person.client.rpc("set_my_email_reminder_preference", {
        p_practice_id: a.practice.id,
        p_request_id: randomUUID(),
        p_enabled: false,
        p_expected_version: 1,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        p_membership_id: member.id,
        p_expected_version: 1,
      })
    ).error,
  ).toBeNull();
  const again = await invite(a, person.email, "manager");
  expect(
    (
      await person.client.rpc("accept_practice_invitation", {
        p_token_digest: again.digest,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await person.client.rpc("get_my_email_reminder_preference", {
        p_practice_id: a.practice.id,
      })
    ).data,
  ).toEqual({ enabled: false, version: 2, canEnable: true });
  await sql(
    "select private.apply_sms_provider_opt_out($1,$2,'+12025550999',$3,'STOP')",
    [
      `AC${"1".repeat(32)}`,
      `MG${"2".repeat(32)}`,
      `SM${randomUUID().replaceAll("-", "")}`,
    ],
  );
  const lease = await claim(a);
  expect((await begin(lease!)).status).toBe("submit");
});
it("ER23 consumed failures stay guarded across date revisions and assignment A to B to A", async () => {
  const a = await setup(),
    lease = await claim(a),
    attempted = await begin(lease!),
    person = await account();
  expect(
    (
      await sql<{ value: unknown }>(
        "select private.record_email_reminder($1,$2,'failed',null,'provider-rejected') value",
        [attempted.attemptId, attempted.token],
      )
    )[0].value,
  ).toEqual({ status: "recorded" });
  const invitation = await invite(a, person.email, "manager");
  expect(
    (
      await person.client.rpc("accept_practice_invitation", {
        p_token_digest: invitation.digest,
      })
    ).error,
  ).toBeNull();
  const member = await membership(a.practice.id, person.user.id);
  for (const [membershipId, version] of [
    [member.id, 2],
    [a.member.id, 3],
  ] as const)
    expect(
      (
        await a.client.rpc("set_practice_reminder_recipient", {
          p_practice_id: a.practice.id,
          p_membership_id: membershipId,
          p_expected_version: version,
        })
      ).error,
    ).toBeNull();
  const cycle = a.credential.current_cycle;
  expect(
    (
      await a.client.rpc("update_practice_credential", {
        p_practice_id: a.practice.id,
        p_request_id: randomUUID(),
        p_credential_id: a.credential.id,
        p_expected_version: 1,
        p_expected_cycle_id: cycle.id,
        p_expected_date_revision: 1,
        p_title: a.credential.title,
        p_type: "state_license",
        p_owner_kind: "practice",
        p_owner_clinician_id: null,
        p_covered_clinician_ids: [],
        p_issuer: null,
        p_jurisdiction: null,
        p_end_date: "2030-03-03",
        p_action_deadline: null,
      })
    ).error,
  ).toBeNull();
  await reconcile(a.practice.id);
  expect(
    await sql(
      "select state,reason from private.reminder_jobs where cycle_id=$1 and date_revision=2 and user_id=$2",
      [cycle.id, a.user.id],
    ),
  ).toEqual([{ state: "blocked", reason: "already-attempted" }]);
  expect(await claim(a)).toBeNull();
  expect(
    await sql(
      "select outcome from private.reminder_message_attempts where cycle_id=$1 and user_id=$2",
      [cycle.id, a.user.id],
    ),
  ).toEqual([{ outcome: "failed" }]);
});
it("ER24 generated Gregorian dates preserve sixty calendar days and local nine across supported year bounds", async () => {
  const dates = fc
    .sample(
      fc.tuple(
        fc.integer({ min: 1, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
      ),
      { seed: 20261008, numRuns: 500 },
    )
    .map(
      ([year, month, day]) =>
        `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  dates.push(
    "1900-03-01",
    "2000-03-01",
    "2100-03-01",
    "0001-03-02",
    "9999-12-31",
  );
  const rows = await sql<{
    due: string;
    target: string | null;
    local_hour: number | null;
  }>(
    "select d::text due,to_char(private.reminder_target(d,'UTC') at time zone 'UTC','YYYY-MM-DD') target,extract(hour from private.reminder_target(d,'UTC') at time zone 'UTC')::int local_hour from unnest($1::date[]) d",
    [dates],
  );
  for (const row of rows) {
    if (gregorianOrdinal(row.due) < 61) expect(row.target).toBeNull();
    else {
      expect(gregorianOrdinal(row.target!)).toBe(
        gregorianOrdinal(row.due) - 60,
      );
      expect(row.local_hour).toBe(9);
    }
  }
});

it("ER25 real PostgREST storage stalls terminate within the five-second client deadline", async () => {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ]),
  );
  if (
    env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:55321" ||
    !env.SUPABASE_SECRET_KEY
  )
    throw new Error(
      "RPC stall witness requires guarded local service configuration",
    );
  const signature = "private.expire_email_submissions()";
  const original = (
    await sql<{ definition: string }>(
      "select pg_get_functiondef($1::regprocedure) definition",
      [signature],
    )
  )[0].definition;
  const slow = original.replace("begin", "begin perform pg_sleep(7);");
  expect(slow).not.toBe(original);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("SUPABASE_SECRET_KEY", env.SUPABASE_SECRET_KEY);
  try {
    await sql(slow);
    const started = performance.now();
    const pending = expireReminderSubmissions();
    let sleeping = false;
    for (let i = 0; i < 100; i++) {
      sleeping =
        (
          await sql(
            "select 1 from pg_stat_activity where wait_event='PgSleep' and query like '%expire_email_submissions%' and pid<>pg_backend_pid()",
          )
        ).length > 0;
      if (sleeping) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(sleeping).toBe(true);
    expect(await pending).toBeNull();
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThan(4000);
    expect(elapsed).toBeLessThan(6500);
  } finally {
    vi.unstubAllEnvs();
    await sql(original);
    expect(
      (
        await sql<{ definition: string }>(
          "select pg_get_functiondef($1::regprocedure) definition",
          [signature],
        )
      )[0].definition,
    ).toBe(original);
  }
});
it("ER26 suppression and begin-submit serialize at the endpoint in both orders", async () => {
  for (const order of ["suppression-first", "begin-first"]) {
    const a = await setup(),
      sourceLease = await claim(a),
      source = await begin(sourceLease!);
    const created = await a.client.rpc(
      "create_practice_credential_with_details",
      {
        p_practice_id: a.practice.id,
        p_request_id: randomUUID(),
        p_title: "Endpoint race",
        p_type: "state_license",
        p_owner_kind: "practice",
        p_owner_clinician_id: null,
        p_covered_clinician_ids: [],
        p_issuer: null,
        p_jurisdiction: null,
        p_end_date: "2030-03-02",
        p_action_deadline: null,
      },
    );
    expect(created.error).toBeNull();
    await reconcile(a.practice.id);
    const lease = await claim(a),
      db = await pool.connect(),
      eventId = randomUUID(),
      providerId = randomUUID();
    const eventQuery =
      "select private.apply_email_reminder_event($1,$2,$3,$4,'complained',$5,$6) value";
    const eventArgs = [
      namespace,
      eventId,
      providerId,
      source.attemptId,
      config.from,
      a.email,
    ];
    try {
      await db.query("begin");
      if (order === "suppression-first") {
        expect((await db.query(eventQuery, eventArgs)).rows[0].value).toEqual({
          status: "recorded",
        });
        expect((await begin(lease!)).status).toBe("busy");
        expect(
          (
            await sql(
              "select count(*)::int n from private.reminder_message_attempts where job_id=$1",
              [lease!.jobId],
            )
          )[0].n,
        ).toBe(0);
        await db.query("commit");
        expect((await begin(lease!)).status).toBe("stale");
        expect(
          (
            await sql("select state from private.reminder_jobs where id=$1", [
              lease!.jobId,
            ])
          )[0].state,
        ).toBe("suppressed");
      } else {
        const attempted = (
          await db.query(
            "select private.begin_email_reminder_at($1,$2,$3,$4) value",
            [lease!.jobId, lease!.token, config, now],
          )
        ).rows[0].value;
        expect(attempted.status).toBe("submit");
        const pending = pool.query(eventQuery, eventArgs);
        await observeWait("apply_email_reminder_event");
        await db.query("commit");
        expect((await pending).rows[0].value).toEqual({ status: "recorded" });
        expect(
          (
            await sql("select state from private.reminder_jobs where id=$1", [
              lease!.jobId,
            ])
          )[0].state,
        ).toBe("submitting");
        expect(
          (
            await sql(
              "select count(*)::int n from private.reminder_message_attempts where job_id=$1",
              [lease!.jobId],
            )
          )[0].n,
        ).toBe(1);
        expect((await begin(lease!)).status).toBe("stale");
      }
      expect(
        (
          await sql(
            "select suppressed from private.reminder_email_endpoints where id=$1",
            [a.job.endpoint_id],
          )
        )[0].suppressed,
      ).toBe(true);
    } finally {
      await db.query("rollback");
      db.release();
    }
  }
});
