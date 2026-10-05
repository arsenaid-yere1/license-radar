# E1-S2: Staff Invitations and Roles Implementation Plan

Date: 2026-10-05
Status: Planning only; application implementation has not started.
Source baseline: `491e6905bdbc2aa853c94c9cc7e192d51cd9a676`.
Research: `thoughts/shared/research/2026-10-05-e1-s2-staff-access.md`.

## Overview

**Story:** As a practice administrator, I can invite a manager and assign roles so authorized staff can maintain records.

Deliver the next backlog story, E1-S2: existing practices gain memberships; administrators create expiring invitations, staff accept after verified email sign-in, and administrators change/revoke access while preserving at least one administrator. Keep the existing practice profile, timezone, and recovery behavior.

## Current State

The repository contains one Next.js application with Supabase email OTP and owner-only practices. It has no membership or invitation implementation. `getCurrentPractice` assumes at most one visible practice; `createPractice` relies on `practices_owner_user_id_key`; `savePractice` derives identity and update ID server-side. Database triggers validate and audit profile changes. The settings page labels every profile holder as administrator and exposes editing.

The original backlog requires expiring invitations, role permissions, revoked access, and last-administrator protection. Existing source, tests, and tools are mapped in the companion research; historical planning statements that the workspace was empty no longer describe it.

## Desired End State

### Proposed product decisions

These defaults are explicit planning assumptions until the user changes them:

- **One active practice membership per account.** A member can join another practice after revocation, but cannot silently replace an active practice. No practice switcher.
- **Copy invitation link.** An administrator enters an email and role, creates an invitation, and shares its link through their chosen channel. The application truthfully says the link was created, not that mail was sent. Existing OTP email continues to authenticate staff locally.
- **Seven-day expiry**, measured by database time. Cancel/reissue is explicit; reissue invalidates the old link immediately and resets expiry. Pending invitations grant no access.
- Role identifiers: `administrator`, `manager`, `viewer`; label manager as Office manager. Viewer currently reads only shared practice name/timezone and their own role. Future assigned-record permissions remain requirements for E2, not access to all future records.
- Administrator can invite any of the three roles, change roles, and revoke members, including themselves when another active administrator exists. No separate leave workflow.

### Permission matrix for implemented surfaces

| Surface/action | Administrator | Manager | Viewer | Nonmember/revoked |
| --- | --- | --- | --- | --- |
| Read shared practice profile and own membership | Yes | Yes | Yes | No |
| Edit practice name/timezone | Yes | No | No | No |
| List team and pending invitations | Yes | No | No | No |
| Create/cancel/reissue invitations | Yes | No | No | No |
| Change/revoke membership | Yes, with final-admin guard | No | No | No |
| Accept invitation for verified own email | Yes if no other active practice | Same | Same | Same |

Manager privileges for records/calendar/renewals will be enforced when those surfaces exist. No clinician record identifiers are collected here.

### Acceptance criteria

| ID | Observable behavior |
| --- | --- |
| AC1 | Migration creates exactly one active administrator membership for every existing creator, preserving practice IDs/profile versions/audit history. New practice creation writes profile, initial membership, and audits atomically. |
| AC2 | Administrator creates an email-bound role invitation with visible expiry; link possession alone grants no membership. Invalid input and unknown fields fail in app and database boundaries. |
| AC3 | New and existing users verify their email, preview the intended practice/role, and explicitly accept. Verified email must match the invitation under the documented normalization rule. |
| AC4 | Expired, canceled, superseded, malformed, wrong-email, and foreign-practice invitations cannot create membership or disclose practice details to unauthorized callers. Expiry boundary is `clock_timestamp() >= expires_at`, checked after acquiring mutation locks. |
| AC5 | Repeated/concurrent acceptance creates one membership and one acceptance event; retry by the accepting account succeeds only while its same-practice membership is still active. |
| AC6 | Role matrix holds for UI, server actions, direct table calls, and RPCs. Submitted actor/practice/role fields and editable metadata cannot elevate access. |
| AC7 | Revocation/demotion affects subsequent requests using the same already-issued access token. Revoking the original creator also removes access. Old invite replay cannot reactivate a revoked member. |
| AC8 | Last-administrator demotion/revocation fails, including two concurrent administrators trying to remove one another. Stale membership edits conflict. |
| AC9 | Create-versus-accept and simultaneous invitations to two practices preserve one active practice per account and leave no orphan profile/audit. Existing active membership is never silently replaced. |
| AC10 | Invitation/member mutations and their private audit events commit together. Audit/storage/auth failures report no success and allow an explicit retry without duplicate state or lost form input. |
| AC11 | Role labels and available controls match actual access; keyboard, error focus, mobile layout, pending states, wrong-account recovery, reload, and sign-out work. |
| AC12 | E1-S1 validation, example-only reminder, profile persistence, optimistic edits, audit rollback, isolation, and saved-version recovery remain verified under the new access model. |

