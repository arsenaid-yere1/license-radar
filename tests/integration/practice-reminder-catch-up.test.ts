import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { anonymous } from "../helpers/local-fixtures";
import { afterAll, expect, it } from "vitest";
import fc from "fast-check";
import {
  account,
  invite,
  membership,
  pool,
  practice,
} from "../helpers/access-fixtures";
import { emailPayloadSchema } from "@/lib/reminders/messages";

afterAll(() => pool.end());
const namespace = "fixture-reminders";
const instant = "2030-01-01T10:00:00Z";
const config = {
  namespace,
  from: "reminders@example.test",
  replyTo: "support@example.test",
  appUrl: "http://127.0.0.1:3000",
};
async function sql(query: string, values: unknown[] = []) {
  return (await pool.query(query, values)).rows;
}
async function fixture(
  onset = instant,
  end: string | null = "2030-03-02",
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
      p_title: "Private <license>",
      p_type: "state_license",
      p_owner_kind: "practice",
      p_owner_clinician_id: null,
      p_covered_clinician_ids: [],
      p_issuer: null,
      p_jurisdiction: null,
      p_end_date: end,
      p_action_deadline: deadline,
    },
  );
  expect(created.error).toBeNull();
  const credential = created.data.credential;
  await sql("update public.credential_cycles set updated_at=$2 where id=$1", [
    credential.current_cycle.id,
    onset,
  ]);
  return { ...a, member, credential };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function context(a: Fixture, now = instant) {
  return (
    await sql("select private.email_reminder_context($1,$2,$3,$4) value", [
      a.practice.id,
      a.credential.id,
      namespace,
      now,
    ])
  )[0].value;
}
async function reconcile(a: Fixture, now = instant) {
  await sql("select private.dirty_email_reminders($1,'fixture-catch-up')", [
    a.practice.id,
  ]);
  for (let i = 0; i < 100; i++) {
    await sql(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [a.practice.id],
    );
    await sql("select private.reconcile_email_reminders_at($1,$2)", [
      namespace,
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
      return;
  }
  throw new Error("Catch-up fixture reconciliation did not finish");
}
async function claim(a: Fixture, now = instant) {
  await sql(
    "update private.reminder_jobs set state='canceled',claim_token=null,claim_until=null where practice_id<>$1 and state in ('queued','claimed')",
    [a.practice.id],
  );
  return (
    await sql("select private.claim_email_reminder_at($1) value", [now])
  )[0].value as { jobId: string; token: string } | null;
}
async function begin(lease: { jobId: string; token: string }, now = instant) {
  return (
    await sql("select private.begin_email_reminder_at($1,$2,$3,$4) value", [
      lease.jobId,
      lease.token,
      config,
      now,
    ])
  )[0].value;
}
async function changeDate(a: Fixture, end: string) {
  const c = (
    await sql(
      "select c.version,y.id,y.date_revision from public.credentials c join public.credential_cycles y on y.credential_id=c.id where c.id=$1",
      [a.credential.id],
    )
  )[0];
  const result = await a.client.rpc("update_practice_credential", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: a.credential.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.id,
    p_expected_date_revision: c.date_revision,
    p_title: a.credential.title,
    p_type: "state_license",
    p_owner_kind: "practice",
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [],
    p_issuer: null,
    p_jurisdiction: null,
    p_end_date: end,
    p_action_deadline: null,
  });
  expect(result.error).toBeNull();
  expect(result.data.status).toBe("success");
}

it("CU01 before-target eligibility stays normal; late eligibility catches up", async () => {
  for (const [onset, kind, target] of [
    ["2030-01-01T08:59:59Z", "normal", "2030-01-01T09:00:00+00:00"],
    ["2030-01-01T09:00:00Z", "normal", "2030-01-01T09:00:00+00:00"],
    ["2030-01-01T09:00:01Z", "catch-up", "2030-01-01T09:00:01+00:00"],
  ]) {
    const a = await fixture(onset);
    expect(await context(a)).toMatchObject({
      reason: null,
      scheduleKind: kind,
      dispatchTarget: target,
    });
  }
});
it("CU02 sixty-day/date-purpose boundary matrix", async () => {
  for (const [date, kind] of [
    ["2030-03-03", "normal"],
    ["2030-03-02", "catch-up"],
    ["2030-03-01", "catch-up"],
    ["2030-01-01", "catch-up"],
    ["2029-12-31", "catch-up"],
  ]) {
    const a = await fixture(instant, date);
    expect(await context(a)).toMatchObject({
      dueDate: date,
      scheduleKind: kind,
      reason: null,
    });
  }
  const deadline = await fixture(instant, "2030-03-03", "2030-01-01");
  expect(await context(deadline)).toMatchObject({
    dueDate: "2030-01-01",
    datePurpose: "action-deadline",
    scheduleKind: "catch-up",
  });
  const missing = await fixture(instant, null);
  expect(await context(missing)).toMatchObject({
    dueDate: null,
    target: null,
    dispatchTarget: null,
    reason: "missing-date",
  });
});
it("CU03 next permitted local instant", async () => {
  const cases = [
    ["2030-01-01T08:59:59Z", "UTC", "2030-01-01T09:00:00.000Z"],
    ["2030-01-01T09:00:00Z", "UTC", "2030-01-01T09:00:00.000Z"],
    ["2030-01-01T16:59:59Z", "UTC", "2030-01-01T16:59:59.000Z"],
    ["2030-01-01T17:00:00Z", "UTC", "2030-01-02T09:00:00.000Z"],
    ["2030-01-01T17:00:00Z", "Asia/Kathmandu", "2030-01-02T03:15:00.000Z"],
    ["2030-01-01T16:59:59Z", "America/Los_Angeles", "2030-01-01T17:00:00.000Z"],
    ["2028-03-12T01:00:00Z", "America/Los_Angeles", "2028-03-12T16:00:00.000Z"],
    ["2028-11-05T00:00:00Z", "America/Los_Angeles", "2028-11-05T17:00:00.000Z"],
    ["2026-04-04T07:00:00Z", "Australia/Lord_Howe", "2026-04-04T22:30:00.000Z"],
    ["2028-02-29T17:00:00Z", "UTC", "2028-03-01T09:00:00.000Z"],
    ["2030-12-31T17:00:00Z", "UTC", "2031-01-01T09:00:00.000Z"],
    ["2011-12-30T03:00:00Z", "Pacific/Apia", "2011-12-30T19:00:00.000Z"],
  ];
  for (const [target, zone, expected] of cases) {
    const actual = (
      await sql("select private.reminder_next_window($1,$2,$1) value", [
        target,
        zone,
      ])
    )[0].value;
    expect(actual?.toISOString()).toBe(expected);
  }
  const generated = fc.sample(fc.integer({ min: 0, max: 86399 }), {
    seed: 20261009,
    numRuns: 100,
  });
  for (const seconds of generated) {
    const target = new Date(Date.UTC(2030, 0, 1) + seconds * 1000);
    const actual = (
      await sql("select private.reminder_next_window($1,'UTC',$1) value", [
        target,
      ])
    )[0].value as Date;
    expect(actual.getTime()).toBeGreaterThanOrEqual(target.getTime());
    expect(actual.getUTCHours()).toBeGreaterThanOrEqual(9);
    expect(actual.getUTCHours()).toBeLessThan(17);
    expect(actual.getTime()).toBeLessThanOrEqual(target.getTime() + 86400000);
    const expected =
      seconds < 9 * 3600
        ? Date.UTC(2030, 0, 1, 9)
        : seconds < 17 * 3600
          ? target.getTime()
          : Date.UTC(2030, 0, 2, 9);
    expect(actual.getTime()).toBe(expected);
  }
});
it("CU04 repeated scans retain target and one logical job", async () => {
  const a = await fixture();
  await reconcile(a);
  const before = (
    await sql("select * from private.reminder_jobs where credential_id=$1", [
      a.credential.id,
    ])
  )[0];
  expect(before).toMatchObject({
    schedule_kind: "catch-up",
    state: "queued",
    dispatch_target: new Date(instant),
  });
  await reconcile(a, "2030-01-02T11:00:00Z");
  const jobs = await sql(
    "select * from private.reminder_jobs where credential_id=$1",
    [a.credential.id],
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    id: before.id,
    schedule_kind: "catch-up",
    dispatch_target: new Date(instant),
    next_send_at: new Date("2030-01-02T11:00:00Z"),
  });
  expect(
    await sql(
      "select operation from private.reminder_job_events where job_id=$1 and operation='catch-up-scheduled'",
      [before.id],
    ),
  ).toHaveLength(1);
});
it("CU05 delayed ordinary work remains ordinary", async () => {
  const a = await fixture("2030-01-01T08:00:00Z");
  await reconcile(a, "2030-01-01T17:00:00Z");
  expect(
    (
      await sql("select * from private.reminder_jobs where credential_id=$1", [
        a.credential.id,
      ])
    )[0],
  ).toMatchObject({
    schedule_kind: "normal",
    nominal_target: new Date("2030-01-01T09:00:00Z"),
    dispatch_target: new Date("2030-01-01T09:00:00Z"),
    next_send_at: new Date("2030-01-02T09:00:00Z"),
  });
  expect(await claim(a, "2030-01-01T17:00:00Z")).toBeNull();
});
it("CU06 reassignment grants only a new recipient's first attempt", async () => {
  const a = await fixture();
  await reconcile(a);
  const first = await claim(a);
  expect(first).not.toBeNull();
  const submitted = await begin(first!);
  expect(submitted.status).toBe("submit");
  const person = await account(),
    invitation = await invite(a, person.email, "manager");
  expect(
    (
      await person.client.rpc("accept_practice_invitation", {
        p_token_digest: invitation.digest,
      })
    ).error,
  ).toBeNull();
  const member = await membership(a.practice.id, person.user.id);
  expect(
    (
      await a.client.rpc("set_practice_reminder_recipient", {
        p_practice_id: a.practice.id,
        p_membership_id: member.id,
        p_expected_version: 2,
      })
    ).error,
  ).toBeNull();
  await reconcile(a);
  const second = await claim(a);
  expect(second).not.toBeNull();
  expect((await begin(second!)).payload.to).toEqual([person.email]);
  expect(
    (
      await a.client.rpc("set_practice_reminder_recipient", {
        p_practice_id: a.practice.id,
        p_membership_id: a.member.id,
        p_expected_version: 3,
      })
    ).error,
  ).toBeNull();
  await reconcile(a);
  expect((await context(a)).reason).toBe("already-attempted");
  expect(await claim(a)).toBeNull();
  expect(
    await sql(
      "select user_id from private.reminder_message_attempts where cycle_id=$1",
      [a.credential.current_cycle.id],
    ),
  ).toHaveLength(2);
});
it("CU07 date correction replaces only unconsumed work", async () => {
  const a = await fixture();
  await reconcile(a);
  const stale = await claim(a);
  expect(stale).not.toBeNull();
  await changeDate(a, "2030-04-01");
  expect((await begin(stale!)).status).toBe("stale");
  await reconcile(a);
  expect(await context(a)).toMatchObject({
    scheduleKind: "normal",
    reason: null,
  });
  await changeDate(a, "2030-01-01");
  await reconcile(a);
  const lease = await claim(a);
  expect(lease).not.toBeNull();
  const submitted = await begin(lease!);
  expect(submitted.status).toBe("submit");
  await sql(
    "select private.record_email_reminder($1,$2,'failed',null,'provider-rejected')",
    [submitted.attemptId, submitted.token],
  );
  await changeDate(a, "2030-01-02");
  await reconcile(a);
  expect((await context(a)).reason).toBe("already-attempted");
  expect(await claim(a)).toBeNull();
  expect(
    await sql(
      "select payload from private.reminder_message_attempts where cycle_id=$1",
      [a.credential.current_cycle.id],
    ),
  ).toEqual([{ payload: submitted.payload }]);
});
it("CU12 frozen catch-up copy has accurate urgency", async () => {
  for (const [due, copy] of [
    ["2030-01-02", "This renewal is due on 2030-01-02."],
    ["2030-01-01", "This renewal is due today."],
    ["2029-12-31", "This renewal is past due."],
  ]) {
    const a = await fixture(instant, due);
    await reconcile(a);
    const lease = await claim(a);
    expect(lease).not.toBeNull();
    const submitted = await begin(lease!);
    expect(submitted.status).toBe("submit");
    expect(submitted.payload.subject).toBe(
      "Credential renewal catch-up reminder",
    );
    expect(submitted.payload.text).toContain(copy);
    expect(submitted.payload.html).toContain(copy);
    expect(submitted.payload.text).not.toContain(a.credential.title);
    expect(submitted.payload.html).not.toContain(a.credential.title);
    expect(emailPayloadSchema.safeParse(submitted.payload).success).toBe(true);
    const attempt = (
      await sql("select * from private.reminder_message_attempts where id=$1", [
        submitted.attemptId,
      ])
    )[0];
    expect(attempt).toMatchObject({
      schedule_kind: "catch-up",
      dispatch_target: new Date(instant),
    });
  }
});
it("CU14 v1/v2 projections preserve tenant and payload boundaries", async () => {
  expect(
    (
      await sql(
        "select to_regprocedure('public.get_email_reminder_schedule_v2(uuid,text,uuid)') value",
      )
    )[0].value,
  ).not.toBeNull();
  const a = await fixture();
  await reconcile(a);
  const old = await a.client.rpc("get_email_reminder_schedule", {
    p_practice_id: a.practice.id,
    p_namespace: namespace,
  });
  expect(old.error).toBeNull();
  expect(Object.keys(old.data.rows[0]).sort()).toEqual(
    [
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
    ].sort(),
  );
  const result = await a.client.rpc("get_email_reminder_schedule_v2", {
    p_practice_id: a.practice.id,
    p_namespace: namespace,
  });
  expect(result.error).toBeNull();
  expect(result.data.rows[0]).toMatchObject({
    scheduleKind: "catch-up",
    dispatchTarget: "2030-01-01T10:00:00+00:00",
  });
  for (const privateValue of [a.email, "payload", "providerId", "claim_token"])
    expect(JSON.stringify(result.data)).not.toContain(privateValue);
  const foreign = await practice();
  expect(
    (
      await foreign.client.rpc("get_email_reminder_schedule_v2", {
        p_practice_id: a.practice.id,
        p_namespace: namespace,
      })
    ).error?.code,
  ).toBe("42501");
});
it("CU08 confirmation and preference reenabling establish persisted onset without no-op drift", async () => {
  const a = await fixture("2000-01-01T00:00:00Z", "2026-03-02");
  await sql("update auth.users set email_confirmed_at=null where id=$1", [
    a.user.id,
  ]);
  expect((await context(a)).reason).toBe("email-unconfirmed");
  await sql(
    "update auth.users set email_confirmed_at=clock_timestamp() where id=$1",
    [a.user.id],
  );
  const confirmed = await context(a);
  expect(confirmed).toMatchObject({ reason: null, scheduleKind: "catch-up" });
  const before = (
    await sql(
      "select * from private.reminder_email_account_state where user_id=$1",
      [a.user.id],
    )
  )[0];
  await sql(
    "update auth.users set raw_user_meta_data='{\"note\":\"metadata\"}',email_change='pending@example.test' where id=$1",
    [a.user.id],
  );
  expect(
    (
      await sql(
        "select * from private.reminder_email_account_state where user_id=$1",
        [a.user.id],
      )
    )[0],
  ).toEqual(before);
  for (const [enabled, version] of [
    [false, 1],
    [true, 2],
  ] as const) {
    const result = await a.client.rpc("set_my_email_reminder_preference", {
      p_practice_id: a.practice.id,
      p_request_id: randomUUID(),
      p_enabled: enabled,
      p_expected_version: version,
    });
    expect(result.data.status).toBe("success");
    expect((await context(a)).reason).toBe(enabled ? null : "email-disabled");
  }
  const onset = (await context(a)).eligibleSince;
  const request = {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_enabled: true,
    p_expected_version: 3,
  };
  expect(
    (await a.client.rpc("set_my_email_reminder_preference", request)).data
      .status,
  ).toBe("success");
  expect(
    (await a.client.rpc("set_my_email_reminder_preference", request)).data
      .status,
  ).toBe("success");
  expect((await context(a)).eligibleSince).toBe(onset);
});
it("CU09 catch-up authority changes before begin revoke stale leases; begin first retains frozen permission", async () => {
  for (const first of ["change", "begin"]) {
    for (const change of [
      "email",
      "preference",
      "archive",
      "completion",
      "timezone",
      "suppression",
    ]) {
      const a = await fixture();
      await reconcile(a);
      const lease = await claim(a);
      expect(lease).not.toBeNull();
      const submitted = first === "begin" ? await begin(lease!) : null;
      if (submitted) expect(submitted.status).toBe("submit");
      if (change === "email")
        await sql("update auth.users set email=$2 where id=$1", [
          a.user.id,
          `fixture-${randomUUID()}@example.test`,
        ]);
      if (change === "preference")
        expect(
          (
            await a.client.rpc("set_my_email_reminder_preference", {
              p_practice_id: a.practice.id,
              p_request_id: randomUUID(),
              p_enabled: false,
              p_expected_version: 1,
            })
          ).data.status,
        ).toBe("success");
      if (change === "archive")
        await sql(
          "update public.credentials set archived_at=clock_timestamp() where id=$1",
          [a.credential.id],
        );
      if (change === "completion")
        await sql(
          "update public.credential_cycles set completed_at=clock_timestamp() where id=$1",
          [a.credential.current_cycle.id],
        );
      if (change === "timezone")
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
      if (change === "suppression")
        await sql(
          "update private.reminder_email_endpoints set suppressed=true,epoch=epoch+1,reason='complained' where email=$1",
          [a.email],
        );
      if (first === "change")
        expect((await begin(lease!)).status).toBe("stale");
      else expect((await begin(lease!)).status).toBe("stale");
      const attempts = await sql(
        "select payload from private.reminder_message_attempts where cycle_id=$1",
        [a.credential.current_cycle.id],
      );
      expect(attempts).toEqual(
        submitted ? [{ payload: submitted.payload }] : [],
      );
      await reconcile(a);
      if (
        first === "begin" ||
        ["preference", "archive", "completion", "suppression"].includes(change)
      )
        expect(await claim(a)).toBeNull();
      else expect(await claim(a, (await context(a)).nextSendAt)).not.toBeNull();
    }
  }
});
it("CU10 interrupted catch-up scans, generation resets and expired claims recover without skipped work", async () => {
  const a = await fixture();
  for (let i = 0; i < 101; i++) {
    const created = await a.client.rpc(
      "create_practice_credential_with_details",
      {
        p_practice_id: a.practice.id,
        p_request_id: randomUUID(),
        p_title: `Recovery ${i}`,
        p_type: "state_license",
        p_owner_kind: "practice",
        p_owner_clinician_id: null,
        p_covered_clinician_ids: [],
        p_issuer: null,
        p_jurisdiction: null,
        p_end_date: "2030-01-01",
        p_action_deadline: null,
      },
    );
    expect(created.data.status).toBe("success");
  }
  await sql(
    "update public.credential_cycles set updated_at=$2 where practice_id=$1",
    [a.practice.id, instant],
  );
  await sql(
    "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
    [a.practice.id],
  );
  await sql("select private.reconcile_email_reminders_at($1,$2)", [
    namespace,
    instant,
  ]);
  expect(
    (
      await sql(
        "select cursor_id from private.reminder_reconcile_outbox where practice_id=$1",
        [a.practice.id],
      )
    )[0].cursor_id,
  ).not.toBeNull();
  for (let page = 0; page < 2; page++) {
    await sql(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [a.practice.id],
    );
    await sql("select private.reconcile_email_reminders_at($1,$2)", [
      namespace,
      instant,
    ]);
  }
  expect(
    await sql(
      "select id from private.reminder_jobs where practice_id=$1 and schedule_kind='catch-up'",
      [a.practice.id],
    ),
  ).toHaveLength(102);
  const page = await a.client.rpc("get_email_reminder_schedule_v2", {
    p_practice_id: a.practice.id,
    p_namespace: namespace,
  });
  expect(page.error).toBeNull();
  expect(page.data.rows).toHaveLength(100);
  const rest = await a.client.rpc("get_email_reminder_schedule_v2", {
    p_practice_id: a.practice.id,
    p_namespace: namespace,
    p_after: page.data.nextCursor,
  });
  expect(rest.error).toBeNull();
  expect(rest.data.rows).toHaveLength(2);
  expect(
    new Set(
      [...page.data.rows, ...rest.data.rows].map((r: { id: string }) => r.id),
    ).size,
  ).toBe(102);
  const first = await claim(a);
  expect(first).not.toBeNull();
  const second = await claim(a, "2030-01-01T10:00:31Z");
  expect(second?.jobId).toBe(first!.jobId);
  expect(second?.token).not.toBe(first!.token);
  expect((await begin(first!, "2030-01-01T10:00:31Z")).status).toBe("stale");
  expect((await begin(second!, "2030-01-01T10:00:31Z")).status).toBe("submit");
});
it("CU14 consumed v2 scheduling stays frozen when current dates and timezone change", async () => {
  const a = await fixture();
  await reconcile(a);
  const lease = await claim(a);
  const sent = await begin(lease!);
  expect(sent.status).toBe("submit");
  await changeDate(a, "2030-04-01");
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
  const result = await a.client.rpc("get_email_reminder_schedule_v2", {
    p_practice_id: a.practice.id,
    p_namespace: namespace,
  });
  expect(result.error).toBeNull();
  expect(result.data.rows[0]).toMatchObject({
    dueDate: "2030-04-01",
    timezone: "UTC",
    target: "2030-01-01T09:00:00+00:00",
    dispatchTarget: "2030-01-01T10:00:00+00:00",
    scheduleKind: "catch-up",
    state: "submitting",
  });
});

