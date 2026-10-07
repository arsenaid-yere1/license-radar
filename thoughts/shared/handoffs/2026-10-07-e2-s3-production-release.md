# E2-S3 production release — 2026-10-07

The user's explicit **“push to prod”** request authorized the production migration, deployment, and normal fast-forward push to the existing pilot. It supersedes the implementation task's no-production boundary for this release. Hosted verification completed by 2026-10-07T16:01:17Z; repository finalization follows below.

## Release identity

- Application: https://license-radar.vercel.app; register: https://license-radar.vercel.app/practice/register.
- Vercel project: `license-radar`, `prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF`, scope `arsens-projects-630b84fe`. Existing production environment retained.
- Supabase project: `vowgvmpxkctoqjoqfkqp`, PostgreSQL 17.11.
- Repository: https://github.com/arsenaid-yere1/license-radar.git. Production branch `main`; remote baseline `27b728b4578a96d526e7fd25cf8f385284856e3c` rechecked before promotion/finalization.
- Exact staged committed archive: `259ee05e9b3c4da61fd7a8fec4827eb9e7308e68`. It includes the runtime tested at `e67b6e128dfcf7bf14c8a86fa7bfbfb8dba7cd1c` plus thoughts-only evidence.
- Verified archive/source SHA-256: `872b6115d5ea2b8bbd2d76e95275acb3a76938c259d86023b1b94bb9337a67ff`, 184 tracked non-thought inputs. Independently reproduced from the archive and matched the clean source and gauntlet.
- Gauntlet `5e3f2dde-4aef-44d8-906f-3f80f3e89dc2`: **32/32 passed**. Unit 237, integration 98, browser 40; both mutation scores 100%; executable application lines 873/873. Exact commands, controls, coverage and acceptance limits: `thoughts/shared/research/2026-10-06-e2-s3-implementation-evidence.md`.
- Promoted READY deployment: `dpl_S5QCeKNsSQja8Cg3BpzMuswHdquT`, https://license-radar-4dgae1f1a-arsens-projects-630b84fe.vercel.app.
- Previous live READY deployment for application rollback: `dpl_2yuWhxzurnM7ngjiSGtKGDrGamum`, https://license-radar-qrlgsmyaw-arsens-projects-630b84fe.vercel.app. This is the live deployment observed at this release, rather than the earlier manual E2-S2 deployment.

## Rollout and command results

All commands used the existing Node 24.21.0 runtime via `PATH="$PWD/.tools/node/bin:$PATH"`. Supabase CLI stayed at pinned 2.119.0; the existing cached Vercel CLI stayed at 62.4.0. No dependencies, tool versions, environment values, SMTP settings, seeds, roles, or Vault secrets were changed.

