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
const original = "20261007004303";
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
];
const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql") && name.slice(0, 14) > original)
  .sort();
assert(migrations.length > 0, "Missing SMS enrollment upgrade");
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
let credentialColumns;
async function snapshot(db) {
  const result = {};
  for (const table of tables)
    result[table] = (
      await db.query(
        `select ${table === "public.credentials" ? credentialColumns.join(",") : "*"} from ${table} order by ${table.endsWith("settings") ? "practice_id" : table.endsWith("coverage") ? "credential_id,clinician_id" : "id"}`,
      )
    ).rows;
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
  credentialColumns = (
    await db.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='credentials' order by ordinal_position",
    )
  ).rows.map((row) => row.column_name);
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
  const before = await snapshot(db);
  for (const table of tables)
    assert(before[table].length > 0, `Empty historical snapshot ${table}`);
  const fingerprint = await catalog(db);
  await db.query("begin");
  for (const migration of migrations)
    await db.query(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await assert.rejects(
    db.query("do $$begin raise exception 'deliberate SMS rollback'; end$$"),
    /deliberate SMS rollback/,
  );
  await db.query("rollback");
  assert.deepEqual(await snapshot(db), before);
  assertSchema(await catalog(db), fingerprint);
  await db.end();
  run("node_modules/.bin/supabase", ["migration", "up", "--local"]);
  db = await connect();
  assert.deepEqual(await snapshot(db), before);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.practice_sms_enrollments",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.sms_enrollment_events",
      )
    ).rows[0].n,
    0,
  );
  for (const practice of before["public.practices"]) {
    const legacy = await as(
      db,
      practice.owner_user_id,
      "select public.get_practice_reminder_recipient($1) result",
      [practice.id],
    );
    assert.equal(legacy.ready, false);
    assert.equal(legacy.readiness, "sms-setup-pending");
    const fresh = await as(
      db,
      practice.owner_user_id,
      "select public.get_my_practice_sms_enrollment($1) result",
      [practice.id],
    );
    assert.equal(fresh.reason, "not-started");
    assert.equal(fresh.consented, false);
  }
  assert.deepEqual(await snapshot(db), before);
  upgraded = await catalog(db);
  writeFileSync(
    "reports/sms-enrollment-upgrade.json",
    JSON.stringify(
      {
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
        migrations,
        historicalRows: Object.fromEntries(
          tables.map((t) => [t, before[t].length]),
        ),
        rollback: "all 14 historical tables and complete catalog restored",
        backfill: "no enrollment or consent",
        legacy: "literal false readiness and selected recipients preserved",
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
  "SMS upgrade preserves all 14 populated historical tables, rollback catalog, legacy APIs and fresh replay; no consent backfill.",
);