## Key Discoveries

- Owner-based RLS must be replaced completely. Retaining an owner-access fallback violates revocation, especially for the creator.
- A single-practice application needs uniqueness on **active memberships**, not historical creators. Keep `owner_user_id` immutable as creation provenance with its restrictive foreign key, but remove `practices_owner_user_id_key` after membership backfill. A formerly revoked creator may create or join a new practice; provenance never restores old access.
- Create and update currently use direct table writes. Move them to transactional RPCs so membership initialization, role checks after locks, version checks, and audit writes share a database authority boundary. Deny direct profile INSERT/UPDATE afterward.
- Private schema usage is currently denied. Public SECURITY INVOKER wrappers calling private SECURITY DEFINER implementations require deliberate private USAGE plus narrow EXECUTE grants. Private table grants stay denied, trigger EXECUTE stays denied, and `private` remains outside exposed API schemas.
- Current [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) requires both grants and policies. Membership helpers must avoid recursive membership RLS and must consult live database state rather than cached JWT roles.
- [Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) already supports new-account enrollment. Application invitations remain distinct from Auth invitations. No new privileged application client or delivery provider is needed for the proposed local slice.
- Schema fingerprint, SQL mutants, property/mutation selection, capabilities reporting, and old foreign-key controls require deliberate updates; green S1 tooling alone cannot verify membership boundaries.

## What We Are Not Doing

Obligation entry, clinician assignments, calendar, reminder recipient assignment (E1-S3), SMS enrollment/delivery, hosted deployment, automated invitation email, bulk import, organizations, practice switching, account deletion, legal ownership transfer, or a general audit-history product screen.

## Implementation Approach

### Persistence and authority

Add `public.practice_memberships`: UUID ID, practice/user restrictive foreign keys, constrained role, active/revoked state, positive version, `revoked_at`, and timestamps. Unique `(practice_id, user_id)` preserves a durable membership identity; a partial unique index on `user_id` where active enforces the single-active-practice rule. RLS exposes only an account's own active membership; an administrator-only roster RPC returns minimal account email/role/state/version. Do not expose `auth.users` or all member emails to managers/viewers.

Add `private.practice_invitations`: UUID ID, practice, normalized email, invited role, unique token digest, pending/accepted/canceled state, `issued_at`, expiry, creator, version, accepted user/time, and timestamps. Add `private.practice_access_events` with practice, actor, subject/invitation IDs, operation, role/state before/after, and timestamp. Foreign keys restrict deletion. Both private tables have RLS and no ordinary table grants. Backfill uses a distinct `membership_initialized` event attributed to the recorded creator; it does not manufacture a new profile-change event.

Use authenticated public invoker RPC wrappers around private definer functions with empty search paths and fully qualified references. Proposed entry points: `create_practice`, `update_practice`, `list_practice_team`, `create_practice_invitation`, `cancel_practice_invitation`, `reissue_practice_invitation`, `preview_practice_invitation`, `accept_practice_invitation`, `change_practice_member_role`, and `revoke_practice_member`. Only required wrappers/helpers get EXECUTE for authenticated; revoke PUBLIC/anon defaults. Every privileged implementation derives actor from `auth.uid()` and checks authority itself, even if called directly in SQL.

Use a private current-membership helper for practice SELECT RLS, avoiding self-recursive policy queries. `getCurrentPractice` may continue to return a single practice only because active membership uniqueness is enforced. Add `getPracticeAccess` for practice plus role/version. No creator-access clause and no role data in editable metadata/JWT claims.

