import assert from "node:assert/strict";
import { Client } from "pg";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fixtureGuard, localConfig, run } from "./local-environment.mjs";
import {
  assertMutant,
  assertInventory,
  vitestCases,
  assertionFailure,
} from "./gauntlet-contract.mjs";
await fixtureGuard();
const db = new Client({ connectionString: localConfig().DB_URL });
await db.connect();
const undo = [];
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function functionFault(signature, from, to) {
  const original = (
    await db.query("select pg_get_functiondef($1::regprocedure) body", [
      signature,
    ])
  ).rows[0].body;
  const changed = original.replace(from, to);
  assert.notEqual(
    changed,
    original,
    `Inapplicable function fault: ${signature}`,
  );
  await db.query(changed);
  undo.push(original);
  const applied = (
    await db.query("select pg_get_functiondef($1::regprocedure) body", [
      signature,
    ])
  ).rows[0].body;
  assert.notEqual(
    hash(applied),
    hash(original),
    "Function fault not actually applied",
  );
}
async function ddlFault(sql, restore, check, expected) {
  await db.query(sql);
  undo.push(restore);
  assert.deepEqual(
    (await db.query(check)).rows,
    expected,
    "DDL fault not actually applied",
  );
}
async function dropTrigger(table, trigger) {
  const original = (
    await db.query(
      "select pg_get_triggerdef(oid) body from pg_trigger where tgrelid=$1::regclass and tgname=$2",
      [table, trigger],
    )
  ).rows[0].body;
  await ddlFault(
    `drop trigger ${trigger} on ${table}`,
    original,
    `select tgname from pg_trigger where tgrelid='${table}'::regclass and tgname='${trigger}'`,
    [],
  );
}
const access = "tests/integration/practice-access.test.ts",
  invites = "tests/integration/practice-invitations.test.ts",
  profile = "tests/integration/practice-profile.test.ts",
  properties = "tests/integration/practice-access-properties.test.ts";
