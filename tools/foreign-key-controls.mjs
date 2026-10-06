import { Client } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { localConfig } from "./local-environment.mjs";
const files = [
  { path: "supabase/tests/practice_profiles.test.sql", plan: 20 },
  { path: "supabase/tests/practice_access.test.sql", plan: 16 },
  { path: "supabase/tests/practice_invitations.test.sql", plan: 16 },
  { path: "supabase/tests/practice_recipients.test.sql", plan: 20 },
  { path: "supabase/tests/practice_register.test.sql", plan: 22 },
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
const reports = [];
for (const item of cases) {
  const db = new Client({ connectionString: localConfig().DB_URL });
  await db.connect();
  try {
    const before = (
      await db.query(
        "select oid,conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace in ('public'::regnamespace,'private'::regnamespace) order by oid",
      )
    ).rows;
    await db.query("begin");
    if (item.mutation) await db.query(item.mutation);
    const sql = readFileSync(item.file.path, "utf8")
      .replace(/^begin;\n/, "")
      .replace(/rollback;\s*$/, "");
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
