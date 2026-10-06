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
const original = "20261006180010";
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
];
const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql") && name.slice(0, 14) > original)
  .sort();
assert(migrations.length > 0, "Missing credential dates upgrade");
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
  const before = await snapshot(db);
  for (const table of tables)
    assert(before[table].length > 0, `Empty historical snapshot ${table}`);
  const fingerprint = await catalog(db);
  writeFileSync(
    "reports/credential-dates-upgrade-before.json",
    JSON.stringify({ rows: before, schema: fingerprint }, null, 2),
  );
  await db.query("begin");
  for (const migration of migrations)
    await db.query(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  await assert.rejects(
    db.query(
      "do $$begin raise exception 'deliberate credential dates rollback'; end$$",
    ),
    /deliberate credential dates rollback/,
  );
  await db.query("rollback");
  assert.deepEqual(
    await snapshot(db),
    before,
    "Every historical table rolls back",
  );
  assertSchema(await catalog(db), fingerprint);
  await db.end();
  run("node_modules/.bin/supabase", ["migration", "up", "--local"]);
  db = await connect();
  assert.deepEqual(
    await snapshot(db),
    before,
    "Every historical table preserved exactly",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.credentials where issuer is not null or jurisdiction is not null",
      )
    ).rows[0].n,
    0,
    "Historical metadata remains unknown",
  );
  const cycles = (
    await db.query(
      "select * from public.credential_cycles order by credential_id",
    )
  ).rows;
  assert.equal(cycles.length, before["public.credentials"].length);
  assert.equal(
    new Set(cycles.map((cycle) => cycle.credential_id)).size,
    cycles.length,
  );
  for (const credential of before["public.credentials"]) {
    const cycle = cycles.find((row) => row.credential_id === credential.id);
    assert(cycle);
    assert.equal(cycle.practice_id, credential.practice_id);
    assert.equal(cycle.cycle_number, 1);
    assert.equal(cycle.date_revision, 1);
    assert.equal(cycle.end_date, null);
    assert.equal(cycle.action_deadline, null);
  }
  for (const receipt of before["private.register_create_requests"]) {
    const payload = receipt.payload;
    const reply =
      receipt.operation === "clinician-created"
        ? await as(
            db,
            receipt.actor_user_id,
            "select public.create_practice_clinician($1,$2,$3) result",
            [receipt.practice_id, receipt.request_id, payload.name],
          )
        : await as(
            db,
            receipt.actor_user_id,
            "select public.create_practice_credential($1,$2,$3,$4,$5,$6,$7) result",
            [
              receipt.practice_id,
              receipt.request_id,
              payload.title,
              payload.type,
              payload.owner_kind,
              payload.owner_clinician_id,
              payload.covered_clinician_ids,
            ],
          );
    assert.deepEqual(
      reply,
      receipt.result,
      "Historical receipt replays verbatim",
    );
  }
  assert.deepEqual(
    await snapshot(db),
    before,
    "Replays preserve every historical row",
  );
  for (const practice of before["public.practices"]) {
    const actor = practice.owner_user_id;
    const old = await as(
      db,
      actor,
      "select public.create_practice_credential($1,$2,'Legacy policy','malpractice_policy','practice',null,'{}') result",
      [practice.id, randomUUID()],
    );
    assert.equal(old.status, "success");
    assert.equal(Object.keys(old.credential).length, 8);
    const unknown = (
      await db.query(
        "select cycle_number,date_revision,end_date,action_deadline from public.credential_cycles where credential_id=$1",
        [old.credential.id],
      )
    ).rows;
    assert.deepEqual(unknown, [
      {
        cycle_number: 1,
        date_revision: 1,
        end_date: null,
        action_deadline: null,
      },
    ]);
    const key = randomUUID();
    const detailed = await as(
      db,
      actor,
      "select public.create_practice_credential_with_details($1,$2,'New policy','malpractice_policy','practice',null,'{}',' Insurer ',' CA ','2028-02-29','2028-02-01') result",
      [practice.id, key],
    );
    assert.equal(detailed.status, "success");
    assert.equal(detailed.credential.issuer, "Insurer");
    assert.equal(detailed.credential.current_cycle.end_date, "2028-02-29");
    const audit = (
      await db.query(
        "select after_data from private.register_audit_events where credential_id=$1",
        [detailed.credential.id],
      )
    ).rows;
    assert.deepEqual(audit, [{ after_data: detailed.credential }]);
    const receipt = (
      await db.query(
        "select result from private.register_create_requests where request_id=$1",
        [key],
      )
    ).rows;
    assert.deepEqual(receipt, [{ result: detailed }]);
    const register = await as(
      db,
      actor,
      "select public.list_practice_register($1) result",
      [practice.id],
    );
    assert.equal(register.credentials.length, 9);
    assert.equal(
      register.credentials.filter(
        (record) => record.current_cycle.end_date === null,
      ).length,
      8,
    );
  }
  upgraded = await catalog(db);
  writeFileSync(
    "reports/credential-dates-upgrade-schema.json",
    JSON.stringify(upgraded, null, 2),
  );
  writeFileSync(
    "reports/credential-dates-upgrade.json",
    JSON.stringify(
      {
        runId: process.env.GAUNTLET_RUN_ID ?? "standalone",
        migrations,
        historicalRows: Object.fromEntries(
          tables.map((table) => [table, before[table].length]),
        ),
        rollback: "full rows/functions/ACLs/constraints/indexes matched",
        backfill:
          "exactly one unknown initial cycle per historical credential; immutable legacy replay and final detailed snapshots witnessed",
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
  "E2-S1 twelve historical tables preserved; immutable replay, unknown cycles, full rollback and fresh replay witnessed.",
);
