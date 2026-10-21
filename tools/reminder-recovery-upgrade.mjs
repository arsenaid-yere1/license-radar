import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import {
  fixtureGuard,
  localConfig,
  prepare,
  run,
} from "./local-environment.mjs";
import { catalog } from "./schema-catalog.mjs";
import { assertSchema } from "./gauntlet-contract.mjs";
const original = "20261009175711";
const tables = [
  "public.practices",
  "public.practice_memberships",
  "private.practice_invitations",
  "private.practice_audit_events",
  "private.practice_access_events",
  "private.practice_reminder_settings",
  "private.practice_recipient_events",
  "public.clinicians",
  "public.credentials",
  "public.policy_coverage",
  "private.register_create_requests",
  "private.register_audit_events",
  "public.credential_cycles",
  "private.register_change_requests",
  "private.sms_phone_endpoints",
  "private.practice_sms_enrollments",
  "private.sms_enrollment_events",
  "private.sms_verification_challenges",
  "private.sms_verification_requests",
  "private.sms_action_receipts",
  "private.sms_provider_events",
];
const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql") && name.slice(0, 14) > original)
  .sort();
assert(migrations.length > 0, "Missing email recovery upgrade");
async function reset(version) {
  await fixtureGuard();
  run("node_modules/.bin/supabase", [
    "db",
    "reset",
    "--local",
    "--no-seed",
    "--yes",
    ...(version ? ["--version", version] : []),
  ]);
  prepare();
}
async function connect() {
  const db = new Client({ connectionString: localConfig().DB_URL });
  await db.connect();
  return db;
}
const emailTables = [
  "reminder_email_account_state",
  "reminder_email_preferences",
  "reminder_email_preference_requests",
  "reminder_email_preference_events",
  "reminder_email_endpoints",
  "reminder_jobs",
  "reminder_message_attempts",
  "reminder_job_events",
  "reminder_delivery_events",
  "reminder_reconcile_outbox",
  "reminder_account_scan_state",
  "reminder_worker_runs",
].map((t) => `private.${t}`);
const columns = {};
async function snapshot(db) {
  const result = {};
  for (const table of [...tables, ...emailTables, "auth.users"])
    result[table] = (
      await db.query(
        `select ${columns[table].map((c) => `"${c}"`).join(",")} from ${table}`,
      )
    ).rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return result;
}
async function actor(db) {
  const id = randomUUID();
  await db.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())",
    [id, `fixture-${id}@example.test`],
  );
  return id;
}
async function as(db, id, sql, args = []) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    await db.query("set local role authenticated");
    const result = await db.query(sql, args);
    await db.query("commit");
    return result.rows[0].result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