it("CU09 snapshot drift rejects catch-up permission even without another invalidation", async () => {
  const a = await fixture();
  await reconcile(a);
  const lease = await claim(a);
  expect(lease).not.toBeNull();
  await sql(
    "update private.reminder_jobs set dispatch_target=dispatch_target-interval '1 second' where id=$1",
    [lease!.jobId],
  );
  expect((await begin(lease!)).status).toBe("stale");
  expect(
    await sql(
      "select id from private.reminder_message_attempts where cycle_id=$1",
      [a.credential.current_cycle.id],
    ),
  ).toHaveLength(0);
});

it("CU20 operator preview is read-only and returns aggregate timing without identities", async () => {
  const a = await fixture();
  expect(
    (
      await a.client.rpc("set_practice_reminder_recipient", {
        p_practice_id: a.practice.id,
        p_membership_id: null,
        p_expected_version: 2,
      })
    ).data.status,
  ).toBe("success");
  const query = readFileSync(
    "supabase/operators/email-reminders-catch-up-preview.sql",
    "utf8",
  ).replace("REPLACE_WITH_PROVIDER_NAMESPACE", namespace);
  const snapshot = async () =>
    sql(
      "select (select count(*) from private.reminder_jobs) jobs,(select count(*) from private.reminder_message_attempts) attempts,(select count(*) from private.reminder_job_events) events",
    );
  const before = await snapshot();
  const results = await pool.query(query);
  const rows = (results as unknown as { rows: unknown[] }[]).flatMap(
    (r) => r.rows,
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(rows).toContainEqual(
    expect.objectContaining({ eligibility: "blocked", reason: "no-recipient" }),
  );
  for (const value of [
    a.email,
    a.user.id,
    a.practice.id,
    a.credential.id,
    "payload",
    "token",
    "providerId",
  ])
    expect(JSON.stringify(rows)).not.toContain(value);
  expect(await snapshot()).toEqual(before);
  const db = await pool.connect();
  try {
    await db.query("begin;set local transaction_read_only=on");
    await expect(
      db.query(
        "select private.dirty_email_reminders($1,'forbidden-preview-write')",
        [a.practice.id],
      ),
    ).rejects.toMatchObject({ code: "25006" });
  } finally {
    await db.query("rollback");
    db.release();
  }
});
it("CU14 v2 active viewers read while anonymous and revoked readers are denied", async () => {
  const a = await fixture();
  const viewer = await account(),
    invitation = await invite(a, viewer.email, "viewer");
  expect(
    (
      await viewer.client.rpc("accept_practice_invitation", {
        p_token_digest: invitation.digest,
      })
    ).error,
  ).toBeNull();
  const args = { p_practice_id: a.practice.id, p_namespace: namespace };
  expect(
    (await viewer.client.rpc("get_email_reminder_schedule_v2", args)).error,
  ).toBeNull();
  expect(
    (await anonymous().rpc("get_email_reminder_schedule_v2", args)).error?.code,
  ).toBe("42501");
  const member = await membership(a.practice.id, viewer.user.id);
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        p_membership_id: member.id,
        p_expected_version: 1,
      })
    ).error,
  ).toBeNull();
  expect(
    (await viewer.client.rpc("get_email_reminder_schedule_v2", args)).error
      ?.code,
  ).toBe("42501");
});
it("CU14 invalidated unsent scheduling is pending until a fresh reconciliation", async () => {
  for (const change of ["date", "timezone"]) {
    const a = await fixture();
    await reconcile(a);
    if (change === "date") await changeDate(a, "2030-04-01");
    else
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
    const result = await a.client.rpc("get_email_reminder_schedule_v2", {
      p_practice_id: a.practice.id,
      p_namespace: namespace,
    });
    expect(result.error).toBeNull();
    expect(result.data.rows[0]).toMatchObject({
      state: "pending",
      scheduleKind: null,
      dispatchTarget: null,
      nextSendAt: null,
    });
    await reconcile(a);
    const fresh = await a.client.rpc("get_email_reminder_schedule_v2", {
      p_practice_id: a.practice.id,
      p_namespace: namespace,
    });
    expect(fresh.error).toBeNull();
    expect(fresh.data.rows[0].state).toBe("queued");
    expect(fresh.data.rows[0].scheduleKind).not.toBeNull();
  }
});