| Command/check                                                                                                                     | Result                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git ls-remote origin refs/heads/main`, `git status --short`, `sourceState()`                                                     | Expected remote baseline, clean tree, source hash matches the successful gauntlet                                                                                    |
| `git archive HEAD`, independent archive hashing                                                                                   | Exact committed inputs match the tested source                                                                                                                       |
| `vercel deploy <archive> --prod --skip-domain --yes --dry --json --project <id> --scope <scope>`                                  | Next.js detected; 216 files, 2334476 bytes; every upload path committed and SHA-1/size matched; private environment files, caches, dependencies and reports excluded |
| `vercel deploy <archive> --prod --skip-domain --yes --project <id> --scope <scope>` with source commit/hash and gauntlet metadata | READY; Next.js 16.3.8 production compilation, type checking, page generation and deployment passed                                                                   |
| `vercel alias ls --json --limit 100 --scope <scope>` before migration                                                             | Main public hostname still mapped to previous deployment                                                                                                             |
| `supabase db push --project-ref <ref> --dry-run --skip-vault --output-format json`                                                | Exactly `20261007004303_register_maintenance.sql`; no seeds or roles                                                                                                 |
| `supabase db query --linked --project-ref <ref> --file <snapshot.sql> --output-format json` before migration                      | Read-only repeatable-read catalog matches previous Git schema contract; 13 historical data sets captured as counts/checksums only                                    |
| `supabase db push --project-ref <ref> --skip-vault --yes --output-format json`                                                    | The one verified additive migration applied successfully                                                                                                             |
| Same read-only snapshot after migration and after hosted probes                                                                   | Every historical row set unchanged; nine catalog sections match new tested contract; no archives/change receipts/missing cycles                                      |
| `supabase db push --project-ref <ref> --dry-run --skip-vault --output-format json` after apply                                    | `upToDate:true`; zero migrations, seeds or roles pending                                                                                                             |
| `vercel promote dpl_S5QCeKNsSQja8Cg3BpzMuswHdquT --yes --scope <scope>`                                                           | Success; independent alias lookup confirms live hostname maps to that deployment                                                                                     |
| Hosted HTTP and anonymous API probes                                                                                              | All six routes and eight API/read denial checks passed; no data writes                                                                                               |
| Authenticated browser read-only inspection                                                                                        | Active and archived views loaded; archived view says “No archived records” and hides creation forms                                                                  |
| Supabase Security Advisor browser inspection and refresh                                                                          | Zero errors; same three warning identities as preceding release                                                                                                      |

Help was inspected for release commands before use. The Supabase changelog Markdown was fetched successfully with HTTP after the web reader rejected its content type; the September PostgreSQL minor-release notice concerns extension indexes/legacy encryption, with no extension or encrypted-data changes in this migration. Migration deployment follows the [official migration workflow](https://supabase.com/docs/guides/deployment/database-migrations). The Vercel remote builder emitted the existing `unrs-resolver` install-script approval warning; the production build and deployment completed successfully. A command-scoped `caffeinate -disu` guard covered staging, with no persistent power-setting changes.

## Hosted preservation evidence

Whole original-column row objects were canonically sorted as JSONB before MD5 aggregation. Credential comparisons exclude only the new `archived_at` column; all other original credential columns and every column of other historical tables are included. No private row contents or API-key values were printed/exported. These values describe the database at this release; the prior release's row counts are historical and are not assumed to remain constant between releases.

| Historical table                     | Rows | Original-row-set MD5               |
| ------------------------------------ | ---- | ---------------------------------- |
| `private.practice_access_events`     | 1    | `f41832c5dbc23c2c564d36c3ccdf1a06` |
| `private.practice_audit_events`      | 0    | `d751713988987e9331980363e24189ce` |
| `private.practice_invitations`       | 0    | `d751713988987e9331980363e24189ce` |
| `private.practice_recipient_events`  | 1    | `166e73a1ee2cb82992d98b049b470e9e` |
| `private.practice_reminder_settings` | 1    | `e9c074ea01aa1e4a4f7276c92ceefeff` |
| `private.register_audit_events`      | 1    | `fcfd9742a9de947b15d1c7fc2980111e` |
| `private.register_create_requests`   | 2    | `0d462ef0750e8831680dafe0a590d6f8` |
| `public.clinicians`                  | 1    | `be1cb397135d26479e1f1b977121690a` |
| `public.credential_cycles`           | 0    | `d751713988987e9331980363e24189ce` |
| `public.credentials`                 | 0    | `d751713988987e9331980363e24189ce` |
| `public.policy_coverage`             | 0    | `d751713988987e9331980363e24189ce` |
| `public.practice_memberships`        | 1    | `198599bc1f21a259fe8451815b987b05` |
| `public.practices`                   | 1    | `60cf5a0ca48f5b35611c5a078b3891e2` |

`private.register_change_requests` remains empty after deployment/probes. There are zero archived credentials and zero missing initial cycles. Existing historical retry receipts were preserved. The live register was empty before migration, so hosted preservation does not prove a populated credential upgrade; the successful local maintenance-upgrade rehearsal covers 18 credentials/cycles/creation receipts, retained original values, edit/archive operations, exact replays, and transactional rollback.

| Catalog section | Compared rows | Result  |
| --------------- | ------------- | ------- |
| columns         | 123           | Matched |
| constraints     | 102           | Matched |
| functions       | 68            | Matched |
| grants          | 540           | Matched |
| indexes         | 53            | Matched |
| policies        | 6             | Matched |
| rls             | 14            | Matched |
| schemas         | 1             | Matched |
| triggers        | 7             | Matched |

Normalization is unchanged from prior releases: exclude platform `public.rls_auto_enable()`, hosted `service_role` function/table grants, and shared public-schema ACL; normalize ACL/policy-role ordering and JSON object key order. All application definitions, remaining client grants, and private-schema ACLs match. The manual Security Advisor check showed the same existing warnings: anonymous and authenticated execution of platform `public.rls_auto_enable()`, plus disabled leaked-password protection. This browser observation is distinct from the automated catalog comparison.

## Hosted acceptance boundary

- `/login` and `/join`: HTTP 200. Anonymous `/practice`, `/practice/team`, active register and archived register: HTTP 307 to `/login` with `private, no-store, max-age=0`.
- New update/archive/maintenance-list RPCs, existing clinician/legacy/detailed creation and list RPCs: anonymous HTTP 401 / PostgreSQL `42501`. Anonymous cycle SELECT also denied. Only an unprivileged publishable key was selected in memory; dummy nonexistent IDs prevented any production record mutation.
- The existing authenticated Chrome session loaded both register views. No new login code was requested, no clinician/credential form was submitted, and no existing record was edited/archived. Empty-register view rendering is confirmed; hosted write workflows and user manual acceptance are **not claimed**. Real populated local SQL/API/browser tests cover those workflows within the implementation evidence's stated limits.
- Final read-only snapshot independently confirmed data/schema identity after probes. Sanitized operational evidence is under ignored `reports/e2-s3-production-*`; temporary release/verification helpers are outside tracked source.

## Recovery and repository finalization

For application rollback, promote the previous READY deployment above while retaining the additive migration and all saved records. Legacy register reads also exclude archived records. Prefer forward repair; do not drop the receipt table/archive column, rewrite historical receipts, restore obsolete credential values, or reset production to undo this release.

Editing, retained archiving and advisory duplicate review are now live. Restoration/deletion, calendar, jobs/cancellation and text dispatch remain future work. SMS is inactive; E3 event reads must exclude archived inventory and E4 must handle unsent-job invalidation/cancellation when that infrastructure exists.

After promotion, tracked finalization edits are restricted to README hosted-status corrections and this release record. Runtime code, migrations, dependencies and verification tooling remain identical to the tested/promoted archive. README participates in the whole-source hash, so the documentation checkpoint is not represented as a new 32-layer gauntlet run. The user-authorized checkpoint is pushed normally to production `main` without force; Git integration may rebuild the checkpoint with identical runtime inputs. Formatting, diff/secret checks and remote push verification are run for that checkpoint.
