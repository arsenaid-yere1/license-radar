import { Client } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { catalog } from "./schema-catalog.mjs";
import { assertSchema } from "./gauntlet-contract.mjs";
import { localConfig } from "./local-environment.mjs";
const files = [
  { path: "supabase/tests/practice_profiles.test.sql", plan: 20 },
  { path: "supabase/tests/practice_access.test.sql", plan: 16 },
  { path: "supabase/tests/practice_invitations.test.sql", plan: 16 },
  { path: "supabase/tests/practice_recipients.test.sql", plan: 20 },
  { path: "supabase/tests/practice_register.test.sql", plan: 22 },
  { path: "supabase/tests/practice_credential_dates.test.sql", plan: 22 },
  { path: "supabase/tests/practice_register_maintenance.test.sql", plan: 27 },
  { path: "supabase/tests/practice_sms_enrollment.test.sql", plan: 20 },
];
const cases = files.map((file) => ({
  id: `baseline-${file.plan}-${file.path}`,
  file,
  mutation: "",
  expected: [],
}));
cases.push(
  {
    id: "owner-fk",
    file: files[0],
    mutation:
      "alter table public.practices drop constraint practices_owner_user_id_fkey",
    expected: ["N04 owner foreign key restricts deletion"],
  },
  {
    id: "profile-audit-fks",
    file: files[0],
    mutation:
      "alter table private.practice_audit_events drop constraint practice_audit_events_practice_id_fkey, drop constraint practice_audit_events_actor_user_id_fkey",
    expected: ["N04 audit practice and actor foreign keys restrict deletion"],
  },
);
for (const [table, constraint] of [
  ["public.practice_memberships", "practice_memberships_practice_id_fkey"],
  ["public.practice_memberships", "practice_memberships_user_id_fkey"],
  ["private.practice_invitations", "practice_invitations_practice_id_fkey"],
  ["private.practice_invitations", "practice_invitations_creator_user_id_fkey"],
  [
    "private.practice_invitations",
    "practice_invitations_accepted_user_id_fkey",
  ],
  ["private.practice_access_events", "practice_access_events_practice_id_fkey"],
  [
    "private.practice_access_events",
    "practice_access_events_actor_user_id_fkey",
  ],
  [
    "private.practice_access_events",
    "practice_access_events_membership_id_fkey",
  ],
  [
    "private.practice_access_events",
    "practice_access_events_invitation_id_fkey",
  ],
])
  cases.push({
    id: constraint,
    file: files[1],
    mutation: `alter table ${table} drop constraint ${constraint}`,
    expected: [
      "N04 membership invitation and access foreign keys restrict deletion",
    ],
  });
cases.push(
  {
    id: "active-user-index",
    file: files[1],
    mutation: "drop index public.practice_memberships_one_active_user",
    expected: ["N02 active user partial uniqueness"],
  },
  {
    id: "last-admin-trigger",
    file: files[1],
    mutation:
      "drop trigger membership_requires_administrator on public.practice_memberships",
    expected: ["S37 both deferred administrator invariants"],
  },
  {
    id: "private-invitation-grant",
    file: files[2],
    mutation: "grant select on private.practice_invitations to authenticated",
    expected: ["N04 private invitations denied"],
  },
  {
    id: "anonymous-accept-grant",
    file: files[2],
    mutation:
      "grant execute on function public.accept_practice_invitation(text) to anon",
    expected: ["S33 anonymous accept denied"],
  },
);
for (const [table, constraint, composite] of [
  [
    "private.practice_reminder_settings",
    "practice_reminder_settings_practice_id_fkey",
    false,
  ],
  [
    "private.practice_reminder_settings",
    "practice_reminder_settings_member_fkey",
    true,
  ],
  [
    "private.practice_recipient_events",
    "practice_recipient_events_practice_id_fkey",
    false,
  ],
  [
    "private.practice_recipient_events",
    "practice_recipient_events_actor_user_id_fkey",
    false,
  ],
  [
    "private.practice_recipient_events",
    "practice_recipient_events_before_fkey",
    true,
  ],
  [
    "private.practice_recipient_events",
    "practice_recipient_events_after_fkey",
    true,
  ],
])
  cases.push({
    id: constraint,
    file: files[3],
    mutation: `alter table ${table} drop constraint ${constraint}`,
    expected: [
      "R12 recipient foreign keys restrict deletion",
      ...(composite ? ["R12 composite tenant references"] : []),
    ],
  });
