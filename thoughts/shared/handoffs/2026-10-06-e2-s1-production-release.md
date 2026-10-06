# E2-S1 production release — 2026-10-06

The user's explicit **“push to prod”** request authorized the implementation checkpoints, normal fast-forward production push, additive hosted migration, and deployment to the existing pilot.

## Release identity

- Application: https://license-radar.vercel.app; register: https://license-radar.vercel.app/practice/register.
- Vercel project: `license-radar`, `prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF`, scope `arsens-projects-630b84fe`, Node `24.x`, Next.js preset.
- Supabase project: `vowgvmpxkctoqjoqfkqp`.
- Production repository/branch: https://github.com/arsenaid-yere1/license-radar.git, `main`.
- Previous production Git baseline: `fc337c1224d18987896f311d45127059aed41f2a`, verified again immediately before release.
- Exact tested/staged committed archive: `888c1a773cf02cc7a523f90ec66323921967ee4e`.
- Source SHA-256: `0e0efe8603d7a0be07af55c85ae6d0748d8fe973fd0dd277a3fed800a75565d5`, 167 non-thoughts inputs; the archive independently matched this hash.
- Gauntlet: `16c41735-1e89-4e92-8502-1ee799bb0fd1`, **30/30 passed**, finished 2026-10-06T22:06:01.666Z. Detailed commands, actual counts, failed-run repairs, and assurance limits: `thoughts/shared/research/2026-10-06-e2-s1-implementation-evidence.md`.
- Promoted deployment: `dpl_3YHhQ6wdyWa2rTowLcMYPXjcVQT3`, https://license-radar-390dqhrd7-arsens-projects-630b84fe.vercel.app.
- Previous live deployment: `dpl_2Uz9VREm2CQRvxVHvhdJd2eGtm8Y`.

## Coordinated rollout

1. The clean archive was built from the committed checkpoint with `git archive`. Vercel dry upload inspection found 187 files, 1775225 bytes, Next.js, and excluded private environment files, dependencies, tools, reports, coverage, browser caches, and build outputs. Only the committed `.env.example` was included.
2. `vercel@62.4.0 deploy --prod --skip-domain --yes --project prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF --scope arsens-projects-630b84fe` built the exact archive with the existing production environment. Compilation, type checking, page generation including `/practice/register`, tracing, and hosted deployment passed. The public hostname continued resolving to the previous release while final verification ran. Earlier archives were staged without promoting the public hostname; the release uses only the final fully verified checkpoint above.
3. `supabase db push --project-ref vowgvmpxkctoqjoqfkqp --dry-run --skip-vault` found exactly `20261006180010_register_ownership.sql`. Pre-apply read-only checks confirmed four existing migration versions, unchanged historical rows, and the old application's nine catalog sections matched its committed contract.
4. After the complete source-bound 30-layer run passed, `supabase db push --project-ref vowgvmpxkctoqjoqfkqp --skip-vault --yes` applied that one additive migration successfully. No seeds, role files, Vault changes, or hosted reset were requested.
5. Post-migration row checksums, empty new tables, and all nine application catalog sections passed before promotion. Two parallel read-only session initializations stalled; they were interrupted and retried sequentially, then completed successfully. This did not rerun or undo the migration.
6. `vercel promote dpl_3YHhQ6wdyWa2rTowLcMYPXjcVQT3 --yes --scope arsens-projects-630b84fe` succeeded. Inspection of the public URL resolved to that READY deployment. The deployment's embedded aliases list omitted the public hostname, so `vercel alias list --json --limit 100 --scope arsens-projects-630b84fe` directly verified `license-radar.vercel.app` maps to the promoted deployment ID.
7. A final migration dry-run returned `upToDate:true` with zero migrations, seeds, or roles pending. Read-only hosted probes and a final combined data snapshot passed.

## Hosted verification

All seven complete historical row sets remained identical across migration and hosted smoke probes:

| Table | Rows | Whole-row-set MD5 |
| --- | --- | --- |
| `private.practice_access_events` | 1 | `f41832c5dbc23c2c564d36c3ccdf1a06` |
| `private.practice_audit_events` | 1 | `b347fc9bffb71db1d215e1a21eb97add` |
| `private.practice_invitations` | 0 | `d751713988987e9331980363e24189ce` |
| `private.practice_recipient_events` | 1 | `166e73a1ee2cb82992d98b049b470e9e` |
| `private.practice_reminder_settings` | 1 | `e9c074ea01aa1e4a4f7276c92ceefeff` |
| `public.practice_memberships` | 1 | `198599bc1f21a259fe8451815b987b05` |
| `public.practices` | 1 | `60cf5a0ca48f5b35611c5a078b3891e2` |

All five new tables remained empty: `public.clinicians`, `public.credentials`, `public.policy_coverage`, `private.register_create_requests`, and `private.register_audit_events`. The migration ledger has the four prior versions plus `20261006180010`. No production fixture account, clinician, credential, policy link, receipt, audit event, invitation, membership, profile edit, or recipient change was created during release verification.

| Application catalog section | Compared rows | Result |
| --- | --- | --- |
| columns | 102 | Matched |
| policies | 5 | Matched |
| functions | 50 | Matched |
| triggers | 6 | Matched |
| grants | 444 | Matched |
| rls | 12 | Matched |
| constraints | 84 | Matched |
| indexes | 44 | Matched |
| schemas | 1 | Matched |

Comparison follows the established hosted normalization: exclude only platform `public.rls_auto_enable()`, hosted `service_role` function/table grants, and the shared public-schema ACL. Preserve every application definition, remaining client grant, and private-schema ACL. Normalize equivalent CLI policy-role representations and ACL ordering; object key ordering is immaterial.

Supabase security advisors reported exactly the same three existing warnings: platform `public.rls_auto_enable()` anonymous and authenticated execution, and disabled leaked-password protection. No new advisor findings appeared.

Automated HTTP checks: `/login` and `/join` returned 200; anonymous `/practice`, `/practice/team`, and `/practice/register` returned 307 to `/login` with `no-store`. All three new public register RPCs rejected anonymous requests with HTTP 401 and PostgreSQL `42501`. The probes used an unprivileged public client key and nonexistent dummy practice/request identifiers. A final snapshot confirmed all historical data and all five empty new tables were unchanged afterward.

Read-only browser inspection of the production register entry reached the sign-in page and confirmed the public interface loaded. The selected in-app browser had no authenticated session; no sign-in code/email was requested and no form was submitted. Hosted authenticated creation/lifecycle acceptance is **not claimed**. Those behaviors are covered by the real local SQL/API suites, full 28-scenario browser suite, and repeated shuffled browser suite. User manual acceptance and independent fresh-context verification remain separately unconfirmed.

Ignored `reports/e2-s1-production-*` files retain sanitized operational evidence. Credentials and protected environment files are excluded from commits and uploads.

## Boundaries and recovery

The released ownership slice separates clinicians from staff, supports state licenses/DEA registrations/malpractice policies with clinician or practice ownership, and represents several covered clinicians with one practice-policy identity. Viewers read; administrators/managers create. Transactional private audits and caller-scoped immutable receipts support exact-key retries after uncertain responses.

Dates, issuer/jurisdiction fields, editing/archive, duplicate review, calendar/cycles, phone enrollment, consent, scheduled messages, and original rule-9 cancellation/catch-up remain future work. Records truthfully show **Dates not entered** and texts remain inactive. E2-S2 is next. Existing Resend SMTP configuration and its documented pilot sender limitation remain unchanged.

For application rollback, promote the prior deployment ID above and preserve the additive register tables, saved data, receipts, and audit history. Prefer forward repair; do not drop real records, reset production, or return to the pre-membership authority model. The local upgrade rehearsal verifies old RPC compatibility and full rollback/replay; hosted historical catalog preservation supplements that evidence.

The only tracked edits after the tested archive are this release record, the implementation/plan completion evidence, and README hosted-status corrections. They change documentation only; the README is included in the whole-source hash, so that documentation checkpoint has a different whole-source hash. Runtime code, dependencies, migrations, and verification scripts remain identical to the tested/promoted archive. The checkpoint is pushed normally to production `main` without force. The existing Git integration may rebuild the documentation checkpoint with identical runtime inputs.
