# E1-S3: Recipient Assignment Research

Date: 2026-10-05
Source: `aeedf1cff3aba58218046483955a05b506c0b90c` in `/Users/macbookpro/Coding/license-radar`.
Status: Current implementation inspected; no feature changes.

## Question and next story

`README.md:28` explicitly identifies E1-S3 as the next story. The original backlog at `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md:162` requires same-practice recipient assignment/replacement, readiness, audit, and reminder rule 9. E1-S2 implementation completion is recorded in its plan; the production release handoff confirms the existing staff-access release. The original design's empty-workspace observations are historical.

## Repository boundaries

There is one Next.js application, with no monorepo packages or background worker. `src/app/` handles routes/actions; `src/components/` renders forms; `src/lib/auth/`, `practice/`, and `team/` handle identity/domain operations; `supabase/` owns transactional persistence/access rules; `tests/` and `tools/` own verification. No human/team ownership assignments are recorded.

## Existing authority and application flow

`src/lib/auth/require-user.ts:requireUser` verifies the account with `auth.getUser()`. The cookie client in `src/lib/supabase/server.ts:createClient` uses only the configured publishable key. `src/lib/practice/access.ts:getPracticeAccess` reads the membership-authorized practice and the user's own active membership, returning role and membership version. All active members see shared name/timezone; settings and team administration remain administrator-only.

`src/app/practice/page.tsx:Settings` is the natural existing surface for an independent recipient panel. `src/app/practice/team/page.tsx:PracticeTeam` and `src/lib/team/operations.ts:manageTeam` reject managers/viewers. `src/lib/team/repository.ts:getTeam` calls `list_practice_team`, whose database implementation returns complete member/history/invitation projections only after administrator authorization. Broadening it would expose unrelated data. A purpose-specific candidate read is needed.

`src/lib/team/schema.ts` uses strict inputs and a PostgreSQL-compatible bounded positive integer version. `src/lib/team/messages.ts:formInput` filters action metadata and parses expected version, but overwrites duplicate fields; a recipient parser requiring duplicate-field rejection needs its own check. `src/components/practice/practice-form.tsx:PracticeForm` carries submitted values and the latest committed practice/version through subsequent failures. This is the existing recovery behavior to preserve for recipient forms.

`src/proxy.ts:config.matcher` already includes `/practice/:path*`; `src/lib/supabase/session.ts:updateSession` handles private/no-store headers. Integrating on `/practice` does not require a new proxy route.

## Database findings

All three migrations were inspected completely. Existing application tables are `public.practices`, `public.practice_memberships`, and private profile/access audits and invitations. No recipient, phone enrollment, consent, credential/cycle, job, or attempt storage exists.

The membership migration defines:

- Own-active-membership SELECT RLS and one active practice per user.
- `private.current_practice_id` for membership-based practice reads without recursive policies or creator fallback.
- `private.require_administrator` at line 80, locking the practice before checking current authority.
- Deferred final-administrator invariants and audited membership writes.
- `private.create_practice` at line 149, atomically writing a profile and administrator with existing-practice retry semantics.

The invitation migration defines `private.mutate_member` at line 246: discover target practice, acquire the practice lock, reread/lock membership, validate expected version/role and final-administrator protection, then update. It is the controlled eligibility-change boundary. `private.accept_practice_invitation` takes a user advisory lock before the practice lock and uses durable membership reactivation; do not introduce the reverse lock order.

Profile updates increment profile version and record name/timezone audits. Recipient state should therefore use an independent settings row/version and dedicated before/after assignment events. A composite practice/membership FK requires an added unique `(practice_id,id)` membership key. New private tables can deny direct client access and use authenticated public invoker wrappers over checked private definer implementations, matching existing RPC authority.

## Verification findings

The suite has unit/action/route/forms, real local Auth/Data API integration, pgTAP SQL, browser/accessibility, and property/mutation evidence. Existing helpers restrict privileged fixtures to fixed local endpoints. The baseline unit suite has 158 tests in 18 files.

`tools/schema-fingerprint.mjs` captures every private table and application function; public table filters remain hardcoded to practices/memberships. Private storage avoids expanding public surface filters. `tools/schema-contract.json` must still be reviewed/regenerated after implementation. `tools/check-generated-types.mjs` generates public schema types; future private tables should remain absent.

`tools/foreign-key-controls.mjs` names three SQL suites and exact TAP plans. The recipient suite and dropped-defense controls need explicit inclusion. `tools/access-upgrade.mjs` automatically applies all post-E1-S1 migrations but snapshots only profile/history data; a separate E1-S2-to-E1-S3 rehearsal must preserve memberships/invitations/access history. `tools/sql-mutants.mjs` targets exact existing function spellings; replacing shared member functions must preserve fault applicability or deliberately update it.

Stryker's application/property module lists and the properties test configuration need recipient entries. `tools/layers.json` and `tools/gauntlet.mjs` currently require 28 layers. `tools/source-state.mjs` requires clean committed application inputs but excludes `thoughts/` from that dirty-source gate/hash.

## Planning decisions versus verified facts

Proposed decisions: administrator/manager recipient editors; active administrator/manager candidates; one practice default recipient; explicit clear; minimal selected email read for active members; automatic clearing through the controlled member mutation on revoke/viewer demotion; no automatic reassignment on rejoin/promotion.

These decisions resolve the original story's manager wording versus the earlier general role table's omission of manager recipient powers. They are planning defaults, not user-confirmed product requirements.

Only assignment readiness can be represented honestly now: no selection, selected-but-SMS-pending, or defensive invalid membership. No source proves verification/consent/dispatch readiness. Rule 9 requires cycles and jobs from E2/E4; the plan preserves it as an explicit future integration gate and does not claim the original story's scheduling acceptance is complete.

Official documentation reviewed: [functions](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and the [explicit Data API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically). The markdown changelog index failed with unsupported content type; the HTML index and relevant change were available. This was a focused check of the proposed grant/wrapper design, not an exhaustive platform audit.

## Baseline checks and limits

With `PATH="$PWD/.tools/node/bin:$PATH"`, Node 24.21.0:

| Command                                                            | Result                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `git status --short`, `git log -5 --oneline`, `git rev-parse HEAD` | Initially clean; baseline/history identified                  |
| `rg --files`, targeted `rg -n`, complete source/document reads     | Next story, implementation and test/tool boundaries inspected |
| `npm run lint`                                                     | Passed, exit 0                                                |
| `npm run typecheck`                                                | Passed, exit 0                                                |
| `npm test`                                                         | Passed, exit 0; 158 tests/18 files, seed 20261003             |

The execution host defaults to Node 26.3.0; the project toolchain was selected for checks. Database resets, migrations, integration/browser/mutation runs, gauntlet, production probes, and application changes were not performed. Planning review is recorded separately.