cases.push(
  {
    id: "recipient-private-grant",
    file: files[3],
    mutation:
      "grant select on private.practice_recipient_events to authenticated",
    expected: ["R11 recipient audit denied"],
  },
  {
    id: "recipient-anonymous-rpc",
    file: files[3],
    mutation:
      "grant execute on function public.set_practice_reminder_recipient(uuid,uuid,integer) to anon",
    expected: ["R11 anonymous assignment denied"],
  },
);

for (const [table, constraint, composite] of [
  ["public.clinicians", "clinicians_practice_id_fkey", false],
  ["public.credentials", "credentials_practice_id_fkey", false],
  ["public.credentials", "credentials_owner_fkey", true],
  ["public.policy_coverage", "policy_coverage_practice_id_fkey", false],
  ["public.policy_coverage", "policy_coverage_credential_fkey", true],
  ["public.policy_coverage", "policy_coverage_clinician_fkey", true],
  [
    "private.register_create_requests",
    "register_create_requests_practice_id_fkey",
    false,
  ],
  [
    "private.register_create_requests",
    "register_create_requests_actor_user_id_fkey",
    false,
  ],
  [
    "private.register_audit_events",
    "register_audit_events_practice_id_fkey",
    false,
  ],
  [
    "private.register_audit_events",
    "register_audit_events_actor_user_id_fkey",
    false,
  ],
  ["private.register_audit_events", "register_audit_clinician_fkey", true],
  ["private.register_audit_events", "register_audit_credential_fkey", true],
])
  cases.push({
    id: constraint,
    file: files[4],
    mutation: `alter table ${table} drop constraint ${constraint}`,
    expected: [
      "G07 register foreign keys restrict deletion",
      ...(composite ? ["G07 register composite references"] : []),
    ],
  });
for (const [id, mutation, expected] of [
  [
    "register-owner-shape",
    "alter table public.credentials drop constraint credentials_owner_shape",
    ["G07 register owner shape constraint"],
  ],
  [
    "register-null-discriminator",
    "alter table public.policy_coverage alter column type drop not null",
    [
      "G08 register discriminator NULL defense",
      "G08 register NULL discriminator rejected",
    ],
  ],
  [
    "register-name-check",
    "alter table public.clinicians drop constraint clinicians_name_check",
    ["G09 register blank name constraint"],
  ],
  [
    "register-version-check",
    "alter table public.clinicians drop constraint clinicians_version_check",
    ["G09 register positive version constraint"],
  ],
  [
    "register-private-grant",
    "grant select on private.register_audit_events to authenticated",
    ["A01 register private storage denied"],
  ],
  [
    "register-anonymous-grant",
    "grant execute on function public.create_practice_clinician(uuid,uuid,text) to anon",
    ["A01 register anonymous RPC denied"],
  ],
])
  cases.push({ id, file: files[4], mutation, expected });