Profile writes use RPCs: creation returns the existing authorized practice unchanged on retry; update takes expected profile version and checks live administrator authority under the practice lock. Existing validation/version/audit triggers remain authoritative. Domain responses distinguish forbidden, conflict, already-member/other-practice, invalid invitation, and unavailable without leaking SQL or account existence.

### Transactions and concurrency

- Create and accept acquire the same transaction-scoped advisory lock keyed by authenticated user before checking active memberships. Then lock the target practice row, then any invitation/member row. Creation without a practice inserts profile and initial membership in one transaction. Database uniqueness remains a backstop.
- Invitation creation/reissue/cancel, role change/revoke, and profile edit lock the practice row before evaluating actor membership, expected version, pending state, and administrator count. Membership writes have no direct DML grants.
- All routines use this lock order; no routine holding a practice lock may acquire the user advisory lock afterward. Reissue/cancel and acceptance serialize on the same practice lock.
- Role mutations recheck the actor after acquiring the practice lock. Two cross-demotions cannot both succeed; a losing actor's newly downgraded/revoked authority is rejected. Use fresh READ COMMITTED statements inside volatile mutation functions after lock acquisition.
- Every practice must have an active administrator. Enforce at the controlled mutation boundary plus deferred constraint triggers for new practices and membership changes, including privileged writes. Trigger helpers serialize their checks on the practice row too. Do not count pending administrator invitations. Initial creation inserts its administrator before transaction completion.
- Public table writes to profiles/memberships and ordinary private writes are denied. An authorization decision made before revocation cannot be reused after acquiring the practice lock. Reads/mutations already completed before revocation cannot be recalled; subsequent requests must fail. This is not a promise to erase already-rendered browser data.

### Invitation lifecycle

Generate 32 random bytes with Node's `node:crypto` in a server-only invitation helper, encode as base64url, and store only SHA-256 digest through the authenticated RPC. Validate token shape and digest shape; acceptance/preview helpers hash the supplied raw token server-side. Database functions also enforce verified actor email and all lifecycle checks, so calling RPCs directly with a digest cannot bypass identity/role/expiry checks. Compare normalized invitation email to confirmed email read from `auth.users` by the private function, not from posted fields or editable metadata.

Email normalization is identical and locale-independent at both boundaries: remove only surrounding ASCII spaces and map ASCII A–Z to a–z, preserving dots/plus tags. SQL uses `btrim(value, ' ')` plus `translate` with explicit uppercase/lowercase alphabets; TypeScript uses the equivalent ASCII operations. Validate invitation input as an ASCII email of at most 254 characters with the existing Zod email convention; reject other surrounding whitespace, controls, and non-ASCII input rather than silently normalizing it differently. Table/RPC checks validate canonical form and syntax too. Add application/SQL parity cases for spaces, tabs/newlines, mixed case, dot/plus tags, maximum length, and invalid forms.

Only one pending invitation per practice/normalized email. Creation rejects a duplicate pending invite; reissue explicitly rotates digest/version/issuance time/expiry, including an expired pending row. Cancel is idempotent. Accepted/canceled rows are historical; a new or explicitly reissued invitation is required to reactivate a revoked membership. If the create response is lost, show the persisted pending row and offer reissue rather than pretending the original raw token is recoverable.

For an existing revoked `(practice_id, user_id)` membership, preview/accept must reject any invitation with `issued_at <= revoked_at`, including still-pending invitations. Set both times from database `clock_timestamp()` while holding the practice lock. Reactivation via a later authorized invitation increments membership version, applies its role, and audits the change. Retain the latest revocation timestamp so older invitations remain ineligible after subsequent revoke/rejoin cycles. Historical accepted links can only return idempotent success for a currently active member; they never perform reactivation.

Expiry uses current database wall-clock time after locks, not transaction-start `now()`, so a queued acceptance cannot succeed after expiry. Reissue retains the original email and role; changing either requires cancel/new invitation. An invitation created with valid administrator authority remains pending after its creator is demoted/revoked unless another administrator cancels it; no hidden dependency on the inviter's later role.

Accepted-invitation retry checks accepted user and current active same-practice membership; it never re-applies the original role, extends authority, or undoes revocation. Accepting while already active in the target practice returns already-member without changing role; while active elsewhere returns a neutral conflict without exposing the other practice. Leave invitations unchanged on unsuccessful acceptance.

