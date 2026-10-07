# E2-S2 production release — 2026-10-06

Date: 2026-10-06 (America/Los_Angeles); hosted verification finished by 2026-10-07T00:05:21Z.
The user's explicit **“push to prod”** request separately authorized the normal fast-forward production push, additive hosted migration, and deployment to the existing pilot. It supersedes the implementation task's no-production boundary for this release; the observable feature contract and dependencies are unchanged.

## Release identity

- Application: https://license-radar.vercel.app; register: https://license-radar.vercel.app/practice/register.
- Vercel project: `license-radar`, `prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF`, scope `arsens-projects-630b84fe`. Existing Next.js production environment retained.
- Supabase project: `vowgvmpxkctoqjoqfkqp`; hosted PostgreSQL 17.11.
- Repository/production branch: https://github.com/arsenaid-yere1/license-radar.git, `main`. Remote baseline `93f058bdd31f0a9cbbcdebb8b397a90c6708a478` was rechecked immediately before finalization.
- Exact tested/staged committed archive: `e8cca669b8c056b998cca178fd9bfc82f6f5567e`. It contains the source tested at `411ab8dc0cf4fbe7ecea2e378a4449e2361a2838` plus thoughts-only evidence.
- Verified archive/source SHA-256: `00cde850b87a2264c774ab1ca7c3c174090e467737ed73546a2e8d8ac58664ab`, 174 non-thought source inputs. Archive hash independently matched the clean source and actual gauntlet.
- Gauntlet: `d474a1b4-2df3-4aef-83e7-49192e87ce3c`, **31/31 passed**. Unit 217/217, integration 86/86, browser 32/32; both mutation scores 100%; executable application lines 722/722. Full commands, fault counts, branch-coverage limits and autonomous-review boundaries: `thoughts/shared/research/2026-10-06-e2-s2-implementation-evidence.md`.
- Promoted READY deployment: `dpl_4zCh7FBKG6VHSycut5yhcN2EmX9j`, https://license-radar-dj3uus6k0-arsens-projects-630b84fe.vercel.app.
- Previous live READY deployment for application rollback: `dpl_auGTa3UJPEbG4xFoc6hjnYXchjee`, https://license-radar-9977v2kt8-arsens-projects-630b84fe.vercel.app.

## Coordinated rollout

1. Built the archive with `git archive HEAD`; independently hashed every tracked non-thought input. Vercel 62.4.0 dry upload detected Next.js, 200 files, 2005838 bytes. Every uploaded path was committed. Private environment files, dependencies, tools/caches, reports, coverage and build outputs were absent; only `.env.example` was included. No new tool or dependency was installed.
2. `vercel deploy <archive> --prod --skip-domain --yes --project prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF --scope arsens-projects-630b84fe` built the committed archive using the production environment, with source commit/hash and gauntlet ID as deployment metadata. Next.js 16.3.8 compilation, type checking, page generation including `/practice/register` and deployment passed. The public hostname was independently verified to remain on the previous deployment until promotion.
3. `supabase db push --project-ref vowgvmpxkctoqjoqfkqp --dry-run --skip-vault --output-format json` found exactly `20261006225257_credential_dates.sql`; no seeds or roles. Pre-migration read-only repeatable-read snapshot compared all nine application catalog sections against the production Git baseline and captured all twelve historical row-set checksums. Unlike the earlier release, this database now contained one clinician, one credential, and two immutable register receipts/audits; they were preserved.
4. `supabase db push --project-ref vowgvmpxkctoqjoqfkqp --skip-vault --yes --output-format json` applied that one additive migration successfully. No hosted reset, seed, role or Vault change.
5. Post-apply read-only snapshot matched every historical row set and all nine new schema-contract sections. A separate read-only projection/cycle check required exactly one initial unknown cycle per credential, revision/number 1, NULL issuer/jurisdiction and dates, no orphan or missing cycles, and correct detailed projections. All passed.
6. Security advisors exactly matched the three pre-existing findings. `vercel promote dpl_4zCh7FBKG6VHSycut5yhcN2EmX9j --yes --scope arsens-projects-630b84fe` succeeded; `vercel alias ls --json --limit 100 --scope arsens-projects-630b84fe` directly confirmed `license-radar.vercel.app` maps to that deployment ID.
7. Hosted HTTP/API probes passed, followed by a final read-only data/schema/cycle snapshot. Final migration dry-run reported `upToDate:true` with zero pending migrations, seeds or roles.

The first CLI-help attempt needed permission for its normal local telemetry-state write; the first Vercel dry run needed network access. Both succeeded through normal reviewed execution. The read-query CLI requires `--linked` alongside `--project-ref`; the initial rejected target invocation executed no SQL. `--output json` is not the structured workflow flag for migration push; the successful dry run was repeated with documented `--output-format json` before applying. These were operational command corrections, not changes to the migration or verification gates.

