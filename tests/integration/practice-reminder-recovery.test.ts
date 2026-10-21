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
      p_title: "Private recovery license",
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
    namespace: `recovery-${randomUUID()}`,
    from: "reminders@example.test",
    replyTo: "support@example.test",
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
  return { ...a, member, credential, config, jobId: jobs[0].id, token };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function begin(
  a: Fixture,
  now = instant,
  kind = "fresh",
  token = a.token,
  config = a.config,
) {
  return (
    await sql("select private.begin_email_recovery_at($1,$2,$3,$4,$5) value", [
      a.jobId,
      token,
      config,
      kind,
      now,
    ])
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
  submission: { submissionId: string; token: string },
  kind: string,
  now = instant,
  providerId: string | null = null,
  errorCode: string | null = null,
  retryAfterSeconds: number | null = null,
) {
  return (
    await sql("select private.record_email_submission_at($1,$2,$3,$4) value", [
      submission.submissionId,
      submission.token,
      { kind, providerId, errorCode, retryAfterSeconds },
      now,
    ])
  )[0].value;
}
async function retry(a: Fixture, now: string, config = a.config) {
  // Exercise the same durable job/token gate without claiming unrelated fresh work.
  const token = randomUUID();
  await sql(
    "update private.reminder_jobs set claim_token=$2,claim_until=$3::timestamptz+interval '30 seconds' where id=$1",
    [a.jobId, token, now],
  );
  return begin(a, now, "retry", token, config);
}
async function check(a: Fixture, now: string) {
  return (
    await sql("select private.claim_email_recovery_at($1,false,$2) value", [
      a.config.namespace,
      now,
    ])
  )[0].value;
}
async function observation(
  lease: { checkId: string; token: string },
  now: string,
  status: string | null = null,
  bounced = false,
  matched = true,
) {
  return (
    await sql("select private.record_email_check_at($1,$2,$3,$4) value", [
      lease.checkId,
      lease.token,
      { matched, status, bounced },
      now,
    ])
  )[0].value;
}
async function event(
  a: Fixture,
  id: string,
  providerId: string,
  status: string,
  eventId: string = randomUUID(),
) {
  return (
    await sql(
      "select private.apply_email_reminder_event($1,$2,$3,$4,$5,$6,$7) value",
      [
        a.config.namespace,
        eventId,
        providerId,
        id,
        status,
        a.config.from,
        a.email,
      ],
    )
  )[0].value;
}
async function history(
  a: Fixture,
  actor = a.user.id,
  after: string | null = null,
) {
  return (
    await asUser(
      actor,
      "select public.get_email_reminder_history($1,$2,$3) value",
      [a.practice.id, a.credential.id, after],
    )
  )[0].value;
}

it("DR11 unknown-ID uncertainty remains visible without retry permission", async () => {
  const { rows } = await pool.query(
    "select private.email_recovery_disposition('uncertain',null) value",
  );
  expect(rows[0].value).toBe("review-needed");
});
it("DR03 three rate-limit reservations preserve one frozen payload/key and exhaust permanently", async () => {
  const a = await fixture();
  const first = await begin(a);
  expect(first).toMatchObject({ status: "submit", ordinal: 1 });
  expect(
    new Date(first.expiresAt).getTime() - new Date(instant).getTime(),
  ).toBe(23 * 3600000);
  expect(new Date(first.deadline).getTime()).toBeLessThanOrEqual(
    new Date(first.expiresAt).getTime(),
  );
  let sent = first;
  let now = instant;
  for (let ordinal = 1; ordinal <= 3; ordinal++) {
    expect(sent).toMatchObject({
      status: "submit",
      ordinal,
      attemptId: first.attemptId,
      key: first.key,
      payload: first.payload,
    });
    expect(
      await record(sent, "rate-limited", now, null, "rate_limit_exceeded", 2),
    ).toEqual({ status: "recorded" });
    const row = await attempt(first.attemptId);
    expect(row.post_count).toBe(ordinal);
    if (ordinal < 3) {
      expect(row).toMatchObject({
        recovery_state: "retry-pending",
        retry_due: expect.any(Date),
      });
      expect(row.retry_due.getTime() - new Date(now).getTime()).toBe(
        ordinal === 1 ? 60000 : 300000,
      );
      expect(
        (await retry(a, new Date(row.retry_due.getTime() - 1).toISOString()))
          .status,
      ).not.toBe("submit");
      now = row.retry_due.toISOString();
      sent = await retry(a, now);
    } else {
      expect(row).toMatchObject({
        recovery_state: "exhausted",
        retry_due: null,
      });
      expect((await retry(a, "2030-01-01T11:00:00Z")).status).not.toBe(
        "submit",
      );
    }
  }
  const reservations = await sql(
    "select id,ordinal from private.reminder_email_submissions where attempt_id=$1 order by ordinal",
    [first.attemptId],
  );
  expect(reservations.map((r) => r.ordinal)).toEqual([1, 2, 3]);
  expect(new Set(reservations.map((r) => r.id)).size).toBe(3);
  expect(
    await sql(
      "select id from private.reminder_message_attempts where cycle_id=$1",
      [a.credential.current_cycle.id],
    ),
  ).toHaveLength(1);
});
it("DR03 success after a rejection stops retry and keeps original transport identity", async () => {
  const a = await fixture();
  const first = await begin(a);
  await record(first, "rate-limited", instant, null, "rate_limit_exceeded");
  const pending = await attempt(first.attemptId);
  expect(pending).toMatchObject({
    recovery_state: "retry-pending",
    retry_due: expect.any(Date),
  });
  const second = await retry(a, pending.retry_due.toISOString());
  expect(second).toMatchObject({
    attemptId: first.attemptId,
    key: first.key,
    payload: first.payload,
    ordinal: 2,
  });
  const providerId = randomUUID();
  await record(second, "accepted", "2030-01-01T10:01:01Z", providerId);
  expect(await attempt(first.attemptId)).toMatchObject({
    outcome: "accepted",
    provider_id: providerId,
    recovery_state: "accepted",
    post_count: 2,
    retry_due: null,
  });
  expect((await retry(a, "2030-01-01T11:00:00Z")).status).not.toBe("submit");
});
it("DR04 permanent and uncertain classifications never open another POST permission", async () => {
  for (const [kind, code] of [
    ["permanent", "validation_error"],
    ["permanent", "daily_quota_exceeded"],
    ["permanent", "monthly_quota_exceeded"],
    ["uncertain", "provider_unavailable"],
    ["uncertain", "invalid_response"],
    ["uncertain", "unknown_rate_limit"],
  ]) {
    const a = await fixture(),
      sent = await begin(a);
    await record(sent, kind, instant, null, code);
    expect(await attempt(sent.attemptId)).toMatchObject({
      post_count: 1,
      retry_due: null,
      recovery_state: kind,
    });
    expect((await retry(a, "2030-01-01T11:00:00Z")).status).not.toBe("submit");
    expect(
      await sql(
        "select id from private.reminder_email_submissions where attempt_id=$1",
        [sent.attemptId],
      ),
    ).toHaveLength(1);
  }
});
it("DR06 dirty authority cancels retries even after the original setting is restored", async () => {
  for (const change of ["preference", "email", "archive", "timezone"]) {
    const a = await fixture(),
      sent = await begin(a);
    await record(sent, "rate-limited", instant, null, "rate_limit_exceeded");
    expect(await attempt(sent.attemptId)).toMatchObject({
      recovery_state: "retry-pending",
      retry_due: expect.any(Date),
    });
    if (change === "preference")
      for (const [enabled, version] of [
        [false, 1],
        [true, 2],
      ] as const) {
        expect(
          (
            await a.client.rpc("set_my_email_reminder_preference", {
              p_practice_id: a.practice.id,
              p_request_id: randomUUID(),
              p_enabled: enabled,
              p_expected_version: version,
            })
          ).data.status,
        ).toBe("success");
      }
    if (change === "email") {
      await sql("update auth.users set email=$2 where id=$1", [
        a.user.id,
        `changed-${randomUUID()}@example.test`,
      ]);
      await sql("update auth.users set email=$2 where id=$1", [
        a.user.id,
        a.email,
      ]);
    }
    if (change === "archive") {
      expect(
        (
          await a.client.rpc("archive_practice_credential", {
            p_practice_id: a.practice.id,
            p_request_id: randomUUID(),
            p_credential_id: a.credential.id,
            p_expected_version: a.credential.version,
            p_expected_cycle_id: a.credential.current_cycle.id,
            p_expected_date_revision: a.credential.current_cycle.date_revision,
          })
        ).data.status,
      ).toBe("success");
      await sql("update public.credentials set archived_at=null where id=$1", [
        a.credential.id,
      ]);
    }
    if (change === "timezone")
      for (const [timezone, version] of [
        ["America/Los_Angeles", 1],
        ["UTC", 2],
      ] as const) {
        expect(
          (
            await a.client.rpc("update_practice", {
              p_practice_id: a.practice.id,
              p_name: a.practice.name,
              p_timezone: timezone,
              p_expected_version: version,
            })
          ).error,
        ).toBeNull();
      }
    expect((await retry(a, "2030-01-01T10:01:00Z")).status, change).not.toBe(
      "submit",
    );
    expect(await attempt(sent.attemptId)).toMatchObject({
      recovery_state: "canceled",
      post_count: 1,
      retry_due: null,
    });
    expect(
      await sql(
        "select id from private.reminder_message_attempts where cycle_id=$1",
        [a.credential.current_cycle.id],
      ),
    ).toHaveLength(1);
  }
});
it("DR07 retries retain urgency and reject a midnight change without regenerating copy", async () => {
  for (const [due, urgency] of [
    ["2030-01-02", "future"],
    ["2030-01-01", "today"],
    ["2029-12-31", "past-due"],
  ]) {
    const a = await fixture(due),
      sent = await begin(a);
    expect((await attempt(sent.attemptId)).urgency).toBe(urgency);
    await record(sent, "rate-limited", instant, null, "rate_limit_exceeded");
    const next = await retry(a, "2030-01-01T10:01:00Z");
    expect(next.payload).toEqual(sent.payload);
  }
  const a = await fixture("2030-01-02", "2030-01-01T16:59:00Z");
  const sent = await begin(a, "2030-01-01T16:59:00Z");
  await record(
    sent,
    "rate-limited",
    "2030-01-01T16:59:01Z",
    null,
    "rate_limit_exceeded",
  );
  expect((await attempt(sent.attemptId)).retry_due).toEqual(
    new Date("2030-01-02T09:00:00Z"),
  );
  expect((await retry(a, "2030-01-02T09:00:00Z")).status).not.toBe("submit");
  expect(await attempt(sent.attemptId)).toMatchObject({
    urgency: "future",
    recovery_state: "canceled",
    payload: sent.payload,
    post_count: 1,
  });
});
it("DR08 crashed reservation and absolute expiry stay consumed and cannot replay", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await sql("select private.expire_email_recovery_at($1)", [sent.deadline]);
  expect(await attempt(sent.attemptId)).toMatchObject({
    recovery_state: "uncertain",
    outcome: "uncertain",
    retry_due: null,
    post_count: 1,
  });
  await record(
    sent,
    "rate-limited",
    "2030-01-01T10:00:31Z",
    null,
    "rate_limit_exceeded",
  );
  expect((await retry(a, "2030-01-01T11:00:00Z")).status).not.toBe("submit");
  const b = await fixture(),
    late = await begin(b);
  await record(
    late,
    "rate-limited",
    instant,
    null,
    "rate_limit_exceeded",
    24 * 3600,
  );
  expect(await attempt(late.attemptId)).toMatchObject({
    recovery_state: "expired",
    retry_due: null,
    post_count: 1,
  });
  expect((await retry(b, "2030-01-02T10:00:00Z")).status).not.toBe("submit");
});
it("DR09 callback before retry result and late contradictory evidence remain monotonic", async () => {
  const a = await fixture(),
    first = await begin(a);
  await record(first, "rate-limited", instant, null, "rate_limit_exceeded");
  const second = await retry(a, "2030-01-01T10:01:00Z"),
    providerId = randomUUID(),
    eventId = randomUUID();
  expect(
    await event(a, first.attemptId, providerId, "delivered", eventId),
  ).toEqual({ status: "recorded" });
  await record(
    second,
    "uncertain",
    "2030-01-01T10:01:01Z",
    null,
    "provider_unavailable",
  );
  expect(await attempt(first.attemptId)).toMatchObject({
    outcome: "accepted",
    delivery: "delivered",
    provider_id: providerId,
    retry_due: null,
  });
  expect(
    await event(a, first.attemptId, providerId, "delivered", eventId),
  ).toEqual({ status: "recorded" });
  expect(
    await event(a, first.attemptId, providerId, "failed", eventId),
  ).toEqual({ status: "conflict" });
  await event(a, first.attemptId, providerId, "delayed");
  expect((await attempt(first.attemptId)).delivery).toBe("delivered");
  const events = await sql(
    "select status,anomaly from private.reminder_delivery_events where attempt_id=$1",
    [first.attemptId],
  );
  expect(events).toHaveLength(2);
  expect(events).toContainEqual({ status: "delayed", anomaly: true });
  expect((await retry(a, "2030-01-01T11:00:00Z")).status).not.toBe("submit");
});
it("DR10 bounced polling records failure without suppressing the email endpoint", async () => {
  const a = await fixture(),
    sent = await begin(a),
    providerId = randomUUID();
  await record(sent, "accepted", instant, providerId);
  expect(await check(a, "2030-01-01T10:04:59Z")).toEqual({ status: "idle" });
  const lease = await check(a, "2030-01-01T10:05:00Z");
  expect(lease).toMatchObject({
    kind: "check",
    attemptId: sent.attemptId,
    providerId,
    from: a.config.from,
    to: a.email,
  });
  await observation(lease, "2030-01-01T10:05:01Z", "failed", true);
  expect(await attempt(sent.attemptId)).toMatchObject({
    delivery: "failed",
    post_count: 1,
    check_count: 1,
    retry_due: null,
  });
  expect(
    (
      await sql(
        "select suppressed from private.reminder_email_endpoints where id=$1",
        [(await attempt(sent.attemptId)).endpoint_id],
      )
    )[0].suppressed,
  ).toBe(false);
});
it("DR12 six durable GET reservations survive missing results and exhaust across claims", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "accepted", instant, randomUUID());
  let now = "2030-01-01T10:05:00Z";
  const delays = [15 * 60, 3600, 6 * 3600, 24 * 3600, 72 * 3600];
  for (let ordinal = 1; ordinal <= 6; ordinal++) {
    const lease = await check(a, now);
    expect(lease).toMatchObject({ kind: "check", attemptId: sent.attemptId });
    expect(await check(a, now)).toEqual({ status: "idle" });
    const observed = new Date(new Date(now).getTime() + 31000).toISOString();
    if (ordinal === 2)
      await sql("select private.expire_email_recovery_at($1)", [observed]);
    else await observation(lease, observed, null, false, false);
    const row = await attempt(sent.attemptId);
    expect(row.check_count).toBe(ordinal);
    if (ordinal < 6) {
      expect(row.check_due.getTime() - new Date(observed).getTime()).toBe(
        delays[ordinal - 1] * 1000,
      );
      now = row.check_due.toISOString();
    } else expect(row.check_due).toBeNull();
  }
  expect(await check(a, "2031-01-01T10:00:00Z")).toEqual({ status: "idle" });
  expect(
    await sql(
      "select id from private.reminder_email_checks where attempt_id=$1",
      [sent.attemptId],
    ),
  ).toHaveLength(6);
  expect((await attempt(sent.attemptId)).post_count).toBe(1);
});
it("DR12 check requests preserve immutable receipts and never reset the lifetime budget", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "accepted", instant, randomUUID());
  await sql(
    "update private.reminder_message_attempts set check_due=null,last_check_reserved=clock_timestamp()-interval '16 minutes' where id=$1",
    [sent.attemptId],
  );
  const version = (await attempt(sent.attemptId)).recovery_version,
    requestId = randomUUID();
  const query = "select public.request_email_reminder_check($1,$2,$3,$4) value";
  const values = [a.practice.id, sent.attemptId, requestId, version];
  const receipt = (await asUser(a.user.id, query, values))[0].value;
  expect(receipt).toEqual({ status: "queued" });
  expect((await asUser(a.user.id, query, values))[0].value).toEqual(receipt);
  expect(
    (
      await asUser(a.user.id, query, [
        a.practice.id,
        sent.attemptId,
        requestId,
        version + 1,
      ])
    )[0].value,
  ).toEqual({ status: "request-conflict" });
  expect(
    (
      await asUser(a.user.id, query, [
        a.practice.id,
        sent.attemptId,
        randomUUID(),
        version + 1,
      ])
    )[0].value,
  ).toEqual({ status: "cooldown" });
  await sql(
    "update private.reminder_message_attempts set check_count=6,check_due=null where id=$1",
    [sent.attemptId],
  );
  expect(
    (
      await asUser(a.user.id, query, [
        a.practice.id,
        sent.attemptId,
        randomUUID(),
        version + 1,
      ])
    )[0].value,
  ).toEqual({ status: "exhausted" });
  expect((await asUser(a.user.id, query, values))[0].value).toEqual(receipt);
  expect(
    await sql(
      "select id from private.reminder_email_checks where attempt_id=$1",
      [sent.attemptId],
    ),
  ).toHaveLength(0);
});
it("DR01 archived and former-recipient history retains tenant and privacy boundaries", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "uncertain", instant, null, "provider_unavailable");
  expect(
    (
      await a.client.rpc("set_practice_reminder_recipient", {
        p_practice_id: a.practice.id,
        p_membership_id: null,
        p_expected_version: 2,
      })
    ).error,
  ).toBeNull();
  await sql(
    "update public.credentials set archived_at=clock_timestamp() where id=$1",
    [a.credential.id],
  );
  const result = await history(a);
  expect(result).toMatchObject({
    status: "success",
    credential: { id: a.credential.id, archived: true },
  });
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    attemptId: sent.attemptId,
    recipient: "former",
    recovery: { disposition: "review-needed" },
  });
  const timeline = (
    await asUser(
      a.user.id,
      "select public.get_email_reminder_timeline($1,$2,$3) value",
      [a.practice.id, sent.attemptId, null],
    )
  )[0].value;
  expect(timeline).toMatchObject({ status: "success" });
  expect(timeline.rows.length).toBeGreaterThan(0);
  expect(timeline.rows.length).toBeLessThanOrEqual(50);
  for (const forbidden of [
    a.email,
    a.user.id,
    sent.token,
    sent.key,
    a.config.namespace,
    "payload",
    "providerId",
    "endpointId",
  ]) {
    expect(JSON.stringify(result)).not.toContain(forbidden);
    expect(JSON.stringify(timeline)).not.toContain(forbidden);
  }
  const foreign = await practice();
  await expect(history(a, foreign.user.id)).rejects.toMatchObject({
    code: "42501",
  });
  await expect(
    asUser(null, "select public.get_email_reminder_history($1,$2,$3)", [
      a.practice.id,
      a.credential.id,
      null,
    ]),
  ).rejects.toMatchObject({ code: "42501" });
  const viewer = await account(),
    invitation = await invite(a, viewer.email, "viewer");
  expect(
    (
      await viewer.client.rpc("accept_practice_invitation", {
        p_token_digest: invitation.digest,
      })
    ).error,
  ).toBeNull();
  expect((await history(a, viewer.user.id)).status).toBe("success");
  await expect(
    asUser(
      viewer.user.id,
      "select public.request_email_reminder_check($1,$2,$3,$4)",
      [
        a.practice.id,
        sent.attemptId,
        randomUUID(),
        (await attempt(sent.attemptId)).recovery_version,
      ],
    ),
  ).rejects.toMatchObject({ code: "42501" });
  const member = await membership(a.practice.id, viewer.user.id);
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        p_membership_id: member.id,
        p_expected_version: 1,
      })
    ).error,
  ).toBeNull();
  await expect(history(a, viewer.user.id)).rejects.toMatchObject({
    code: "42501",
  });
});
it("DR02 legacy permission retains its exact shape and never gains recovery reservations", async () => {
  const a = await fixture();
  const sent = (
    await sql("select private.begin_email_reminder_at($1,$2,$3,$4) value", [
      a.jobId,
      a.token,
      a.config,
      instant,
    ])
  )[0].value;
  expect(Object.keys(sent).sort()).toEqual(
    ["status", "attemptId", "token", "payload", "key"].sort(),
  );
  expect(await attempt(sent.attemptId)).toMatchObject({
    recovery_state: "legacy",
    post_count: 0,
    retry_due: null,
    retry_expires: null,
    check_count: 0,
    check_due: null,
    app_origin: null,
    urgency: null,
  });
  await sql(
    "select private.record_email_reminder($1,$2,'uncertain',null,'provider-unavailable')",
    [sent.attemptId, sent.token],
  );
  expect((await retry(a, "2030-01-01T11:00:00Z")).status).not.toBe("submit");
  expect(
    await sql(
      "select id from private.reminder_email_submissions where attempt_id=$1",
      [sent.attemptId],
    ),
  ).toHaveLength(0);
  const v1 = await a.client.rpc("get_email_reminder_schedule", {
    p_practice_id: a.practice.id,
    p_namespace: a.config.namespace,
  });
  const v2 = await a.client.rpc("get_email_reminder_schedule_v2", {
    p_practice_id: a.practice.id,
    p_namespace: a.config.namespace,
  });
  expect(v1.error).toBeNull();
  expect(v2.error).toBeNull();
  const keys = [
    "id",
    "title",
    "cycleId",
    "dueDate",
    "datePurpose",
    "timezone",
    "target",
    "nextSendAt",
    "state",
    "delivery",
    "reason",
  ];
  expect(Object.keys(v1.data.rows[0]).sort()).toEqual(keys.sort());
  expect(Object.keys(v2.data.rows[0]).sort()).toEqual(
    [...keys, "scheduleKind", "dispatchTarget"].sort(),
  );
});
it("DR18 recovery health is a bounded read-only aggregate without transport identities", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "uncertain", instant, null, "provider_unavailable");
  const snapshot = () =>
    sql(
      "select (select count(*) from private.reminder_email_submissions) submissions,(select count(*) from private.reminder_email_checks) checks,(select count(*) from private.reminder_message_attempts) attempts",
    );
  const before = await snapshot();
  const query = readFileSync(
    "supabase/operators/email-reminders-recovery-health.sql",
    "utf8",
  ).replace("REPLACE_WITH_PROVIDER_NAMESPACE", a.config.namespace);
  const results = await pool.query(query);
  const rows = (results as unknown as { rows: unknown[] }[]).flatMap(
    (r) => r.rows,
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const forbidden of [
    a.email,
    a.user.id,
    a.practice.id,
    a.credential.id,
    sent.attemptId,
    sent.token,
    sent.key,
    "payload",
    "providerId",
  ])
    expect(JSON.stringify(rows)).not.toContain(forbidden);
  expect(await snapshot()).toEqual(before);
});
it("DR10 finalized unmatched GET observations cannot be changed by replay", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "accepted", instant, randomUUID());
  const lease = await check(a, "2030-01-01T10:05:00Z");
  await observation(lease, "2030-01-01T10:05:01Z", null, false, false);
  const before = await attempt(sent.attemptId);
  await observation(lease, "2030-01-01T10:05:02Z", "suppressed");
  const after = await attempt(sent.attemptId);
  expect(after.delivery).toBe(before.delivery);
  expect(after.recovery_version).toBe(before.recovery_version);
  expect(
    (
      await sql(
        "select suppressed from private.reminder_email_endpoints where id=$1",
        [after.endpoint_id],
      )
    )[0].suppressed,
  ).toBe(false);
  expect(
    (
      await sql(
        "select result from private.reminder_email_checks where id=$1",
        [lease.checkId],
      )
    )[0].result,
  ).toEqual({ matched: false, status: null, bounced: false });
});
it("DR04 current configuration and closed local windows cannot authorize retries", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "rate-limited", instant, null, "rate_limit_exceeded");
  expect((await retry(a, "2030-01-01T17:00:00Z")).status).toBe("window-closed");
  expect((await attempt(sent.attemptId)).post_count).toBe(1);
  expect(
    (
      await retry(a, "2030-01-01T10:01:00Z", {
        ...a.config,
        appUrl: "http://127.0.0.1:3001",
      })
    ).status,
  ).not.toBe("submit");
  expect(await attempt(sent.attemptId)).toMatchObject({
    post_count: 1,
    recovery_state: "canceled",
    retry_due: null,
    payload: sent.payload,
  });
});
it("DR01 foreign cursor anchors cannot reveal another record's history or timeline", async () => {
  const a = await fixture(),
    sent = await begin(a),
    foreign = await fixture(),
    foreignSent = await begin(foreign);
  expect(await history(a, a.user.id, foreign.jobId)).toEqual({
    status: "not-found",
  });
  const timelineQuery =
    "select public.get_email_reminder_timeline($1,$2,$3) value";
  const foreignTimeline = (
    await asUser(foreign.user.id, timelineQuery, [
      foreign.practice.id,
      foreignSent.attemptId,
      null,
    ])
  )[0].value;
  const anchor = foreignTimeline.rows[0];
  expect(
    (
      await asUser(a.user.id, timelineQuery, [
        a.practice.id,
        sent.attemptId,
        { id: anchor.id, source: anchor.source, observedAt: anchor.observedAt },
      ])
    )[0].value,
  ).toEqual({ status: "not-found" });
  expect(
    (
      await asUser(a.user.id, timelineQuery, [
        a.practice.id,
        foreignSent.attemptId,
        null,
      ])
    )[0].value,
  ).toEqual({ status: "not-found" });
});
it("DR13 ordinary roles cannot call private recovery reservation helpers", async () => {
  const functions = await sql(
    "select p.oid::regprocedure::text signature,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any($1::text[])",
    [
      [
        "begin_email_recovery_at",
        "record_email_submission_at",
        "claim_email_recovery_at",
        "record_email_check_at",
        "expire_email_recovery_at",
      ],
    ],
  );
  expect(functions).toHaveLength(5);
  for (const row of functions)
    expect(row).toMatchObject({ anon: false, authenticated: false });
});
it("DR01 timeline pagination preserves every source and uses opaque delivery cursors", async () => {
  const a = await fixture(),
    sent = await begin(a),
    providerId = randomUUID();
  await record(sent, "accepted", instant, providerId);
  const providerEvents = Array.from(
    { length: 55 },
    () => `provider-event-${randomUUID()}`,
  );
  for (const eventId of providerEvents)
    await event(a, sent.attemptId, providerId, "sent", eventId);
  const query = "select public.get_email_reminder_timeline($1,$2,$3) value";
  const first = (
    await asUser(a.user.id, query, [a.practice.id, sent.attemptId, null])
  )[0].value;
  expect(first.rows).toHaveLength(50);
  expect(Object.keys(first.nextCursor).sort()).toEqual([
    "id",
    "observedAt",
    "source",
  ]);
  const second = (
    await asUser(a.user.id, query, [
      a.practice.id,
      sent.attemptId,
      first.nextCursor,
    ])
  )[0].value;
  expect(second.rows.length).toBeGreaterThan(0);
  expect(second.nextCursor).toBeNull();
  const rows = [...first.rows, ...second.rows];
  expect(rows.filter((row) => row.source === "delivery")).toHaveLength(55);
  expect(new Set(rows.map((row) => `${row.source}/${row.id}`)).size).toBe(
    rows.length,
  );
  for (const providerEvent of providerEvents)
    expect(JSON.stringify({ first, second })).not.toContain(providerEvent);
});
it("DR08 a null retry lease never grants submission permission", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "rate-limited", instant, null, "rate_limit_exceeded");
  const result = (
    await sql(
      "select private.begin_email_recovery_at($1,null,$2,'retry',$3) value",
      [a.jobId, a.config, "2030-01-01T10:01:00Z"],
    )
  )[0].value;
  expect(result.status).not.toBe("submit");
  expect((await attempt(sent.attemptId)).post_count).toBe(1);
  expect(
    await sql(
      "select id from private.reminder_email_submissions where attempt_id=$1",
      [sent.attemptId],
    ),
  ).toHaveLength(1);
});
it("DR08 expiration closes pending retries while sending is disabled", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "rate-limited", instant, null, "rate_limit_exceeded");
  await sql("select private.expire_email_recovery_at($1)", [sent.expiresAt]);
  expect(await attempt(sent.attemptId)).toMatchObject({
    recovery_state: "expired",
    retry_due: null,
    post_count: 1,
  });
  expect(await check(a, "2030-01-02T10:00:00Z")).toEqual({ status: "idle" });
});
it("DR05/DR08 the absolute retry expiry denies permission before the expiry sweep", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "rate-limited", instant, null, "rate_limit_exceeded");
  expect(await attempt(sent.attemptId)).toMatchObject({
    recovery_state: "retry-pending",
    retry_due: expect.any(Date),
  });
  // UTC 09:00 is inside the allowed window; only the absolute cap denies this lease.
  expect(sent.expiresAt).toBe("2030-01-02T09:00:00+00:00");
  expect((await retry(a, sent.expiresAt)).status).not.toBe("submit");
  expect(await attempt(sent.attemptId)).toMatchObject({
    recovery_state: "expired",
    post_count: 1,
    retry_due: null,
  });
  expect(
    await sql(
      "select id from private.reminder_email_submissions where attempt_id=$1",
      [sent.attemptId],
    ),
  ).toHaveLength(1);
});
it("DR12 a first manual check expedites the initial automatic schedule without spending a reservation", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "accepted", instant, randomUUID());
  await sql(
    "update private.reminder_message_attempts set check_due=clock_timestamp()+interval '5 minutes' where id=$1",
    [sent.attemptId],
  );
  const before = await attempt(sent.attemptId),
    requestId = randomUUID();
  const args = [
    a.practice.id,
    sent.attemptId,
    requestId,
    before.recovery_version,
  ];
  const query = "select public.request_email_reminder_check($1,$2,$3,$4) value";
  expect((await asUser(a.user.id, query, args))[0].value).toEqual({
    status: "queued",
  });
  const queued = await attempt(sent.attemptId);
  expect(queued.check_due.getTime()).toBeLessThan(before.check_due.getTime());
  expect(queued.check_count).toBe(0);
  expect(
    await sql(
      "select id from private.reminder_email_checks where attempt_id=$1",
      [sent.attemptId],
    ),
  ).toHaveLength(0);
  const lease = await check(
    a,
    new Date(queued.check_due.getTime() + 1).toISOString(),
  );
  expect(lease).toMatchObject({ kind: "check", attemptId: sent.attemptId });
  expect((await attempt(sent.attemptId)).check_count).toBe(1);
  expect((await asUser(a.user.id, query, args))[0].value).toEqual({
    status: "queued",
  });
  expect((await attempt(sent.attemptId)).check_count).toBe(1);
});
it("DR12 manual checks expedite future automatic work only after cooldown", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "accepted", instant, randomUUID());
  for (const now of ["2030-01-01T10:05:00Z", "2030-01-01T10:20:01Z"]) {
    const lease = await check(a, now);
    await observation(
      lease,
      new Date(new Date(now).getTime() + 1000).toISOString(),
      null,
      false,
      false,
    );
  }
  // Public requests use the real server clock; map the observed schedule to that clock.
  await sql(
    "update private.reminder_message_attempts set last_check_reserved=clock_timestamp()-interval '14 minutes',check_due=clock_timestamp()+interval '40 minutes' where id=$1",
    [sent.attemptId],
  );
  const query = "select public.request_email_reminder_check($1,$2,$3,$4) value";
  const before = await attempt(sent.attemptId);
  expect(
    (
      await asUser(a.user.id, query, [
        a.practice.id,
        sent.attemptId,
        randomUUID(),
        before.recovery_version,
      ])
    )[0].value,
  ).toEqual({ status: "cooldown" });
  expect((await attempt(sent.attemptId)).check_due).toEqual(before.check_due);
  await sql(
    "update private.reminder_message_attempts set last_check_reserved=clock_timestamp()-interval '16 minutes' where id=$1",
    [sent.attemptId],
  );
  expect(
    (
      await asUser(a.user.id, query, [
        a.practice.id,
        sent.attemptId,
        randomUUID(),
        before.recovery_version,
      ])
    )[0].value,
  ).toEqual({ status: "queued" });
  const queued = await attempt(sent.attemptId);
  expect(queued.check_count).toBe(2);
  expect(queued.check_due.getTime()).toBeLessThan(before.check_due.getTime());
  expect(
    await sql(
      "select id from private.reminder_email_checks where attempt_id=$1",
      [sent.attemptId],
    ),
  ).toHaveLength(2);
});
it("DR08 late acceptance repairs known identity without rewriting an expired reservation", async () => {
  const a = await fixture(),
    sent = await begin(a),
    providerId = randomUUID();
  await sql("select private.expire_email_recovery_at($1)", [sent.deadline]);
  const evidence = (
    await sql(
      "select result,observed_at from private.reminder_email_submissions where id=$1",
      [sent.submissionId],
    )
  )[0];
  expect(evidence.result).toEqual({ kind: "uncertain", reason: "expired" });
  expect(
    await record(sent, "accepted", "2030-01-01T10:00:31Z", providerId),
  ).toEqual({ status: "recorded" });
  expect(await attempt(sent.attemptId)).toMatchObject({
    outcome: "accepted",
    provider_id: providerId,
    recovery_state: "accepted",
    post_count: 1,
    retry_due: null,
  });
  expect(
    (
      await sql(
        "select result,observed_at from private.reminder_email_submissions where id=$1",
        [sent.submissionId],
      )
    )[0],
  ).toEqual(evidence);
  expect(
    await sql(
      "select operation from private.reminder_job_events where job_id=$1 and operation='late-acceptance-recorded'",
      [a.jobId],
    ),
  ).toHaveLength(1);
  await record(sent, "accepted", "2030-01-01T10:00:32Z", providerId);
  expect(
    await sql(
      "select operation from private.reminder_job_events where job_id=$1 and operation='late-acceptance-recorded'",
      [a.jobId],
    ),
  ).toHaveLength(1);
  expect((await retry(a, "2030-01-01T11:00:00Z")).status).not.toBe("submit");
});
it("DR03 finalized submission outcomes are immutable on contradictory replay", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "permanent", instant, null, "validation_error");
  const evidence = (
    await sql(
      "select result,observed_at from private.reminder_email_submissions where id=$1",
      [sent.submissionId],
    )
  )[0];
  await record(
    sent,
    "rate-limited",
    "2030-01-01T10:00:01Z",
    null,
    "rate_limit_exceeded",
  );
  expect(
    (
      await sql(
        "select result,observed_at from private.reminder_email_submissions where id=$1",
        [sent.submissionId],
      )
    )[0],
  ).toEqual(evidence);
  expect(await attempt(sent.attemptId)).toMatchObject({
    recovery_state: "permanent",
    outcome: "failed",
    post_count: 1,
    retry_due: null,
  });
});
it("DR01 timeline record binding rejects another credential in the same practice", async () => {
  const a = await fixture(),
    first = await begin(a);
  const created = await a.client.rpc(
    "create_practice_credential_with_details",
    {
      p_practice_id: a.practice.id,
      p_request_id: randomUUID(),
      p_title: "Another private recovery license",
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
  const credential = created.data.credential;
  await sql("update public.credential_cycles set updated_at=$2 where id=$1", [
    credential.current_cycle.id,
    instant,
  ]);
  for (let page = 0; page < 100; page++) {
    await sql(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [a.practice.id],
    );
    await sql("select private.reconcile_email_reminders_at($1,$2)", [
      a.config.namespace,
      instant,
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
  const job = (
    await sql("select id from private.reminder_jobs where credential_id=$1", [
      credential.id,
    ])
  )[0];
  const token = randomUUID();
  await sql(
    "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3::timestamptz+interval '30 seconds' where id=$1",
    [job.id, token, instant],
  );
  const second = await begin({ ...a, credential, jobId: job.id, token });
  expect(second.status).toBe("submit");
  const query = "select public.get_email_reminder_timeline($1,$2,$3,$4) value";
  expect(
    (
      await asUser(a.user.id, query, [
        a.practice.id,
        second.attemptId,
        null,
        a.credential.id,
      ])
    )[0].value,
  ).toEqual({ status: "not-found" });
  expect(
    (
      await asUser(a.user.id, query, [
        a.practice.id,
        first.attemptId,
        null,
        credential.id,
      ])
    )[0].value,
  ).toEqual({ status: "not-found" });
  expect(
    (
      await asUser(a.user.id, query, [
        a.practice.id,
        second.attemptId,
        null,
        credential.id,
      ])
    )[0].value.status,
  ).toBe("success");
  expect(
    (
      await asUser(a.user.id, query, [
        a.practice.id,
        first.attemptId,
        null,
        a.credential.id,
      ])
    )[0].value.status,
  ).toBe("success");
  expect(
    (
      await asUser(
        a.user.id,
        "select public.get_email_reminder_timeline($1,$2,$3) value",
        [a.practice.id, first.attemptId, null],
      )
    )[0].value.status,
  ).toBe("success");
});
it("DR10 contradictory terminal polling keeps stronger delivery evidence and records an anomaly", async () => {
  const a = await fixture(),
    sent = await begin(a),
    providerId = randomUUID();
  await record(sent, "accepted", instant, providerId);
  // The GET was already reserved when terminal callback evidence arrived.
  const lease = await check(a, "2030-01-01T10:05:00Z");
  expect(lease).toMatchObject({ kind: "check", attemptId: sent.attemptId });
  expect(await event(a, sent.attemptId, providerId, "delivered")).toEqual({
    status: "recorded",
  });
  expect(await observation(lease, "2030-01-01T10:05:01Z", "failed")).toEqual({
    status: "recorded",
  });
  expect(await attempt(sent.attemptId)).toMatchObject({
    outcome: "accepted",
    delivery: "delivered",
    post_count: 1,
    retry_due: null,
  });
  expect(
    (
      await sql(
        "select result,anomaly from private.reminder_email_checks where id=$1",
        [lease.checkId],
      )
    )[0],
  ).toEqual({
    result: { matched: true, status: "failed", bounced: false },
    anomaly: true,
  });
  const timeline = (
    await asUser(
      a.user.id,
      "select public.get_email_reminder_timeline($1,$2,$3) value",
      [a.practice.id, sent.attemptId, null],
    )
  )[0].value;
  expect(timeline.rows).toContainEqual(
    expect.objectContaining({
      source: "check",
      operation: "failed",
      anomaly: true,
    }),
  );
});
async function additionalCredential(a: Fixture) {
  const created = await a.client.rpc(
    "create_practice_credential_with_details",
    {
      p_practice_id: a.practice.id,
      p_request_id: randomUUID(),
      p_title: "Another terminal campaign license",
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
  const credential = created.data.credential;
  await sql("update public.credential_cycles set updated_at=$2 where id=$1", [
    credential.current_cycle.id,
    instant,
  ]);
  for (let page = 0; page < 100; page++) {
    await sql(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [a.practice.id],
    );
    await sql("select private.reconcile_email_reminders_at($1,$2)", [
      a.config.namespace,
      instant,
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
  const job = (
      await sql("select id from private.reminder_jobs where credential_id=$1", [
        credential.id,
      ])
    )[0],
    token = randomUUID();
  await sql(
    "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3::timestamptz+interval '30 seconds' where id=$1",
    [job.id, token, instant],
  );
  return { ...a, credential, jobId: job.id, token };
}
async function manual(a: Fixture, attemptId: string) {
  return (
    await asUser(
      a.user.id,
      "select public.request_email_reminder_check($1,$2,$3,$4) value",
      [
        a.practice.id,
        attemptId,
        randomUUID(),
        (await attempt(attemptId)).recovery_version,
      ],
    )
  )[0].value;
}
it("DR12 terminal callback delivery closes automatic and manual checks", async () => {
  const a = await fixture(),
    sent = await begin(a),
    providerId = randomUUID();
  await record(sent, "accepted", instant, providerId);
  expect((await attempt(sent.attemptId)).check_due).not.toBeNull();
  await event(a, sent.attemptId, providerId, "delivered");
  expect(await attempt(sent.attemptId)).toMatchObject({
    delivery: "delivered",
    check_due: null,
    check_count: 0,
  });
  expect(await manual(a, sent.attemptId)).toEqual({ status: "complete" });
  expect((await history(a)).rows[0].recovery.canCheck).toBe(false);
  expect(await check(a, "2030-01-01T11:00:00Z")).toEqual({ status: "idle" });
});
it("DR12 terminal polled delivery closes the automatic campaign", async () => {
  const a = await fixture(),
    sent = await begin(a);
  await record(sent, "accepted", instant, randomUUID());
  const lease = await check(a, "2030-01-01T10:05:00Z");
  await observation(lease, "2030-01-01T10:05:01Z", "delivered");
  expect(await attempt(sent.attemptId)).toMatchObject({
    delivery: "delivered",
    check_due: null,
    check_count: 1,
  });
  expect(await manual(a, sent.attemptId)).toEqual({ status: "complete" });
  expect(await check(a, "2030-01-01T11:00:00Z")).toEqual({ status: "idle" });
});
it("DR12 terminal complaint or suppression closes checks for other attempts on the endpoint", async () => {
  for (const terminal of ["complained", "suppressed"]) {
    const a = await fixture(),
      first = await begin(a),
      firstProvider = randomUUID();
    await record(first, "accepted", instant, firstProvider);
    const b = await additionalCredential(a),
      second = await begin(b);
    await record(second, "accepted", instant, randomUUID());
    const before = await attempt(second.attemptId);
    expect(before.endpoint_id).toBe(
      (await attempt(first.attemptId)).endpoint_id,
    );
    expect(before.check_due).not.toBeNull();
    await event(a, first.attemptId, firstProvider, terminal);
    expect(await attempt(first.attemptId)).toMatchObject({
      delivery: terminal,
      check_due: null,
      check_count: 0,
    });
    expect(await attempt(second.attemptId)).toMatchObject({
      delivery: null,
      check_due: null,
      check_count: 0,
    });
    expect(await manual(b, second.attemptId)).toEqual({ status: "complete" });
    expect((await history(b)).rows[0].recovery.canCheck).toBe(false);
    expect(await check(a, "2030-01-01T11:00:00Z")).toEqual({ status: "idle" });
  }
});
it("DR12 check expiry after terminal callback cannot restart the campaign", async () => {
  const a = await fixture(),
    sent = await begin(a),
    providerId = randomUUID();
  await record(sent, "accepted", instant, providerId);
  const lease = await check(a, "2030-01-01T10:05:00Z");
  await event(a, sent.attemptId, providerId, "delivered");
  await sql("select private.expire_email_recovery_at($1)", [lease.deadline]);
  expect(await attempt(sent.attemptId)).toMatchObject({
    delivery: "delivered",
    check_count: 1,
    check_due: null,
  });
  expect(
    (
      await sql(
        "select result from private.reminder_email_checks where id=$1",
        [lease.checkId],
      )
    )[0].result,
  ).toEqual({ matched: false, status: null, bounced: false });
  expect(await check(a, "2030-01-01T11:00:00Z")).toEqual({ status: "idle" });
});