const mutants = [
  {
    id: "isolation",
    file: profile,
    pattern: "S17 S18 S23",
    apply: () =>
      ddlFault(
        "alter policy practices_select on public.practices using (true)",
        "alter policy practices_select on public.practices using (id=(select private.current_practice_id()))",
        "select qual from pg_policies where policyname='practices_select'",
        [{ qual: "true" }],
      ),
  },
  {
    id: "live-administrator",
    file: access,
    pattern: "^A0[12]",
    apply: () =>
      functionFault(
        "private.require_administrator(uuid)",
        "and state = 'active' and role = 'administrator'",
        "and state = 'active'",
      ),
  },
  {
    id: "creator-fallback",
    file: access,
    pattern: "S06 S38|^S38 public",
    apply: () =>
      ddlFault(
        "alter policy practices_select on public.practices using (id=(select private.current_practice_id()) or owner_user_id=auth.uid())",
        "alter policy practices_select on public.practices using (id=(select private.current_practice_id()))",
        "select position('owner_user_id' in qual)>0 present from pg_policies where policyname='practices_select'",
        [{ present: true }],
      ),
  },
  {
    id: "active-user-uniqueness",
    file: access,
    pattern: "^N02",
    apply: async () => {
      const original = (
        await db.query(
          "select indexdef from pg_indexes where indexname='practice_memberships_one_active_user'",
        )
      ).rows[0].indexdef;
      await ddlFault(
        "drop index public.practice_memberships_one_active_user",
        original,
        "select indexname from pg_indexes where indexname='practice_memberships_one_active_user'",
        [],
      );
    },
  },
  {
    id: "last-administrator",
    file: access,
    pattern: "S37",
    apply: () =>
      functionFault(
        "private.ensure_administrator()",
        /if found and not exists/,
        "if false and not exists",
      ),
  },
  {
    id: "last-administrator-domain",
    file: invites,
    pattern: "S34 S35",
    apply: () =>
      functionFault(
        "private.mutate_member(uuid,integer,text,boolean)",
        "if member.role='administrator' and",
        "if false and",
      ),
  },
  {
    id: "user-serialization",
    file: access,
    pattern: "S04 concurrent",
    apply: () =>
      functionFault(
        "private.create_practice(text,text)",
        /perform pg_catalog.pg_advisory_xact_lock\([^;]+;/,
        "perform 1;",
      ),
  },
  {
    id: "practice-serialization",
    file: invites,
    pattern: "S39 queued",
    apply: () =>
      functionFault("private.require_administrator(uuid)", "for update;", ";"),
  },
  {
    id: "profile-version",
    file: profile,
    pattern: "S21 S22",
    apply: () =>
      functionFault(
        "private.update_practice(uuid,text,text,integer)",
        "and version = p_expected_version",
        "",
      ),
  },
  {
    id: "member-version",
    file: invites,
    pattern: "S34 actual role",
    apply: () =>
      functionFault(
        "private.mutate_member(uuid,integer,text,boolean)",
        "member.version <> p_expected_version",
        "false",
      ),
  },
  {
    id: "confirmed-email",
    file: invites,
    pattern: "S20 unconfirmed",
    apply: () =>
      functionFault(
        "private.invitation_for_actor(text)",
        "and email_confirmed_at is not null",
        "",
      ),
  },
  {
    id: "matching-email",
    file: invites,
    pattern: "S19 S20 S21",
    apply: () =>
      functionFault(
        "private.invitation_for_actor(text)",
        "result.email <> private.canonical_invitation_email(actor_email)",
        "false",
      ),
  },
  {
    id: "expiry",
    file: invites,
    pattern: "S22 expired capability denies",
    apply: () =>
      functionFault(
        "private.invitation_for_actor(text)",
        "or pg_catalog.clock_timestamp() >= result.expires_at",
        "",
      ),
  },
  {
    id: "transaction-start-expiry",
    file: invites,
    pattern: "S23 invitation",
    apply: () =>
      functionFault(
        "private.invitation_for_actor(text)",
        "pg_catalog.clock_timestamp()",
        "pg_catalog.transaction_timestamp()",
      ),
  },
  {
    id: "revocation-epoch",
    file: invites,
    pattern: "^A03 S31",
    propertyPattern: "^P03",
    apply: () =>
      functionFault(
        "private.invitation_for_actor(text)",
        "result.issued_at <= latest_revocation",
        "false",
      ),
  },
  {
    id: "accepted-role-replay",
    file: invites,
    pattern: "^A03 S25|S26 pending",
    propertyPattern: "^P03",
    apply: () =>
      functionFault(
        "private.accept_practice_invitation(text)",
        "return pg_catalog.jsonb_build_object('status','already-member'",
        "update public.practice_memberships set role=invitation.role,version=version+1 where id=member.id; member.role := invitation.role; return pg_catalog.jsonb_build_object('status','already-member'",
      ),
  },
  {
    id: "profile-audit",
    file: profile,
    pattern: "S25 audit",
    apply: () => dropTrigger("public.practices", "audit_practice"),
  },
  {
    id: "membership-audit",
    file: invites,
    pattern:
      "S41 access audit failure rolls back (initial-membership|role|revoke)",
    propertyPattern: "^P03",
    apply: () => dropTrigger("public.practice_memberships", "audit_membership"),
  },
  {
    id: "invitation-audit",
    file: invites,
    pattern:
      "S41 access audit failure rolls back (create|reissue|cancel|accept)",
    propertyPattern: "^P03",
    apply: () =>
      dropTrigger("private.practice_invitations", "audit_invitation"),
  },
  {
    id: "profile-direct-dml",
    file: access,
    pattern: "S05 S33",
    apply: () =>
      ddlFault(
        "grant update(name,timezone) on public.practices to authenticated;create policy fixture_mutant_update on public.practices for update to authenticated using(true) with check(true)",
        "drop policy fixture_mutant_update on public.practices;revoke update(name,timezone) on public.practices from authenticated",
        "select has_column_privilege('authenticated','public.practices','name','update') allowed",
        [{ allowed: true }],
      ),
  },
  {
    id: "membership-direct-dml",
    file: access,
    pattern: "S05 S33",
    apply: () =>
      ddlFault(
        "grant update on public.practice_memberships to authenticated;create policy fixture_mutant_update on public.practice_memberships for update to authenticated using(true) with check(true)",
        "drop policy fixture_mutant_update on public.practice_memberships;revoke update on public.practice_memberships from authenticated",
        "select has_table_privilege('authenticated','public.practice_memberships','update') allowed",
        [{ allowed: true }],
      ),
  },
  {
    id: "private-invitation-projection",
    file: invites,
    pattern: "S08 S10 S17",
    apply: () =>
      functionFault(
        "private.invitation_projection(private.practice_invitations)",
        "'expires_at',p_invitation.expires_at",
        "'expires_at',p_invitation.expires_at,'token_digest',p_invitation.token_digest",
      ),
  },
  {
    id: "post-lock-live-authority",
    file: invites,
    pattern: "S39 queued|S36 simultaneous",
    apply: () =>
      functionFault(
        "private.require_administrator(uuid)",
        "if not exists (select 1 from public.practice_memberships",
        "if false and not exists (select 1 from public.practice_memberships",
      ),
  },
  {
    id: "canonical-email-properties",
    file: properties,
    pattern: "^P01",
    apply: () =>
      functionFault(
        "private.canonical_invitation_email(text)",
        "'abcdefghijklmnopqrstuvwxyz'",
        "'ABCDEFGHIJKLMNOPQRSTUVWXYZ'",
      ),
  },
  {
    id: "reissued-expiry-period",
    file: invites,
    pattern: "S13 expired pending",
    apply: () =>
      functionFault(
        "private.mutate_invitation(uuid,integer,text,boolean)",
        "interval '168 hours'",
        "interval '192 hours'",
      ),
  },
  {
    id: "invitation-input-version",
    file: invites,
    pattern: "S09 S14 database mutation",
    apply: () =>
      functionFault(
        "private.mutate_invitation(uuid,integer,text,boolean)",
        "if p_expected_version is null or p_expected_version < 1 then",
        "if false then",
      ),
  },
  {
    id: "reissue-fresh-digest",
    file: invites,
    pattern: "S09 S14 database mutation",
    apply: () =>
      functionFault(
        "private.mutate_invitation(uuid,integer,text,boolean)",
        "if p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$'",
        "if false",
      ),
  },
  {
    id: "expiry-equality",
    file: invites,
    pattern: "S22 controlled database clock",
    apply: () =>
      functionFault(
        "private.invitation_for_actor(text)",
        "pg_catalog.clock_timestamp() >= result.expires_at",
        "pg_catalog.clock_timestamp() > result.expires_at",
      ),
  },
  {
    id: "inviter-revocation-does-not-cancel",
    file: invites,
    pattern: "S16 inviter later",
    apply: () =>
      functionFault(
        "private.invitation_for_actor(text)",
        "if result.email <>",
        "if not exists(select 1 from public.practice_memberships where user_id=result.creator_user_id and practice_id=result.practice_id and state='active') or result.email <>",
      ),
  },
  {
    id: "profile-audit-access-rollback",
    file: invites,
    pattern: "S42 profile audit failure",
    apply: () => dropTrigger("public.practices", "audit_practice"),
  },
  {
    id: "private-roster-projection",
    file: access,
    pattern: "^A05",
    apply: () =>
      functionFault(
        "private.invitation_projection(private.practice_invitations)",
        "'expires_at',p_invitation.expires_at",
        "'expires_at',p_invitation.expires_at,'token_digest',p_invitation.token_digest",
      ),
  },
  {
    id: "timezone",
    file: invites,
    pattern: "S07 S11 invalid timezone",
    apply: () =>
      functionFault(
        "private.validate_practice()",
        /if new.timezone[\s\S]*?then\n        raise exception/,
        "if false then\n        raise exception",
      ),
  },
];
mkdirSync("reports/sql-mutants", { recursive: true });
const records = [];
function execute(file, pattern, path) {
  rmSync(path, { force: true });
  const r = spawnSync(
    "node_modules/.bin/vitest",
    [
      "run",
      "--project",
      "integration",
      file,
      "--testNamePattern",
      pattern,
      "--reporter=json",
      "--outputFile",
      path,
    ],
    { encoding: "utf8", env: process.env, maxBuffer: 32 * 1024 * 1024 },
  );
  writeFileSync(path + ".log", `${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  if (r.error) throw r.error;
  const report = JSON.parse(readFileSync(path, "utf8"));
  const cases = vitestCases(report).filter((a) =>
    new RegExp(pattern).test(a.name),
  );
  return { run: r, report, cases };
}
async function restore() {
  while (undo.length) await db.query(undo.pop());
  run(process.execPath, ["tools/schema-fingerprint.mjs"]);
}
try {
  for (const mutant of mutants) {
    for (const propertyOnly of mutant.propertyPattern
      ? [false, true]
      : [false]) {
      const id = mutant.id + (propertyOnly ? "-properties" : ""),
        file = propertyOnly ? properties : mutant.file,
        pattern = propertyOnly ? mutant.propertyPattern : mutant.pattern;
      const record = {
        id,
        applied: false,
        executed: false,
        killed: false,
        restored: false,
      };
      try {
        const baseline = execute(
          file,
          pattern,
          `reports/sql-mutants/${id}-baseline.json`,
        );
        assert.equal(baseline.run.status, 0, "Mutation baseline failed");
        const expected = baseline.cases.map((r) => r.name);
        assertInventory(expected, baseline.cases);
        await mutant.apply();
        record.applied = true;
        const result = execute(file, pattern, `reports/sql-mutants/${id}.json`);
        record.executed = true;
        assert.deepEqual(
          result.cases.map((a) => a.name).sort(),
          expected.slice().sort(),
          "Incomplete mutation inventory",
        );
        assert(
          result.cases.every((r) => ["passed", "failed"].includes(r.status)),
          "Skipped mutant test",
        );
        const failures = result.report.testResults
          .flatMap((r) => r.assertionResults)
          .filter(
            (r) =>
              r.status === "failed" && new RegExp(pattern).test(r.fullName),
          );
        record.killed =
          result.run.status === 1 &&
          failures.length > 0 &&
          failures.every((r) =>
            r.failureMessages.some((m) => assertionFailure(m)),
          );
        record.failedTests = failures.map((r) => r.fullName);
        record.expectedTests = expected;
        record.exitCode = result.run.status;
        assert(
          record.killed,
          `Mutant survived or infrastructure failed: ${id}`,
        );
      } finally {
        await restore();
        record.restored = true;
        records.push(record);
        writeFileSync(
          "reports/sql-mutants.json",
          JSON.stringify(records, null, 2),
        );
      }
      assertMutant(record);
    }
  }
} finally {
  await restore();
  await db.end();
}
run("node_modules/.bin/vitest", ["run", "--project", "integration"]);
console.log(
  `${records.length} actual SQL/API faults killed and schema independently restored; full restored integration suite passed.`,
);