Copy links use `/join#token=...`; raw tokens stay out of query strings and server request logs. A small join client reads the fragment into tab-scoped session storage, clears the address fragment, and posts the token only after sign-in. Clear stored context after success/sign-out; never log it or place it in analytics/coverage reports. Reload and the same-tab OTP flow retain context; another tab requires reopening the invitation link.

`/join` renders an unauthenticated sign-in shell without tenant details. Extend login action/form with a strict allowlisted destination of `/` or `/join`; invitation login returns to `/join` before onboarding. After verified sign-in, a preview POST returns only practice display name, role, and expiry to the correct email. Acceptance requires a separate explicit POST. GET, email scanners, and page previews never consume invitations. Set private/no-store and no-referrer on join responses.

## Phase 1: Membership Migration and Practice Authority

### Files and changes

- Inspect pinned CLI help, then create a new migration with `supabase migration new`; keep the existing S1 migration unchanged.
- Backfill memberships/access events, introduce indexes/constraints/private helpers/RPC grants, replace profile RLS, remove creator uniqueness, and deny direct profile writes in the same migration transaction. Verify every practice has its initial administrator before commit.
- Update `src/lib/practice/repository.ts` create/update to RPCs; add `src/lib/practice/access.ts`; extend `src/lib/practice/save.ts` and action results with forbidden/conflict handling. Regenerate `src/lib/supabase/database.types.ts`.
- Update real API/SQL S1 tests for the new write boundary without weakening validation/concurrency/audit assertions.
- Update `tests/integration/practice-properties.test.ts` to perform its Unicode storage parity writes through authenticated versioned RPCs, retaining real PostgreSQL validation and generated identity/version sequences. Update repository/action/save mocks in `tests/unit/practice-actions.test.ts`, `tests/unit/server-actions.test.ts`, and `tests/unit/save.test.ts` to include RPC responses and role failures rather than asserting only old `client.from` calls.

### Automated verification

AC1, AC6–AC9, AC12: fresh replay plus an upgrade test from the existing migration with two preexisting practices/edits/audits. Compare IDs, values, versions, and historical events; assert exactly one creator administrator each. Test new creation 20 ways, atomic membership/profile rollback, hostile direct DML/RPCs, creator revocation, and create-versus-accept locking once acceptance is added.

### Manual verification

Inspect only local fixture profiles/memberships before and after upgrade; confirm original accounts retain their settings and unrelated practices remain isolated.

Exit: membership authority replaces ownership while existing profile behavior remains intact.

## Phase 2: Invitations and Team Mutation Contracts

### Files and changes

- Add a second CLI-created migration for invitation/access-event lifecycle operations and member role/revoke RPCs if needed; preserve Phase 1 authority contracts.
- Add `src/lib/team/{schema,repository,operations,invitations}.ts` with strict role/email/version input, server-only token helper, and typed outcomes. Team mutations derive the current practice server-side and recheck authority in SQL.
- Add `supabase/tests/practice_access.test.sql`, `tests/integration/practice-access.test.ts`, `tests/integration/practice-invitations.test.ts`, and narrow unit/property tests.

### Automated verification

AC2–AC10: verified and unconfirmed/wrong email; unknown roles/fields; exact expiry and acceptance waiting on a lock past expiry; duplicate pending invitations; cancel/reissue/replay; inviter's later revocation; two accepts of one link; one account accepting two practices; creation racing acceptance; accepted and pending old tokens after revocation; fresh authorized reissue/rejoin followed by another revocation; creator demotion/revocation; concurrent final-admin removal; manager/viewer guessed IDs and crafted RPCs; forged metadata; private data/trigger access denied. Inject access-audit failure into create/accept/role/revoke and assert complete rollback. Assert no raw token stored in tables/events.

### Manual verification

Inspect minimal roster projection and private access events for correct actor/subject/before/after; verify no cross-practice email disclosure.

Exit: lifecycle and permission rules pass against real local Auth/Data API, including races.

## Phase 3: Team and Join User Flows

### Files and changes