## Hosted data preservation

All twelve historical row sets remained identical across migration and hosted probes. Credential checksums cover every original column (excluding only the two additive metadata columns); all other tables compare complete row objects. Rows were canonically sorted as JSONB before whole-row-set MD5 aggregation, without exporting private record contents.

| Table | Rows | Original-row-set MD5 |
| --- | --- | --- |
| `private.practice_access_events` | 1 | `f41832c5dbc23c2c564d36c3ccdf1a06` |
| `private.practice_audit_events` | 1 | `b347fc9bffb71db1d215e1a21eb97add` |
| `private.practice_invitations` | 0 | `d751713988987e9331980363e24189ce` |
| `private.practice_recipient_events` | 1 | `166e73a1ee2cb82992d98b049b470e9e` |
| `private.practice_reminder_settings` | 1 | `e9c074ea01aa1e4a4f7276c92ceefeff` |
| `private.register_audit_events` | 2 | `aa35d98e6a5e76d0620c97cc7aa73298` |
| `private.register_create_requests` | 2 | `0d462ef0750e8831680dafe0a590d6f8` |
| `public.clinicians` | 1 | `be1cb397135d26479e1f1b977121690a` |
| `public.credentials` | 1 | `8dfb5b58bad94c3dce4f29bf6adedd4c` |
| `public.policy_coverage` | 0 | `d751713988987e9331980363e24189ce` |
| `public.practice_memberships` | 1 | `198599bc1f21a259fe8451815b987b05` |
| `public.practices` | 1 | `60cf5a0ca48f5b35611c5a078b3891e2` |

Exactly 1 unknown initial cycle was backfilled. Cycle row-set MD5 `7b78750c634b4a9602d800f2edf779e4` also remained identical after smoke probes. Every existing credential has NULL issuer/jurisdiction; every initial cycle has NULL dates, number/revision 1, and a matching practice/credential reference. No new creation audit, receipt, clinician, credential, coverage link, membership, invitation, practice edit or recipient change was created by release verification.

| Application catalog section | Compared rows | Result |
| --- | --- | --- |
| columns | 113 | Matched |
| constraints | 96 | Matched |
| functions | 55 | Matched |
| grants | 499 | Matched |
| indexes | 48 | Matched |
| policies | 6 | Matched |
| rls | 13 | Matched |
| schemas | 1 | Matched |
| triggers | 7 | Matched |

Hosted normalization excludes only the platform `public.rls_auto_enable()`, hosted `service_role` function/table grants, and shared public-schema ACL. All application definitions, remaining client grants and private-schema ACLs are preserved. Equivalent policy-role representations and ACL ordering are normalized; JSON object key order is immaterial.

Supabase security advisors remained exactly the existing three warnings: platform `public.rls_auto_enable()` anonymous/authenticated execution and disabled leaked-password protection. No new findings.

## Hosted smoke and acceptance boundary

- `/login` and `/join`: HTTP 200. Anonymous `/practice`, `/practice/team`, `/practice/register`: HTTP 307 to `/login` with `private, no-store, max-age=0`.
- Detailed credential create, legacy credential create, clinician create and register list RPCs: anonymous HTTP 401 / PostgreSQL `42501`. Anonymous cycle SELECT likewise denied. Probes used only an unprivileged publishable key selected in memory and nonexistent dummy IDs; no API-key values were printed or retained.
- Read-only browser inspection of the production register entry reached the working sign-in page. The selected browser had no authenticated session; no email/code was requested and no form was submitted. Authenticated hosted creation and user manual acceptance are **not claimed**; they remain covered by the real local SQL/API/browser suites within the documented evidence limits.
- A final snapshot independently confirmed all historical rows and the entire new cycle row set remained unchanged after probes. Sanitized operational evidence is under ignored `reports/e2-s2-production-*`.

## Recovery and final repository checkpoint

For application rollback, promote the previous READY deployment ID above and retain the additive metadata/cycle schema and saved records. The original create API and historical receipt results remain compatible. Prefer forward repair; never drop cycles, delete saved dates, rewrite receipts or reset production to undo the release.

Date entry is now live; editing/archive, duplicate review, calendar, phone/SMS enrollment, consent, jobs, catch-up and scheduling remain future work. Text reminders remain inactive. Existing SMTP configuration is unchanged.

After the exact tested archive was promoted, tracked finalization changes are limited to README hosted-status corrections and thoughts-only release/plan/spec/evidence records. Runtime code, dependencies, migrations and verification scripts remain identical to the tested/promoted archive. README participates in the whole-source hash, so this documentation checkpoint has a different whole-source hash; it is not represented as a new 31-layer runtime run. The user-authorized final checkpoint is pushed normally to production `main` without force. The existing Git integration may rebuild that documentation checkpoint with identical runtime inputs.
