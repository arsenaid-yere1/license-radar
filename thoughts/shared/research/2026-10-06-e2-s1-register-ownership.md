# E2-S1: Register ownership research

Date: 2026-10-06 (America/Los_Angeles).
Source: `fc337c1224d18987896f311d45127059aed41f2a`.
Status: Repository research and planning baseline; no implementation changes.

## Next story and scope

`README.md:32` names E2-S1 as next. The backlog in `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md:172` says: create clinician and practice-owned records; allow multiple records per clinician; represent shared policies without duplicate reminders; keep owners within their practice. E2-S2 owns dates and type-specific issuer/jurisdiction data, and E2-S3 owns editing/archiving. Those are distinct delivery boundaries.

`thoughts/shared/handoffs/2026-10-05-e1-s3-production-release.md` records the live E1-S3 recipient foundation and its local 29-layer verification. Phone enrollment, scheduling, and recipient rule-9 cancellation/catch-up are still future work. This turn did not independently probe production.

## Repository and ownership boundaries

This is one Next.js application, not a monorepo. There are no workspace packages or implemented worker. `src/app/` owns routes/actions, `src/components/` owns rendering/forms, `src/lib/` owns validation/domain/persistence, `supabase/` owns transactional storage and permissions, and `tests/`/`tools/` own verification. Human/team ownership assignments are not documented.

Existing domain modules are auth, practice, team, and recipients. No clinician, credential, policy coverage, date cycle, job, or message-attempt model appears in the source inventory or generated public schema (`src/lib/supabase/database.types.ts`).

## Authority, routing, and recovery patterns

- `src/lib/auth/require-user.ts:requireUser` verifies the user through `auth.getUser()`; `src/lib/supabase/server.ts:createClient` uses the publishable key and cookies.
- `src/lib/practice/access.ts:getPracticeAccess` derives the practice and live membership role; it does not trust posted authority. One active practice per account is enforced by the membership migration.
- `src/app/practice/page.tsx:Settings` is the current authenticated landing screen. `src/app/page.tsx:Home` redirects there. Preserve those redirects and add a register link.
- `src/proxy.ts:config.matcher` already covers `/practice/:path*`; `src/lib/supabase/session.ts:updateSession` applies private/no-store headers.
- `src/lib/recipients/operations.ts:saveRecipient`, `repository.ts:getRecipient/setRecipient`, `messages.ts:recipientInput`, and `src/app/practice/recipient-actions.ts:recipientAction` establish auth/access-first operations, strict posted inputs, parsed RPC projections, safe result messages, and login redirects.
- `src/components/recipients/recipient-panel.tsx:safeRecipientAction` treats a lost response as uncertain. New create operations need stable request keys so an unchanged retry cannot produce another entity; disabling a button alone is insufficient.

## Database findings

`supabase/migrations/20261005211436_practice_membership_authority.sql:private.current_practice_id` supplies membership-based RLS. `private.require_administrator` locks the practice before checking current authority.

`supabase/migrations/20261006003555_practice_reminder_recipient.sql:private.require_recipient_member` extends this pattern to administrator/manager editing and active-member reading. Register authority should have its own helper rather than coupling clinician data to recipient semantics. This migration also supplies the composite same-practice membership-FK pattern and public invoker/private definer RPC pattern.

`supabase/migrations/20261005212526_practice_invitations.sql:private.accept_practice_invitation` acquires a user advisory lock before the practice lock. `private.mutate_member`, as replaced by the recipient migration, serializes access changes on the practice lock. New register writes must acquire the practice lock before their authority check and avoid acquiring user locks afterward.

Clinicians are business records, not memberships: creating a clinician must not invite someone, give access, or enroll a reminder recipient. Coverage links reference one policy; later cycles/reminder keys must use that policy identity rather than each coverage link.

## Verification findings

- `tests/helpers/local-fixtures.ts` and `access-fixtures.ts` provide real local Auth/Data API clients, invitations, and privileged fixture access confined to exact loopback endpoints.
- `tests/unit/recipient-operations.test.ts`, `recipient-actions.test.ts`, and `routes.test.tsx` demonstrate input tampering, outage, authority, safe projection, redirect, and read-failure checks.
- `tests/e2e/practice-recipient.spec.ts` includes pending-state, real database fault, queued lock, foreign Origin, mobile/accessibility, and post-commit lost-response witnesses.
- `tools/schema-catalog.mjs:schemaQueries` hardcodes only practices/memberships for public columns, policies, triggers, grants, RLS, constraints, and indexes. Adding public register tables requires expanding all seven filters, then recording/reviewing the schema contract. Functions and private tables already have broader coverage.
- `tools/foreign-key-controls.mjs` has an explicit four-file pgTAP inventory and expected TAP plans. The new suite and missing-defense controls must be added.
- `tools/sql-mutants.mjs` requires applicable, executed, behaviorally caught faults and restored schema evidence; new register protections need named witnesses.
- `stryker.config.mjs`, `stryker.properties.config.mjs`, and `vitest.properties.config.ts` enumerate domain modules explicitly. Add register modules and properties without lowering thresholds.
- `tools/layers.json` has 29 layers. Add a dedicated E1-S3-to-E2-S1 upgrade rehearsal. Existing access/recipient rehearsals apply all later migrations and must continue passing.
- `tools/source-state.mjs:sourceState` requires clean committed application source for the gauntlet but excludes `thoughts/`. Planning does not satisfy or bypass implementation-time source checkpoint requirements.

## Proposed decisions

Administrator/manager creation, shared read-only viewer access, separate clinician records, three initial credential types, explicit clinician/practice ownership, optional multi-clinician coverage only for practice-owned malpractice, date-entry deferred to E2-S2, and atomic creation/audit/idempotency are planning decisions. Allow either owner kind for the three types: this tool represents supplied records and does not infer legal ownership rules. Repeated names are permitted; semantic duplicate review belongs to E2-S3.

## Official documentation check

The markdown changelog/docs endpoints returned unsupported content-type errors through the web reader; the HTML equivalents were accessible. Reviewed the [Supabase changelog](https://supabase.com/changelog), [API security](https://supabase.com/docs/guides/api/securing-your-api), and [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security). The design follows explicit table grants plus RLS and keeps privileged implementations outside the exposed schema. No dependency or platform upgrade is proposed.

## Commands and results

Repository inspection used `git status --short`, `git log -8 --oneline`, `git rev-parse HEAD`, `rg --files`, targeted `rg -n`, and complete reads of the implementation/test/tool files described above. The initial worktree was clean; no repository AGENTS.md file was found, so the supplied chat instructions apply.

Checks used `PATH="$PWD/.tools/node/bin:$PATH"` (repository Node 24.21.0):

| Command                | Result                                                                        |
| ---------------------- | ----------------------------------------------------------------------------- |
| `npm run format:check` | Passed, exit 0. `thoughts/` is excluded by the existing Prettier ignore file. |
| `npm run lint`         | Passed, exit 0.                                                               |
| `npm run typecheck`    | Passed, exit 0.                                                               |
| `npm test`             | Passed, exit 0; 181 tests in 22 files, seed 20261003.                         |

These are current baseline results, not evidence for future E2-S1 behavior. Database/reset, integration, browser, mutation, upgrade, build, and full gauntlet checks were not run during planning. Manual product acceptance was not performed.