- Add `src/app/practice/team/page.tsx` and `src/app/practice/team/actions.ts`, plus `src/components/team/` forms for roster, invitation creation/reissue/cancel, and member changes. Keep admin-only navigation and confirmation for revoke/demotion.
- Add `src/app/join/page.tsx`, `src/app/join/actions.ts`, and a join client component. Update `src/app/login/actions.ts` and `src/components/auth/email-code-form.tsx` for the allowlisted return destination and context cleanup.
- Update root/setup/settings routes and `src/components/shell.tsx` as needed: label actual role, show shared profile to manager/viewer, and render edit/team controls only for administrators. A revoked account gets a neutral access-lost state when a formerly open action is submitted; root with no active practice may offer setup.
- Expand `src/proxy.ts` matcher and `src/lib/supabase/session.ts` exceptions/headers for `/practice/team` and public `/join`. Join remains publicly reachable but all preview/accept authority is server/database enforced.
- Extend `src/app/globals.css` only for required controls/layout.

### Automated verification

AC3–AC5, AC7, AC10–AC12: real browser manager invite → same-tab OTP → preview → accept → refresh; existing-user acceptance; role-specific controls and direct forbidden actions; wrong-account sign-out and re-entry; expired/canceled/reissued links; duplicate accept; stale team versions; revocation with existing cookies; final-admin rejection; preserved form input and latest saved profile version after errors. Assert fragment removal, context cleanup, no consumption on GET, private cache headers, fixed destination allowlist, and foreign-Origin action rejection. Use existing fixture/mail/browser/coverage helpers.

Invitation browser specs disable Playwright tracing and automatic screenshots for token-bearing flows; existing `retain-on-failure` tracing would capture fragment links and posted tokens. Use only generated local fixture accounts, avoid assertions/logs that print raw token values, and keep token-bearing artifacts out of retained reports. Capture intentional UI verification images only after masking the invitation link. Preserve normal diagnostics for unrelated S1 tests.

### Manual verification

Keyboard and screen-reader labels/error focus; desktop/375px layout; copy/reissue link text/expiry; correct role explanation; explicit acceptance and no automatic practice creation during invitation login.

Exit: the complete local staff flow and all inherited profile regressions are demonstrable.

## Phase 4: Verification Tooling, Documentation, and Evidence

### Files and changes

- Expand `tools/schema-fingerprint.mjs` and refresh `tools/schema-contract.json` only after schema/grant review. Include every new table/policy/trigger, public RPC and private function definition, constraints/indexes, schema privileges, and function EXECUTE grants. Include new restrictive foreign keys in `tools/foreign-key-controls.mjs`; replace brittle aggregate/TAP assumptions with assertions for the intended schema/test suite.
- Update `tools/sql-mutants.mjs`: retain isolation/timezone/version/audit controls at their new locations; replace creator uniqueness with active-membership uniqueness and add wrong-email, expiry, revoked-state, role-authority, and final-admin faults. Each selected test must actually execute and fail for its expected reason; restore and fingerprint afterward.
- Add new handwritten modules/actions to `stryker.config.mjs`; include team properties in `stryker.properties.config.mjs` and `vitest.properties.config.ts`. Extend `tools/check-capabilities.mjs` to inventory RPC and crypto usage. Expand checker-control tests if these checkers change. Existing broad unit/integration includes and coverage scanning already discover files in their conventional directories.
- Update `tools/shuffle-browser.mjs` to verify completion against the discovered unique test inventory rather than its hardcoded ten-result count. Record exactly which tests executed; empty, duplicate, skipped, or incomplete inventories fail.
- Update `README.md` for roles, one-active-practice restriction, copy-link delivery, seven-day expiry, reissue, join flow, and local-only email boundary. Preserve historical S1 documents; write a new E1-S2 evidence report with actual source/run/commands/results.

### Automated verification

Run under pinned Node 24, incrementally after each phase and finally on the complete source:

| Command | Required evidence |
| --- | --- |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` | Formatting, lint, types, validation/actions/role/UI regressions |
| `npm run db:reset`, `npm run test:db`, `npm run test:integration` | Dedicated local replay, grants/RLS/RPCs, upgrade, lifecycle, races, audit rollback |
| `node tools/check-generated-types.mjs` | Committed types match replayed public schema |
| `npm run build`, `npm run test:e2e` | Production OTP/join/team/role/browser behavior |
| `npm run gauntlet` | All existing 26 layers updated for this story; mutation, properties, schema, coverage, controls, dependency/secrets and shuffled suites included |

Reset/privileged tests must validate the dedicated loopback endpoints first. The gauntlet requires a clean committed source; follow implementation-time authorization for checkpoint commits, and never attribute earlier S1 results to new source. Do not lower gates to avoid adding membership paths to them.

### Manual verification

Review complete diff, migration upgrade and privilege changes; inspect resulting UI; map AC1–AC12 to observed evidence. Distinguish automated, agent-observed, and user-confirmed checks. Report unrun requirements explicitly.

Exit: final implementation and verification artifacts agree on the actual source and all story criteria.

## Risks and rollback considerations

- Membership changes touch the whole authorization foundation. Migration and updated application must be coordinated; there is no hosted deployment in this story. Existing owner-only binaries cannot be used after RPC-only writes/member access are introduced.
- Private USAGE is a deliberate grant change, not table access. Test table denial and narrowly scoped EXECUTE directly; never use a service-role application key as a shortcut.
- Concurrent role/revoke/profile changes require uniform lock order and post-lock authority checks. Include opposing-admin operations and fresh-token-independent revocation tests.
- Token links can be shared; matching confirmed email remains mandatory. Clearing logs/referrers/fragment context reduces accidental exposure but does not make a stolen browser context harmless.
- The partial active-membership index changes historical creator uniqueness. Existing-create retries remain idempotent while membership is active; after revocation, no caller may recover the old practice through provenance.
- A new or explicitly reissued invitation to a revoked member is a deliberate administrator action. Accepted replay cannot reactivate; pending invitations issued at/before the latest revocation are ineligible. Email changes require a newly addressed invitation; no provider-specific alias assumptions.
- Local rollback is a dedicated-fixture reset. Once real memberships exist, use forward repair and retain practice/invitation/access audit history. Never restore creator-based policies, which would restore revoked access.
- Hosted invitation mail, sender configuration, production rate limits, and operational rollout remain separate work if the user chooses the email-delivery variant.

## Completion criteria

AC1–AC12 pass with specific current-source evidence; prior profile behavior remains covered; upgrade preserves data; direct APIs enforce live memberships; last-admin and race guarantees hold in storage; invitations require verified email and explicit acceptance; all relevant checks and updated gauntlet layers pass. No story implementation is claimed by this plan.

## Planning verification

The companion verification report records plan review and current baseline checks. Defaults are proposed, not user-approved decisions. Implementation is a separate next step.

## Implementation progress (2026-10-05)

- [x] SPEC approved by “continue with implementation”; documentation checkpoint `defdc87`; isolated branch `codex/e1-s2-staff-access`.
- [x] Phase 1 core membership migration, backfill, RPC profile persistence and live access helper implemented; unit/types/lint/API/SQL checks passed as recorded in the draft evidence. Actual upgrade/rollback/replay rehearsal passed.
- [x] Phase 1 remaining shared-tool/browser checks, actual public creator revocation and queued profile-role race verified by the final run. Manual/user sign-off and independent implementation verification are not claimed.
- [x] Phase 2 invitation and team mutations, rollback/retry/version/expiry/epoch/race contracts verified.
- [x] Phase 3 team/join flows verified: 19 browser cases, explicit attacks, actual fault sensitivity, keyboard/mobile/axe checks.
- [x] Phase 4 full 28-layer gauntlet, 27 checker controls, 18 removed-defense checks, documentation and final scenario/invariant/AC mapping completed.

## Implementation completion — 2026-10-05

All 28 required layers passed on source eea83e9dc4adc8d9303a22e4f2a8c18980032ed2, run 348f97aa-842e-4ed0-b6f2-df7f337a0f2b. The attached implementation checkout is /Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar, branch codex/e1-s2-staff-access. [Final evidence](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/thoughts/shared/research/2026-10-05-e1-s2-old-coder-evidence.md) maps every S/P/A/N case and AC1–AC12 to executable witnesses, records source/runtime/mutation/coverage results and retains preparation failures. Source hash 699b054873879599275ac471b702dda190363c14b503b1d909b45c620507da09 was restored unchanged. Independent implementation verification remains not performed, zero rounds, as declared in the approved SPEC. Subsequent evidence/plan-only commits do not change tested source.