for (const [id, mutation, expected] of [
  [
    "cycle-practice-fk",
    "alter table public.credential_cycles drop constraint credential_cycles_practice_id_fkey",
    ["D10 cycle restrictive foreign keys"],
  ],
  [
    "cycle-credential-fk",
    "alter table public.credential_cycles drop constraint credential_cycles_credential_fkey",
    ["D10 cycle restrictive foreign keys", "D10 cycle composite reference"],
  ],
  [
    "cycle-read-grant",
    "revoke select on public.credential_cycles from authenticated",
    ["D10 cycle read grant"],
  ],
  [
    "cycle-dml-grant",
    "grant insert on public.credential_cycles to authenticated",
    ["D10 cycle DML denied"],
  ],
  [
    "cycle-anonymous-grant",
    "grant select on public.credential_cycles to anon",
    ["D10 cycle anonymous denied"],
  ],
  [
    "cycle-rpc-anonymous",
    "grant execute on function public.create_practice_credential_with_details(uuid,uuid,text,text,text,uuid,uuid[],text,text,text,text) to anon",
    ["D10 detailed anonymous denied"],
  ],
  [
    "cycle-revision",
    "alter table public.credential_cycles drop constraint credential_cycles_date_revision_check",
    ["D10 positive date revision"],
  ],
  [
    "cycle-number",
    "alter table public.credential_cycles drop constraint credential_cycles_cycle_number_check",
    ["D10 positive cycle number", "D10 initial cycle uniqueness"],
  ],
  [
    "cycle-end-range",
    "alter table public.credential_cycles drop constraint credential_cycles_end_date_check",
    ["D10 end date range"],
  ],
  [
    "cycle-action-range",
    "alter table public.credential_cycles drop constraint credential_cycles_action_deadline_check",
    ["D10 action date range"],
  ],
  [
    "cycle-order",
    "alter table public.credential_cycles drop constraint credential_cycles_order_check",
    ["D10 strict earlier ordering"],
  ],
  [
    "cycle-uniqueness",
    "alter table public.credential_cycles drop constraint credential_cycles_practice_id_credential_id_cycle_number_key",
    ["D10 initial cycle uniqueness"],
  ],
  [
    "credential-issuer",
    "alter table public.credentials drop constraint credentials_issuer_check",
    ["D10 issuer constraint"],
  ],
  [
    "credential-jurisdiction",
    "alter table public.credentials drop constraint credentials_jurisdiction_check",
    ["D10 jurisdiction constraint"],
  ],
])
  cases.push({ id, file: files[5], mutation, expected });
// Removing initialization intentionally makes detailed-create fail. Run the exact
// metadata TAP prefix here; the API mutant independently exercises that failure.
cases.push({
  id: "cycle-trigger",
  file: { ...files[5], plan: 10 },
  metadataOnly: true,
  mutation: "drop trigger initialize_credential_cycle on public.credentials",
  expected: ["D10 initial cycle trigger"],
});

for (const [id, mutation, expected] of [
  [
    "change-receipt-rls",
    "alter table private.register_change_requests disable row level security",
    ["M09 change receipt RLS"],
  ],
  [
    "change-receipt-auth-grant",
    "grant select on private.register_change_requests to authenticated",
    ["M09 change receipt private denied"],
  ],
  [
    "change-receipt-anon-grant",
    "grant select on private.register_change_requests to anon",
    ["M09 change receipt anonymous denied"],
  ],
  [
    "change-caller-unique",
    "alter table private.register_change_requests drop constraint register_change_requests_practice_id_actor_user_id_request__key",
    [
      "M09 change caller request uniqueness",
      "M09 SQL duplicate mutation receipt rejected",
    ],
  ],
  [
    "change-before-shape",
    "alter table private.register_audit_events drop constraint register_audit_events_before_data_check",
    [
      "M09 SQL update requires before data",
      "M09 SQL creation still requires null before data",
    ],
  ],
  [
    "change-active-index",
    "drop index public.credentials_active_practice_idx",
    ["M09 active partial index"],
  ],
  [
    "change-audit-op",
    "alter table private.register_audit_events drop constraint register_audit_events_operation_check",
    ["M09 audit maintenance operations"],
  ],
  [
    "change-projection-grant",
    "grant execute on function private.credential_maintenance_projection(public.credentials) to authenticated",
    ["M09 maintenance projection private"],
  ],
  [
    "change-duplicate-grant",
    "grant execute on function private.credential_duplicate_ids(public.credentials) to authenticated",
    ["M09 duplicate helpers private"],
  ],
  [
    "change-normalize-grant",
    "grant execute on function private.duplicate_text(text) to authenticated",
    ["M09 duplicate helpers private"],
  ],
  [
    "change-replay-grant",
    "grant execute on function private.register_change_replay(uuid,uuid,text,jsonb) to authenticated",
    ["M09 change replay private"],
  ],
  [
    "change-finish-grant",
    "grant execute on function private.finish_register_change(uuid,uuid,uuid,text,jsonb,jsonb,jsonb) to authenticated",
    ["M09 change finish private"],
  ],
  [
    "change-apply-grant",
    "grant execute on function private.apply_credential_change(uuid,uuid,uuid,integer,uuid,integer,jsonb) to authenticated",
    ["M09 change finish private"],
  ],
  [
    "change-values-grant",
    "grant execute on function private.credential_change_values(text,text,text,uuid,uuid[],text,text,text,text) to authenticated",
    ["M09 change finish private"],
  ],
  [
    "change-archive-anon",
    "grant execute on function public.archive_practice_credential(uuid,uuid,uuid,integer,uuid,integer) to anon",
    ["M09 archive anonymous denied"],
  ],
  [
    "change-update-anon",
    "grant execute on function public.update_practice_credential(uuid,uuid,uuid,integer,uuid,integer,text,text,text,uuid,uuid[],text,text,text,text) to anon",
    ["M09 update anonymous denied"],
  ],
  [
    "change-archive-definer",
    "alter function public.archive_practice_credential(uuid,uuid,uuid,integer,uuid,integer) security definer",
    ["M09 archive invoker wrapper"],
  ],
  [
    "change-update-definer",
    "alter function public.update_practice_credential(uuid,uuid,uuid,integer,uuid,integer,text,text,text,uuid,uuid[],text,text,text,text) security definer",
    ["M09 update invoker wrapper"],
  ],
  [
    "change-list-definer",
    "alter function public.list_practice_register_with_maintenance(uuid,boolean) security definer",
    ["M09 list invoker wrapper"],
  ],
  [
    "change-archive-entry",
    "revoke execute on function public.archive_practice_credential(uuid,uuid,uuid,integer,uuid,integer) from authenticated",
    ["M09 editor entry grants"],
  ],
  [
    "change-update-entry",
    "revoke execute on function public.update_practice_credential(uuid,uuid,uuid,integer,uuid,integer,text,text,text,uuid,uuid[],text,text,text,text) from authenticated",
    ["M09 editor entry grants"],
  ],
  [
    "change-credential-dml",
    "grant update on public.credentials to authenticated",
    ["M09 credential DML denied"],
  ],
])
  cases.push({ id, file: files[6], mutation, expected });
