import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, it } from "vitest";
import {
  membership,
  pool,
  practice,
  account,
  fixtureWrite,
} from "../helpers/access-fixtures";

afterEach(async () => {
  await pool.query(
    "update private.gmail_reminder_authority set enabled=false where enabled",
  );
});
const instant = "2030-01-01T10:00:00Z";
afterAll(() => pool.end());
async function sql(query: string, values: unknown[] = []) {
  return (await pool.query(query, values)).rows;
}
async function asUser(
  userId: string | null,
  query: string,
  values: unknown[] = [],
) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      userId ?? "",
    ]);
    await db.query(
      userId ? "set local role authenticated" : "set local role anon",
    );
    const result = (await db.query(query, values)).rows;
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}
async function fixture(due = "2030-03-02", now = instant) {
  // This suite performs the operator's sending-off transition against shared fixtures.
  // Retire old synthetic leases (some inherited cases use 2090) before selecting Gmail.
  await sql("select private.expire_email_submissions_at('2100-01-01')");
  await sql("select private.expire_gmail_reminders_at('2100-01-01')");
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
      p_title: "Private Gmail pilot license",
      p_type: "state_license",
      p_owner_kind: "practice",
      p_owner_clinician_id: null,
      p_covered_clinician_ids: [],
      p_issuer: null,
      p_jurisdiction: null,
      p_end_date: due,
      p_action_deadline: null,
    },
  );
  expect(created.error).toBeNull();
  const credential = created.data.credential;
  const config = {
    namespace: `gmail-${randomUUID()}`,
    from: a.email,
    replyTo: a.email,
    appUrl: "http://127.0.0.1:3000",
  };
  await sql("update public.credential_cycles set updated_at=$2 where id=$1", [
    credential.current_cycle.id,
    now,
  ]);
  await sql("select private.dirty_email_reminders($1,'fixture-recovery')", [
    a.practice.id,
  ]);
  for (let i = 0; i < 100; i++) {
    await sql(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [a.practice.id],
    );
    await sql("select private.reconcile_email_reminders_at($1,$2)", [
      config.namespace,
      now,
    ]);
    if (
      !(
        await sql(
          "select 1 from private.reminder_reconcile_outbox where practice_id=$1",
          [a.practice.id],
        )
      ).length
    )
      break;
  }
  const jobs = await sql(
    "select j.* from private.reminder_jobs j join private.reminder_email_endpoints e on e.id=j.endpoint_id where j.credential_id=$1 and e.provider_namespace=$2",
    [credential.id, config.namespace],
  );
  expect(jobs).toHaveLength(1);
  // A targeted lease keeps the fixture independent of other suites' ready jobs.
  const token = randomUUID();
  await sql(
    "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3::timestamptz+interval '30 seconds' where id=$1",
    [jobs[0].id, token, now],
  );
  await sql(
    "update private.gmail_reminder_authority set enabled=false where enabled",
  );
  await sql(
    "insert into private.gmail_reminder_authority(namespace,sender,subject,allowed_recipient,app_origin,enabled) values($1,$2,'google-subject',$2,$3,true)",
    [config.namespace, a.email, config.appUrl],
  );
  return { ...a, member, credential, config, jobId: jobs[0].id, token };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function begin(
  a: Fixture,
  subject = "google-subject",
  version = 1,
  now = instant,
) {
  return (
    await sql(
      "select private.begin_gmail_reminder_at($1,$2,$3,$4,$5,$6) value",
      [a.jobId, a.token, a.config, subject, version, now],
    )
  )[0].value;
}
async function attempt(id: string) {
  return (
    await sql("select * from private.reminder_message_attempts where id=$1", [
      id,
    ])
  )[0];
}
async function record(
  s: { attemptId: string; token: string },
  outcome = "accepted",
  id: string | null = "19a8df0b21",
  now = instant,
) {
  return (
    await sql(
      "select private.record_gmail_reminder_at($1,$2,$3,$4,null,$5) value",
      [s.attemptId, s.token, outcome, id, now],
    )
  )[0].value;
}
it("GM03 real Gmail ID stays separate; one reservation; matching record replay only", async () => {
  const a = await fixture(),
    s = await begin(a);
  expect(s.status).toBe("submit");
  expect(await record(s)).toEqual({ status: "recorded" });
  expect(await record(s)).toEqual({ status: "recorded" });
  expect(await record(s, "accepted", "different-id")).toEqual({
    status: "conflict",
  });
  expect(await record(s, "uncertain", null)).toEqual({ status: "conflict" });
  expect(await attempt(s.attemptId)).toMatchObject({
    provider_kind: "gmail",
    provider_id: null,
    gmail_message_id: "19a8df0b21",
    post_count: 1,
    retry_due: null,
    check_due: null,
    delivery: null,
  });
  expect(
    await sql(
      "select id from private.reminder_job_events where job_id=$1 and operation='gmail-result-accepted'",
      [a.jobId],
    ),
  ).toHaveLength(1);
  expect((await begin(a)).status).not.toBe("submit");
});
it("GM04 committed permission survives expiry and permits late actual acceptance without another POST", async () => {
  const a = await fixture(),
    s = await begin(a);
  await sql("select private.expire_gmail_reminders_at($1)", [s.deadline]);
  expect(await attempt(s.attemptId)).toMatchObject({
    outcome: "uncertain",
    gmail_message_id: null,
    post_count: 1,
  });
  expect((await begin(a)).status).not.toBe("submit");
  expect(
    await record(s, "accepted", "real-late-id", "2030-01-01T10:00:31Z"),
  ).toEqual({ status: "recorded" });
  await sql("select private.expire_gmail_reminders_at($1)", [
    "2030-01-01T11:00:00Z",
  ]);
  expect(await attempt(s.attemptId)).toMatchObject({
    outcome: "accepted",
    gmail_message_id: "real-late-id",
    post_count: 1,
  });
});
it("GM06 mismatched authority subject/version or recipient consumes nothing", async () => {
  const a = await fixture();
  expect((await begin(a, "wrong-subject")).status).toBe("unavailable");
  expect((await begin(a, "google-subject", 2)).status).toBe("unavailable");
  await sql(
    "update private.gmail_reminder_authority set sender='other@example.test',allowed_recipient='other@example.test' where namespace=$1",
    [a.config.namespace],
  );
  expect((await begin(a, "google-subject", 2)).status).not.toBe("submit");
  expect(
    await sql(
      "select id from private.reminder_message_attempts where job_id=$1",
      [a.jobId],
    ),
  ).toHaveLength(0);
});
it("GM07 Gmail has no callback/check/retry capability; older history shapes remain exact", async () => {
  const a = await fixture(),
    s = await begin(a);
  await record(s);
  expect(
    (
      await sql(
        "select private.email_check_open(a) value from private.reminder_message_attempts a where id=$1",
        [s.attemptId],
      )
    )[0].value,
  ).toBe(false);
  expect(
    (
      await sql("select private.claim_email_recovery_at($1,true,$2) value", [
        a.config.namespace,
        "2030-01-01T11:00:00Z",
      ])
    )[0].value,
  ).not.toMatchObject({ attemptId: s.attemptId });
  expect(
    (
      await sql(
        "select private.apply_email_reminder_event($1,'forged',$2,$3,'delivered',$4,$4) value",
        [a.config.namespace, randomUUID(), s.attemptId, a.email],
      )
    )[0].value.status,
  ).toBe("unavailable");
  const old = (
    await asUser(
      a.user.id,
      "select public.get_email_reminder_history($1,$2,null) value",
      [a.practice.id, a.credential.id],
    )
  )[0].value;
  const current = (
    await asUser(
      a.user.id,
      "select public.get_email_reminder_history_v2($1,$2,null) value",
      [a.practice.id, a.credential.id],
    )
  )[0].value;
  expect(old.rows[0]).not.toHaveProperty("provider");
  expect(current.rows[0].provider).toEqual({
    kind: "gmail",
    maxPosts: 1,
    automaticResend: false,
    deliveryChecks: false,
  });
  const foreign = await practice();
  await expect(
    asUser(
      foreign.user.id,
      "select public.get_email_reminder_history_v2($1,$2,null)",
      [a.practice.id, a.credential.id],
    ),
  ).rejects.toThrow();
});
it("GM06 consumed namespace cannot be rebound; authenticated/service roles cannot configure authority", async () => {
  const a = await fixture();
  await begin(a);
  await expect(
    sql(
      "update private.gmail_reminder_authority set subject='different' where namespace=$1",
      [a.config.namespace],
    ),
  ).rejects.toThrow("cannot be rebound");
  await expect(
    asUser(
      a.user.id,
      "update private.gmail_reminder_authority set enabled=false",
    ),
  ).rejects.toThrow();
  const grants = await sql(
    "select has_table_privilege('service_role','private.gmail_reminder_authority','UPDATE') allowed",
  );
  expect(grants[0].allowed).toBe(false);
});
it("GM04 uncommitted begin consumes nothing and a later begin is permitted", async () => {
  const a = await fixture(),
    db = await pool.connect();
  try {
    await db.query("begin");
    expect(
      (
        await db.query(
          "select private.begin_gmail_reminder_at($1,$2,$3,'google-subject',1,$4) value",
          [a.jobId, a.token, a.config, instant],
        )
      ).rows[0].value.status,
    ).toBe("submit");
    await db.query("rollback");
  } finally {
    db.release();
  }
  expect(
    await sql(
      "select id from private.reminder_message_attempts where job_id=$1",
      [a.jobId],
    ),
  ).toHaveLength(0);
  expect((await begin(a)).status).toBe("submit");
});
it("GM04 simultaneous begins consume exactly one permission", async () => {
  const a = await fixture(),
    outcomes = await Promise.all([begin(a), begin(a)]);
  expect(outcomes.filter((s) => s.status === "submit")).toHaveLength(1);
  expect(
    await sql(
      "select id from private.reminder_message_attempts where job_id=$1",
      [a.jobId],
    ),
  ).toHaveLength(1);
});
it("GM04 wrong result token cannot attach a provider identity", async () => {
  const a = await fixture(),
    s = await begin(a);
  expect(await record({ ...s, token: randomUUID() })).toEqual({
    status: "stale",
  });
  expect(await attempt(s.attemptId)).toMatchObject({
    outcome: "submitting",
    gmail_message_id: null,
  });
});
it("GM04 operator transition invalidates only unconsumed jobs and cannot reset a consumed guard", async () => {
  const a = await fixture();
  await sql(
    "update private.gmail_reminder_authority set enabled=false where namespace=$1",
    [a.config.namespace],
  );
  expect(
    (
      await sql("select private.prepare_gmail_reminders($1,$2) value", [
        a.practice.id,
        a.config.namespace,
      ])
    )[0].value.status,
  ).toBe("prepared");
  expect(
    (
      await sql(
        "select state,claim_token from private.reminder_jobs where id=$1",
        [a.jobId],
      )
    )[0],
  ).toEqual({ state: "canceled", claim_token: null });
  expect(
    await sql(
      "select practice_id from private.reminder_reconcile_outbox where practice_id=$1",
      [a.practice.id],
    ),
  ).toHaveLength(1);
  await sql(
    "update private.gmail_reminder_authority set enabled=true where namespace=$1",
    [a.config.namespace],
  );
  await sql(
    "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
    [a.practice.id],
  );
  await sql("select private.reconcile_email_reminders_at($1,$2)", [
    a.config.namespace,
    instant,
  ]);
  const token = randomUUID();
  await sql(
    "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3::timestamptz+interval '30 seconds' where id=$1",
    [a.jobId, token, instant],
  );
  const s = await begin({ ...a, token }, "google-subject", 3);
  expect(s.status).toBe("submit");
  await record(s);
  const consumed = await attempt(s.attemptId),
    job = (
      await sql("select * from private.reminder_jobs where id=$1", [a.jobId])
    )[0];
  await sql(
    "update private.gmail_reminder_authority set enabled=false where namespace=$1",
    [a.config.namespace],
  );
  expect(
    (
      await sql("select private.prepare_gmail_reminders($1,$2) value", [
        a.practice.id,
        a.config.namespace,
      ])
    )[0].value.status,
  ).toBe("prepared");
  expect(await attempt(s.attemptId)).toEqual(consumed);
  expect(
    (
      await sql("select * from private.reminder_jobs where id=$1", [a.jobId])
    )[0],
  ).toEqual(job);
  expect(
    (
      await sql(
        "select has_function_privilege('service_role','private.prepare_gmail_reminders(uuid,text)','execute') value",
      )
    )[0].value,
  ).toBe(false);
});
it("GM06 a namespace already consumed by Resend cannot be registered as Gmail", async () => {
  const a = await fixture();
  await sql("delete from private.gmail_reminder_authority where namespace=$1", [
    a.config.namespace,
  ]);
  const s = (
    await sql("select private.begin_email_reminder_at($1,$2,$3,$4) value", [
      a.jobId,
      a.token,
      a.config,
      instant,
    ])
  )[0].value;
  expect(s.status).toBe("submit");
  await expect(
    sql(
      "insert into private.gmail_reminder_authority(namespace,sender,subject,allowed_recipient,app_origin) values($1,$2,'google-subject',$2,$3)",
      [a.config.namespace, a.email, a.config.appUrl],
    ),
  ).rejects.toThrow("cannot be rebound");
});
it("GM06 durable allowlist blocks an otherwise matching worker configuration before consumption", async () => {
  const a = await fixture(),
    sender = "different@example.test";
  await sql(
    "update private.gmail_reminder_authority set sender=$2,allowed_recipient=$2 where namespace=$1",
    [a.config.namespace, sender],
  );
  const worker = {
    ...a,
    config: { ...a.config, from: sender, replyTo: sender },
  };
  expect((await begin(worker, "google-subject", 2)).status).not.toBe("submit");
  expect(
    await sql(
      "select id from private.reminder_message_attempts where job_id=$1",
      [a.jobId],
    ),
  ).toHaveLength(0);
  const schedule = (
    await asUser(
      a.user.id,
      "select public.get_email_reminder_schedule_v4($1,$2,null) value",
      [a.practice.id, a.config.namespace],
    )
  )[0].value;
  expect(schedule.emailReadiness).toBe("gmail-recipient-blocked");
});
it.each([
  "archive",
  "completed",
  "date",
  "timezone",
  "preference",
  "demotion",
  "revocation",
  "email",
])(
  "GM06 live %s change after claim denies permission before consumption",
  async (change) => {
    const a = await fixture();
    if (["demotion", "revocation"].includes(change)) {
      const backup = await account();
      await sql(
        "insert into public.practice_memberships(practice_id,user_id,role,state) values($1,$2,'administrator','active')",
        [a.practice.id, backup.user.id],
      );
    }
    const changes: Record<string, [string, unknown[]]> = {
      archive: [
        "update public.credentials set archived_at=clock_timestamp() where id=$1",
        [a.credential.id],
      ],
      completed: [
        "update public.credential_cycles set completed_at=clock_timestamp() where id=$1",
        [a.credential.current_cycle.id],
      ],
      date: [
        "update public.credential_cycles set date_revision=date_revision+1 where id=$1",
        [a.credential.current_cycle.id],
      ],
      timezone: [
        "update public.practices set timezone='America/Los_Angeles' where id=$1",
        [a.practice.id],
      ],
      preference: [
        "insert into private.reminder_email_preferences(practice_id,user_id,enabled) values($1,$2,false) on conflict(practice_id,user_id) do update set enabled=false,version=reminder_email_preferences.version+1",
        [a.practice.id, a.user.id],
      ],
      demotion: [
        "update public.practice_memberships set role='viewer',version=version+1 where id=$1",
        [a.member.id],
      ],
      revocation: [
        "update public.practice_memberships set state='revoked',revoked_at=clock_timestamp(),version=version+1 where id=$1",
        [a.member.id],
      ],
      email: [
        "update auth.users set email=$2 where id=$1",
        [a.user.id, `fixture-changed-${randomUUID()}@example.test`],
      ],
    };
    await fixtureWrite(a.user.id, ...changes[change]);
    expect((await begin(a)).status).not.toBe("submit");
    expect(
      await sql(
        "select id from private.reminder_message_attempts where job_id=$1",
        [a.jobId],
      ),
    ).toHaveLength(0);
  },
);
it("GM07 schedule V4 and timeline V2 use stored capability while preserving old readers", async () => {
  const a = await fixture(),
    s = await begin(a);
  await record(s);
  const args = [a.practice.id, a.config.namespace, null];
  const old = (
    await asUser(
      a.user.id,
      "select public.get_email_reminder_schedule_v3($1,$2,$3) value",
      args,
    )
  )[0].value;
  const current = (
    await asUser(
      a.user.id,
      "select public.get_email_reminder_schedule_v4($1,$2,$3) value",
      args,
    )
  )[0].value;
  expect(old.rows[0]).not.toHaveProperty("provider");
  expect(current.rows[0].provider.kind).toBe("gmail");
  const timeline = (
    await asUser(
      a.user.id,
      "select public.get_email_reminder_timeline_v2($1,$2,null,$3) value",
      [a.practice.id, s.attemptId, a.credential.id],
    )
  )[0].value;
  expect(timeline.provider).toEqual(current.rows[0].provider);
  expect(
    timeline.rows.some(
      (r: { operation: string }) => r.operation === "gmail-result-accepted",
    ),
  ).toBe(true);
});