mkdirSync("reports", { recursive: true });
await reset(original);
let db = await connect();
let upgraded;
try {
  for (let i = 0; i < 2; i++) {
    const owner = await actor(db),
      staff = await actor(db);
    const practice = await as(
      db,
      owner,
      "select to_jsonb(public.create_practice($1,'UTC')) result",
      [`Upgrade fixture ${i}`],
    );
    await as(
      db,
      owner,
      "select public.update_practice($1,$2,'America/Los_Angeles',1) result",
      [practice.id, `Edited fixture ${i}`],
    );
    const digest = randomBytes(32).toString("hex");
    await as(
      db,
      owner,
      "select public.create_practice_invitation($1,$2,'manager',$3) result",
      [practice.id, `fixture-${staff}@example.test`, digest],
    );
    await as(db, staff, "select public.accept_practice_invitation($1) result", [
      digest,
    ]);
    const member = (
      await db.query(
        "select id from public.practice_memberships where user_id=$1",
        [staff],
      )
    ).rows[0];
    const administrator = (
      await db.query(
        "select id from public.practice_memberships where user_id=$1",
        [owner],
      )
    ).rows[0];
    for (const [membership, version] of [
      [administrator.id, 1],
      [member.id, 2],
      [null, 3],
    ])
      assert.equal(
        (
          await as(
            db,
            owner,
            "select public.set_practice_reminder_recipient($1,$2,$3) result",
            [practice.id, membership, version],
          )
        ).status,
        "success",
      );
    await as(
      db,
      owner,
      "select public.change_practice_member_role($1,1,'viewer') result",
      [member.id],
    );
    if (i)
      await as(db, owner, "select public.revoke_practice_member($1,2) result", [
        member.id,
      ]);
    for (const canceled of [false, true]) {
      const email = `fixture-${randomUUID()}@example.test`;
      const invitation = await as(
        db,
        owner,
        "select public.create_practice_invitation($1,$2,'viewer',$3) result",
        [practice.id, email, randomBytes(32).toString("hex")],
      );
      if (canceled)
        await as(
          db,
          owner,
          "select public.cancel_practice_invitation($1,1) result",
          [invitation.invitation.id],
        );
    }
  }
  for (const practice of (
    await db.query("select * from public.practices order by id")
  ).rows) {
    const people = [];
    for (const name of ["Rivera", "Chen"]) {
      const reply = await as(
        db,
        practice.owner_user_id,
        "select public.create_practice_clinician($1,$2,$3) result",
        [practice.id, randomUUID(), name],
      );
      assert.equal(reply.status, "success");
      people.push(reply.clinician.id);
    }
    for (const type of [
      "state_license",
      "dea_registration",
      "malpractice_policy",
    ])
      for (const owner of ["practice", "clinician"]) {
        const reply = await as(
          db,
          practice.owner_user_id,
          "select public.create_practice_credential($1,$2,$3,$4,$5,$6,$7) result",
          [
            practice.id,
            randomUUID(),
            type,
            type,
            owner,
            owner === "clinician" ? people[0] : null,
            [],
          ],
        );
        assert.equal(reply.status, "success");
      }
    assert.equal(
      (
        await as(
          db,
          practice.owner_user_id,
          "select public.create_practice_credential($1,$2,'Shared policy','malpractice_policy','practice',null,$3) result",
          [practice.id, randomUUID(), people],
        )
      ).status,
      "success",
    );
  }

  for (const practice of (await db.query("select * from public.practices"))
    .rows)
    for (const end of ["2028-02-29", null]) {
      const reply = await as(
        db,
        practice.owner_user_id,
        "select public.create_practice_credential_with_details($1,$2,$3,'malpractice_policy','practice',null,'{}','Insurer','CA',$4,'2028-02-01') result",
        [
          practice.id,
          randomUUID(),
          end ? "Detailed historic policy" : "Historic action-only policy",
          end,
        ],
      );
      assert.equal(reply.status, "success");
    }
  for (const practice of (await db.query("select * from public.practices"))
    .rows) {
    const owner = (
      await db.query(
        "select id from public.practice_memberships where practice_id=$1 and user_id=$2",
        [practice.id, practice.owner_user_id],
      )
    ).rows[0];
    await as(
      db,
      practice.owner_user_id,
      "select public.set_practice_reminder_recipient($1,$2,4) result",
      [practice.id, owner.id],
    );
    const current = (
      await db.query(
        "select c.id,c.version,y.id cycle_id,y.date_revision from public.credentials c join public.credential_cycles y on y.credential_id=c.id where c.practice_id=$1 order by c.id limit 1",
        [practice.id],
      )
    ).rows[0];
    assert.equal(
      (
        await as(
          db,
          practice.owner_user_id,
          "select public.archive_practice_credential($1,$2,$3,$4,$5,$6) result",
          [
            practice.id,
            randomUUID(),
            current.id,
            current.version,
            current.cycle_id,
            current.date_revision,
          ],
        )
      ).status,
      "success",
    );
  }
  let phoneIndex = 0;
  for (const practice of (
    await db.query("select * from public.practices order by id")
  ).rows) {
    const phone = `+12025550${String(++phoneIndex).padStart(3, "0")}`;
    const requestId = randomUUID();
    const ac = `AC${"1".repeat(32)}`,
      mg = `MG${"2".repeat(32)}`,
      va = `VA${"3".repeat(32)}`;
    const prepared = await as(
      db,
      practice.owner_user_id,
      "select public.prepare_my_sms_verification($1,$2,$3,1,false,true,$4,$5,$6) result",
      [practice.id, requestId, phone, ac, mg, va],
    );
    assert.equal(prepared.status, "success");
    const claimed = (
      await db.query(
        "select private.claim_sms_verification_send($1,$2,$3) result",
        [practice.id, practice.owner_user_id, requestId],
      )
    ).rows[0].result;
    assert.equal(claimed.status, "claimed");
    const outcome = {
      status: "pending",
      accountSid: ac,
      serviceSid: va,
      to: phone,
      channel: "sms",
      sid: `VE${String(phoneIndex).repeat(32)}`,
    };
    assert.equal(
      (
        await db.query(
          "select private.record_sms_verification_send($1,$2,$3,$4,$5) result",
          [
            practice.id,
            practice.owner_user_id,
            requestId,
            claimed.claimToken,
            outcome,
          ],
        )
      ).rows[0].result.status,
      "success",
    );
    const checkId = randomUUID();
    const check = (
      await db.query(
        "select private.claim_sms_verification_check($1,$2,$3,$4,2) result",
        [
          practice.id,
          practice.owner_user_id,
          checkId,
          prepared.enrollment.challengeId,
        ],
      )
    ).rows[0].result;
    assert.equal(check.status, "claimed");
    assert.equal(
      (
        await db.query(
          "select private.record_sms_verification_check($1,$2,$3,$4,$5) result",
          [
            practice.id,
            practice.owner_user_id,
            checkId,
            check.claimToken,
            { ...outcome, status: "approved" },
          ],
        )
      ).rows[0].result.status,
      "success",
    );
    assert.equal(
      (
        await as(
          db,
          practice.owner_user_id,
          "select public.consent_my_practice_sms($1,$2,3,true) result",
          [practice.id, randomUUID()],
        )
      ).status,
      "success",
    );
    assert.equal(
      (
        await db.query(
          "select private.apply_sms_provider_opt_out($1,$2,$3,$4,'STOP') result",
          [ac, mg, phone, `SM${randomUUID().replaceAll("-", "")}`],
        )
      ).rows[0].result.status,
      "success",
    );
    assert.equal(
      (
        await as(
          db,
          practice.owner_user_id,
          "select public.withdraw_my_practice_sms($1,$2) result",
          [practice.id, randomUUID()],
        )
      ).status,
      "success",
    );
  }

  const namespace = "fixture-reminders";
  const now = "2030-01-01T10:00:00Z";
  const config = {
    namespace,
    from: "reminders@example.test",
    replyTo: "support@example.test",
    appUrl: "http://127.0.0.1:3000",
  };
  const fixtures = (
    await db.query("select * from public.practices order by id")
  ).rows;
  for (const practice of fixtures) {
    assert.equal(
      (
        await as(
          db,
          practice.owner_user_id,
          "select public.create_practice_credential_with_details($1,$2,'Queued upgrade fixture','state_license','practice',null,'{}',null,null,'2030-03-02',null) result",
          [practice.id, randomUUID()],
        )
      ).status,
      "success",
    );
    // Populate immutable preference receipts/events as well as the default preference.
    for (const [enabled, version] of [
      [false, 1],
      [true, 2],
    ])
      assert.equal(
        (
          await as(
            db,
            practice.owner_user_id,
            "select public.set_my_email_reminder_preference($1,$2,$3,$4) result",
            [practice.id, randomUUID(), enabled, version],
          )
        ).status,
        "success",
      );
    // UTC keeps this deterministic and records the change in historical audit state.
    assert.equal(
      (
        await as(
          db,
          practice.owner_user_id,
          "select to_jsonb(public.update_practice($1,$2,'UTC',2)) result",
          [practice.id, practice.name],
        )
      ).timezone,
      "UTC",
    );
    const member = (
      await db.query(
        "select id from public.practice_memberships where practice_id=$1 and user_id=$2",
        [practice.id, practice.owner_user_id],
      )
    ).rows[0];
    const credentials = (
      await db.query(
        "select c.id,y.id cycle_id from public.credentials c join public.credential_cycles y on y.credential_id=c.id where c.practice_id=$1 and c.archived_at is null order by c.id",
        [practice.id],
      )
    ).rows;
    for (const c of credentials)
      await db.query(
        "update public.credential_cycles set end_date='2030-03-02', action_deadline=null,updated_at='2000-01-01' where id=$1",
        [c.cycle_id],
      );
    await db.query(
      "update private.practice_reminder_settings set updated_at='2000-01-01' where practice_id=$1",
      [practice.id],
    );
    await db.query(
      "update private.reminder_email_account_state set eligible_since='2000-01-01' where user_id=$1",
      [practice.owner_user_id],
    );
    await db.query(
      "update private.reminder_email_preferences set eligible_since='2000-01-01' where practice_id=$1",
      [practice.id],
    );
    await db.query(
      "update private.practice_audit_events set occurred_at='2000-01-01' where practice_id=$1",
      [practice.id],
    );
    await db.query(
      "select private.dirty_email_reminders($1,'upgrade-fixture')",
      [practice.id],
    );
    await db.query(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [practice.id],
    );
    await db.query("select private.reconcile_email_reminders_at($1,$2)", [
      namespace,
      now,
    ]);
    const jobs = (
      await db.query(
        "select * from private.reminder_jobs where practice_id=$1 and state='queued' order by id",
        [practice.id],
      )
    ).rows;
    assert(
      jobs.length >= 7,
      "Populated job states require seven distinct cycles",
    );
    for (const [index, outcome] of [
      "submitting",
      "accepted",
      "failed",
      "uncertain",
    ].entries()) {
      const job = jobs[index],
        token = randomUUID();
      await db.query(
        "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3::timestamptz+interval '30 seconds' where id=$1",
        [job.id, token, now],
      );
      const attempt = (
        await db.query(
          "select private.begin_email_reminder_at($1,$2,$3,$4) result",
          [job.id, token, config, now],
        )
      ).rows[0].result;
      assert.equal(attempt.status, "submit");
      if (outcome !== "submitting")
        assert.equal(
          (
            await db.query(
              "select private.record_email_reminder($1,$2,$3,$4,$5) result",
              [
                attempt.attemptId,
                attempt.token,
                outcome,
                outcome === "accepted" ? randomUUID() : null,
                outcome === "accepted" ? null : "interrupted",
              ],
            )
          ).rows[0].result.status,
          "recorded",
        );
      if (outcome === "accepted") {
        const stored = (
          await db.query(
            "select provider_id from private.reminder_message_attempts where id=$1",
            [attempt.attemptId],
          )
        ).rows[0];
        assert.equal(
          (
            await db.query(
              "select private.apply_email_reminder_event($1,$2,$3,$4,'delivered',$5,$6) result",
              [
                namespace,
                `fixture-${randomUUID()}`,
                stored.provider_id,
                attempt.attemptId,
                config.from,
                attempt.payload.to[0],
              ],
            )
          ).rows[0].result.status,
          "recorded",
        );
      }
    }
    await db.query(
      "update private.reminder_jobs set state='canceled',reason='fixture-canceled' where id=$1",
      [jobs[4].id],
    );
    const liveToken = randomUUID();
    await db.query(
      "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3::timestamptz+interval '30 seconds' where id=$1",
      [jobs[5].id, liveToken, now],
    );
    await db.query(
      "update public.credential_cycles set updated_at='2030-01-01T09:00:01Z' where id=$1",
      [jobs[6].cycle_id],
    );
    await db.query(
      "update private.reminder_jobs set state='blocked',reason='catch-up-unavailable',eligible_since='2030-01-01T09:00:01Z' where id=$1",
      [jobs[6].id],
    );
    await db.query(
      "update private.reminder_email_endpoints set suppressed=true,epoch=epoch+1,reason='complained' where id=$1",
      [jobs[0].endpoint_id],
    );
    await db.query(
      "update private.reminder_jobs set state='suppressed',reason='email-suppressed' where id=$1",
      [jobs[7].id],
    );
    await db.query(
      "insert into private.reminder_reconcile_outbox(practice_id) values($1) on conflict(practice_id) do update set generation=reminder_reconcile_outbox.generation+1",
      [practice.id],
    );
    await db.query(
      "update private.reminder_reconcile_outbox set cursor_id=$2 where practice_id=$1",
      [practice.id, credentials[0].id],
    );
    const run = (await db.query("select private.start_email_reminder_run() id"))
      .rows[0].id;
    await db.query("select private.finish_email_reminder_run($1,true,$2)", [
      run,
      { submitted: 4 },
    ]);
    // Keep a separate unconsumed live claim unsuppressed to witness old lease compatibility.
    if (practice.id === fixtures[0].id) {
      await db.query(
        "update private.reminder_email_endpoints set suppressed=false,reason=null,epoch=1 where id=$1",
        [jobs[0].endpoint_id],
      );
    }
    void member;
  }
  await db.query(
    "update private.reminder_account_scan_state set cursor_id=$1,version=7",
    [fixtures[0].owner_user_id],
  );
  // Accepted history remains available after archival; another practice retains a former recipient.
  const historical = (
    await db.query(
      "select j.credential_id from private.reminder_jobs j join private.reminder_message_attempts a on a.job_id=j.id where a.outcome='accepted' order by j.id limit 1",
    )
  ).rows[0];
  await db.query(
    "update public.credentials set archived_at=clock_timestamp() where id=$1",
    [historical.credential_id],
  );
  await db.query(
    "update private.practice_reminder_settings set membership_id=null where practice_id=$1",
    [fixtures[1].id],
  );
  for (const table of [...tables, ...emailTables, "auth.users"]) {
    const [schema, name] = table.split(".");
    columns[table] = (
      await db.query(
        "select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position",
        [schema, name],
      )
    ).rows.map((r) => r.column_name);
  }
  const before = await snapshot(db);
  assert.deepEqual(
    [
      ...new Set(before["private.reminder_jobs"].map((row) => row.state)),
    ].sort(),
    [
      "blocked",
      "queued",
      "claimed",
      "submitting",
      "accepted",
      "failed",
      "uncertain",
      "canceled",
      "suppressed",
    ].sort(),
    "All nine historical job states must be populated",
  );
  for (const table of [...tables, ...emailTables, "auth.users"])
    assert(before[table].length > 0, `Empty historical snapshot ${table}`);
  const fingerprint = await catalog(db);
  assert.equal(
    tables.length + emailTables.length,
    33,
    "Historical table inventory must remain complete",
  );
  assert(
    before["private.reminder_jobs"].some(
      (job) => job.practice_id === fixtures[1].id,
    ),
    "Former-recipient history must exist",
  );
  assert(
    before["public.credentials"].some(
      (credential) =>
        credential.id === historical.credential_id && credential.archived_at,
    ),
    "Archived attempted credential must exist",
  );
  await db.query("begin");
  for (const migration of migrations)
    await db.query(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await assert.rejects(
    db.query("do $$begin raise exception 'deliberate recovery rollback';end$$"),
    /deliberate recovery rollback/,
  );
  await db.query("rollback");
  assert.deepEqual(
    await snapshot(db),
    before,
    "Transactional recovery fault restores every original value",
  );
  assertSchema(await catalog(db), fingerprint);
  await db.end();
  run("node_modules/.bin/supabase", ["migration", "up", "--local"]);
  db = await connect();
  assert.deepEqual(
    await snapshot(db),
    before,
    "Recovery migration preserves all original columns including outbox, payloads and consumed guards",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.reminder_message_attempts where recovery_state<>'legacy' or recovery_version<>1 or post_count<>0 or check_count<>0 or retry_due is not null or retry_expires is not null or check_due is not null or last_check_reserved is not null or app_origin is not null or urgency is not null",
      )
    ).rows[0].n,
    0,
    "Legacy attempts gain no guessed snapshots or automatic recovery authority",
  );
  for (const table of [
    "reminder_email_submissions",
    "reminder_email_checks",
    "reminder_email_check_requests",
  ])
    assert.equal(
      (await db.query(`select count(*)::int n from private.${table}`)).rows[0]
        .n,
      0,
      `No invented recovery evidence in ${table}`,
    );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.reminder_recovery_scan_state where singleton and rotation=0",
      )
    ).rows[0].n,
    1,
    "Only initial fair scan state is created",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.reminder_delivery_events where cursor_id is null",
      )
    ).rows[0].n,
    0,
    "Existing signed events receive opaque cursor IDs",
  );
  for (const p of fixtures) {
    const v1 = await as(
      db,
      p.owner_user_id,
      "select public.get_email_reminder_schedule($1,$2) result",
      [p.id, namespace],
    );
    const v2 = await as(
      db,
      p.owner_user_id,
      "select public.get_email_reminder_schedule_v2($1,$2) result",
      [p.id, namespace],
    );
    for (const item of v1.rows)
      assert.deepEqual(
        Object.keys(item).sort(),
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
    for (const item of v2.rows)
      assert.deepEqual(
        Object.keys(item).sort(),
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
          "scheduleKind",
          "dispatchTarget",
        ].sort(),
      );
  }
  assert.deepEqual(
    await snapshot(db),
    before,
    "Read-only history/schema checks create no work",
  );
  const live = (
    await db.query(
      "select * from private.reminder_jobs where state='claimed' and practice_id=$1",
      [fixtures[0].id],
    )
  ).rows[0];
  assert(live, "Original unconsumed lease is retained");
  const permission = (
    await db.query(
      "select private.begin_email_reminder_at($1,$2,$3,$4) result",
      [live.id, live.claim_token, config, now],
    )
  ).rows[0].result;
  assert.equal(
    permission.status,
    "submit",
    "Legacy live claim still consumes exactly once",
  );
  assert.notEqual(
    (
      await db.query(
        "select private.begin_email_reminder_at($1,$2,$3,$4) result",
        [live.id, live.claim_token, config, now],
      )
    ).rows[0].result.status,
    "submit",
    "Consumed legacy claim cannot replay",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.reminder_message_attempts where id=$1 and recovery_state='legacy' and post_count=0 and check_count=0 and check_due is null",
        [permission.attemptId],
      )
    ).rows[0].n,
    1,
    "Old binary has no retry/check authority",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.reminder_email_submissions",
      )
    ).rows[0].n,
    0,
    "Legacy begin does not invent recovery POST reservation",
  );
  upgraded = await catalog(db);
  writeFileSync(
    "reports/reminder-recovery-upgrade.json",
    JSON.stringify(
      {
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
        baseline: original,
        migrations,
        historicalRows: Object.fromEntries(
          [...tables, ...emailTables, "auth.users"].map((table) => [
            table,
            before[table].length,
          ]),
        ),
        rollback:
          "33 populated historical tables plus Auth original columns and complete catalog restored",
        backfill:
          "legacy disposition/version 1; zero POST/check budgets, no queued work or invented ledgers; opaque event cursor only",
        legacy:
          "exact V1/V2 keys; old live claim submits once without gaining retry authority",
        replay: "populated CLI upgrade and fresh final catalog equal",
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
  await reset();
}
db = await connect();
try {
  assertSchema(await catalog(db), upgraded);
} finally {
  await db.end();
}
console.log(
  "Recovery upgrade preserves 33 populated historical tables plus Auth; rollback, legacy once-only claim and fresh replay passed.",
);