for (const [constraint, composite] of [
  ["register_change_requests_practice_id_fkey", false],
  ["register_change_requests_actor_user_id_fkey", false],
  ["register_change_credential_fkey", true],
])
  cases.push({
    id: constraint,
    file: files[6],
    mutation: `alter table private.register_change_requests drop constraint ${constraint}`,
    expected: [
      "M09 change restrictive foreign keys",
      ...(composite ? ["M09 change composite reference"] : []),
    ],
  });
for (const [id, mutation, expected] of [
  [
    "sms-sms_phone_endpoints-rls",
    "alter table private.sms_phone_endpoints disable row level security",
    ["SMS sms_phone_endpoints RLS"],
  ],
  [
    "sms-sms_phone_endpoints-grant",
    "grant select on private.sms_phone_endpoints to authenticated",
    ["SMS sms_phone_endpoints private"],
  ],
  [
    "sms-practice_sms_enrollments-rls",
    "alter table private.practice_sms_enrollments disable row level security",
    ["SMS practice_sms_enrollments RLS"],
  ],
  [
    "sms-practice_sms_enrollments-grant",
    "grant select on private.practice_sms_enrollments to authenticated",
    ["SMS practice_sms_enrollments private"],
  ],
  [
    "sms-sms_enrollment_events-rls",
    "alter table private.sms_enrollment_events disable row level security",
    ["SMS sms_enrollment_events RLS"],
  ],
  [
    "sms-sms_enrollment_events-grant",
    "grant select on private.sms_enrollment_events to authenticated",
    ["SMS sms_enrollment_events private"],
  ],
  [
    "sms-sms_verification_challenges-rls",
    "alter table private.sms_verification_challenges disable row level security",
    ["SMS sms_verification_challenges RLS"],
  ],
  [
    "sms-sms_verification_challenges-grant",
    "grant select on private.sms_verification_challenges to authenticated",
    ["SMS sms_verification_challenges private"],
  ],
  [
    "sms-sms_verification_requests-rls",
    "alter table private.sms_verification_requests disable row level security",
    ["SMS sms_verification_requests RLS"],
  ],
  [
    "sms-sms_verification_requests-grant",
    "grant select on private.sms_verification_requests to authenticated",
    ["SMS sms_verification_requests private"],
  ],
  [
    "sms-sms_action_receipts-rls",
    "alter table private.sms_action_receipts disable row level security",
    ["SMS sms_action_receipts RLS"],
  ],
  [
    "sms-sms_action_receipts-grant",
    "grant select on private.sms_action_receipts to authenticated",
    ["SMS sms_action_receipts private"],
  ],
  [
    "sms-sms_provider_events-rls",
    "alter table private.sms_provider_events disable row level security",
    ["SMS sms_provider_events RLS"],
  ],
  [
    "sms-sms_provider_events-grant",
    "grant select on private.sms_provider_events to authenticated",
    ["SMS sms_provider_events private"],
  ],
  [
    "sms-service-grant",
    "grant execute on function public.claim_sms_verification_send(uuid,uuid,uuid) to authenticated",
    ["SMS proof only service"],
  ],
  [
    "sms-owner-grant",
    "revoke execute on function public.get_my_practice_sms_enrollment(uuid) from authenticated",
    ["SMS owner entry grants"],
  ],
  [
    "sms-wrapper-definer",
    "alter function public.get_my_practice_sms_enrollment(uuid) security definer",
    ["SMS invoker wrappers"],
  ],
  [
    "sms-helper-grant",
    "grant execute on function private.sms_member(uuid,uuid,boolean) to authenticated",
    ["SMS internal helpers denied"],
  ],
  [
    "sms-consent-fk",
    "alter table private.practice_sms_enrollments drop constraint practice_sms_consent_event_fkey",
    ["SMS restrictive foreign keys", "SMS composite tenant references"],
  ],
])
  cases.push({ id, file: files[7], mutation, expected });
const reports = [];
for (const item of cases) {
  const db = new Client({ connectionString: localConfig().DB_URL });
  await db.connect();
  try {
    const beforeSchema = await catalog(db);
    const before = (
      await db.query(
        "select oid,conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace in ('public'::regnamespace,'private'::regnamespace) order by oid",
      )
    ).rows;
    await db.query("begin");
    if (item.mutation) await db.query(item.mutation);
    let sql = readFileSync(item.file.path, "utf8")
      .replace(/^begin;\n/, "")
      .replace(/rollback;\s*$/, "");
    if (item.metadataOnly)
      sql =
        sql
          .slice(0, sql.indexOf("insert into auth.users"))
          .replace("plan(22)", "plan(10)") + "select finish from finish();";
    const rows = await db.query(sql);
    const messages = rows
      .flatMap((r) => r.rows.flatMap((row) => Object.values(row)))
      .filter((v) => typeof v === "string");
    const assertions = messages.filter((v) => /^(?:not )?ok \d+ - /.test(v));
    const failures = assertions
      .filter((v) => v.startsWith("not ok"))
      .map((v) => v.split(" - ")[1].split("\n")[0]);
    if (
      JSON.stringify(failures) !== JSON.stringify(item.expected) ||
      assertions.length !== item.file.plan ||
      !messages.includes(`1..${item.file.plan}`)
    )
      throw new Error(`Incomplete or unexpected SQL control: ${item.id}`);
    reports.push({
      id: item.id,
      applied: true,
      executed: true,
      assertions: assertions.length,
      failedAssertions: failures,
    });
    await db.query("rollback");
    const restored = (
      await db.query(
        "select oid,conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace in ('public'::regnamespace,'private'::regnamespace) order by oid",
      )
    ).rows;
    assertSchema(await catalog(db), beforeSchema);
    if (JSON.stringify(before) !== JSON.stringify(restored))
      throw new Error("Constraint restore failed");
  } finally {
    await db.query("rollback");
    await db.end();
  }
}
writeFileSync(
  "reports/foreign-key-controls.json",
  JSON.stringify(reports, null, 2),
);
console.log(
  `${files.reduce((n, f) => n + f.plan, 0)} SQL assertions pass; ${cases.length - files.length} applied missing FK/index/invariant/grant controls produced the expected assertion failures and rolled back.`,
);
