# E1-S3: Responsible Reminder Recipient Implementation Plan

Date: 2026-10-05
Status: Approved by “proceed with implementation”; implementation in progress on `codex/e1-s3-recipient`.
Baseline: `aeedf1cff3aba58218046483955a05b506c0b90c`.
Research: `thoughts/shared/research/2026-10-05-e1-s3-recipient-assignment.md`.

## Overview

**Story:** As a manager, I can assign or replace the responsible reminder recipient so responsibility stays current.

E1-S3 is explicitly next in `README.md:28` and the original backlog in `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md:162`. Implement the practice-level assignment foundation now: one primary recipient, active practice membership validation, truthful readiness, versioned replacement, and atomic audit history.

The original acceptance criterion also references reminder rule 9: cancel the former recipient's unsent jobs and create a catch-up job for an eligible new recipient inside the reminder window. Credentials, cycles, SMS enrollment, and jobs do not exist yet. This plan preserves that requirement as a mandatory E2/E4 integration gate. Completing the foundation must not be reported as completing that part of the original story or making SMS operational.

## Current State

This is one Next.js application, not a multi-application monorepo. Routes/actions belong to `src/app/`, forms to `src/components/`, practice/auth/team domain operations to `src/lib/`, schema and access authority to `supabase/`, and verification to `tests/` and `tools/`. No individual ownership assignments, published libraries, or background worker are recorded.

E1-S1 practice profiles and E1-S2 invitations/memberships are implemented and released. Current authority comes from live database memberships; each user has at most one active practice. All active members read the shared profile, while profile edits and the full team roster/invitation workflow remain administrator-only. `src/lib/practice/access.ts:getPracticeAccess` returns practice, role, and membership version. `src/app/practice/page.tsx:Settings` already separates administrator controls from shared read-only settings.

The migrations create practices, memberships, and private profile/access/invitation records. No recipient, phone enrollment, credential, cycle, job, or message table exists. The profile reminder preview is an example. Existing audits describe profile values or access changes, not old/new recipient assignments.

## Desired End State

### Explicit product decisions

- One primary recipient per practice; existing and newly created practices start unassigned. Do not automatically select the creator or infer consent.
- Active administrators and office managers can assign, replace, or explicitly clear the recipient. This follows the manager actor in E1-S3 and extends only recipient permissions; the earlier general role table omitted this manager capability.
- Only active administrator/manager memberships in the same practice are selectable. An administrator can select themselves for a small practice. Viewers and pending invitations are not eligible recipients.
- All active practice members can see the selected person's minimal email/role and readiness. Only editors receive selectable active administrator/manager candidates. Invitations, revoked roster entries, account metadata, and phone information are excluded.
- Revoking the selected member or changing their role to viewer clears the assignment in the same transaction. Rejoining or later promotion never restores it automatically. Administrator-to-manager and manager-to-administrator changes retain the assignment.
- Clearing asks for confirmation and displays that the practice will have no reminder recipient. Replacement is an explicit save with the old and proposed recipient visible. No automatic backup selection.
- Phone verification/consent/opt-out belong to E4-S1. Here readiness is `no-recipient`, `sms-setup-pending`, or defensive `member-unavailable`; `ready` is always false. Display “No reminder recipient selected” or “Recipient assigned. SMS setup pending.” Do not offer a nonfunctional enrollment button or claim a text was sent/scheduled.
- Put the recipient panel on `/practice` for all active members. Keep team management on `/practice/team` restricted to administrators. No new route or proxy matcher is required.

### Permission matrix

| Action                                        | Administrator        | Office manager | Viewer | Revoked/nonmember |
| --------------------------------------------- | -------------------- | -------------- | ------ | ----------------- |
| Read current recipient/readiness              | Yes                  | Yes            | Yes    | No                |
| Read eligible candidate projection            | Yes                  | Yes            | No     | No                |
| Assign, replace, clear                        | Yes                  | Yes            | No     | No                |
| Profile edit/team management                  | Existing permissions | No             | No     | No                |
| Read private recipient audit/storage directly | No                   | No             | No     | No                |

### Foundation acceptance criteria

| ID   | Required behavior                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | Upgrade preserves existing profiles, memberships, invitations, and historical audits; each practice has one unassigned settings row at version 1. New practice initialization remains atomic.                               |
| AC2  | Editors assign/replace only a same-practice active administrator/manager. Foreign, unknown, revoked, viewer, and invitation IDs fail without mutation or identifying foreign data.                                          |
| AC3  | UI, action, and direct RPC permission checks agree. Authority derives from verified identity/live membership, never posted actor/practice/role or editable metadata.                                                        |
| AC4  | All active members read current selection/readiness; viewer responses contain no candidate roster. Reads/mutations after revocation fail using the same existing session.                                                   |
| AC5  | Recipient version is independent of profile/member versions. Stale saves conflict; two different saves with the same version have one winner. Matching-version same-target saves are no-ops.                                |
| AC6  | Each actual assignment/replacement/clear writes exactly one private recipient event with actor, before/after membership, version transition, reason, and database time. Audit failure rolls back state/version.             |
| AC7  | Controlled member revocation/viewer demotion clears selection, advances recipient version, and audits atomically with the access mutation. Rejoin/promotion does not silently reassign. Eligible role changes do not clear. |
| AC8  | Assignment versus candidate/editor access changes serializes on the existing practice lock; actor and candidate are rechecked after waiting. No newly invalid candidate or revoked editor can save successfully afterward.  |
| AC9  | Input survives validation, forbidden, conflict, and transport failures. Successful results carry the committed version, refresh saved state, and prevent accidental stale overwrite after recovery.                         |
| AC10 | Keyboard, labels, focused status/error messages, pending state, explicit clear confirmation, mobile layout, and truthful SMS readiness work; profile/team/join regressions remain green.                                    |

## Key Discoveries

- `supabase/migrations/20261005211436_practice_membership_authority.sql:80` defines `private.require_administrator`: it acquires the practice lock before checking live administrator membership. Add a recipient-specific editor helper rather than broadening this shared helper.
- `supabase/migrations/20261005212526_practice_invitations.sql:80` implements an administrator-only complete roster. Reusing it for manager selection would expose invitation/history data and grant unrelated access.
- `private.mutate_member` at line 246 already locks practice, then rereads/locks the target membership and checks last-administrator/version invariants. Extend this controlled mutation boundary to clear an invalidated recipient. A membership trigger that first obtains a membership row lock and then a practice lock could invert the established order.
- `private.create_practice` in the membership migration at line 149 atomically creates profile and administrator. Extend that implementation in a new migration to initialize recipient settings, retaining existing retry semantics and the public signature.
- Profile UPDATE always increments its own version and audits name/timezone. A separate recipient settings record prevents misleading profile audit events and unrelated profile conflicts.
- `src/lib/team/schema.ts:versionSchema` supplies the positive PostgreSQL integer range; `src/lib/team/messages.ts:formInput` shows action metadata filtering. Build a separate recipient domain with its own typed errors, keeping the administrator-only team operations intact.
- `src/proxy.ts:7` already covers `/practice/:path*`; `src/lib/supabase/session.ts:updateSession` sets private/no-store headers. Existing route protection can be retained.
- `tools/schema-fingerprint.mjs` includes every private table and public/private application function, so private recipient storage is already discoverable. Its reviewed contract still needs regeneration. `tools/foreign-key-controls.mjs:4` hardcodes three SQL suites; the recipient suite must be added.
- `tools/access-upgrade.mjs:13` automatically applies all migrations after E1-S1, but snapshots only profiles/profile audits. Add a distinct E1-S2-to-E1-S3 preservation rehearsal instead of attributing that coverage to the existing upgrade test.
- Current official guidance confirms explicit function grants, private definer implementations with pinned search paths, and separate table grants/RLS. Follow the existing wrapper design. Sources: [database functions](https://supabase.com/docs/guides/database/functions), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Data API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically). The markdown changelog index was unavailable; the HTML index and relevant linked change were reviewed.

## What We Are Not Doing

Phone collection, phone verification, consent/opt-out handling, SMS provider selection, message dispatch, scheduling infrastructure, credential-specific responsibility overrides, backup recipients, practice switching, a general audit viewer, dependency upgrades, SMTP configuration, or production rollout. Rule 9 remains required future integration, specified below.

## Implementation Approach

### Storage and lifecycle

Add `private.practice_reminder_settings`: `practice_id` primary key with restrictive practice FK; nullable `membership_id`; positive integer `version` default 1; created/updated timestamps. Add UNIQUE `(practice_id,id)` on `public.practice_memberships`, then a restrictive composite FK `(practice_id,membership_id)` to that pair. This prevents cross-practice selection in storage; null means unassigned. Index the selected membership reference for referential/lifecycle checks.

Add `private.practice_recipient_events`: UUID ID, restrictive practice/actor/before-membership/after-membership references, operation (`assigned`, `replaced`, `cleared`, `member-invalidated`), before/after versions, invalidation reason where applicable, and database occurrence time. Before/after membership references also use composite practice keys. Actor is the verified user for these controlled application mutations; no fabricated actor or enrollment event. Enforce event-shape checks: assigned is null → nonnull; replaced is distinct nonnull → nonnull; cleared/member-invalidated is nonnull → null; `after_version = before_version + 1`; reason is present exactly for member-invalidated. Preserve events against deletion. Index practice, actor, and referencing membership columns.

Enable RLS and explicitly deny PUBLIC/anon/authenticated table access on both private tables. No exposed table or view is needed. Backfill unassigned settings before installing the updated creation function; initialization creates no assignment event. Missing settings for an authorized practice is an integrity/unavailable failure, never a fabricated successful read or a silently reinitialized version.

Use new private implementations and authenticated public SECURITY INVOKER wrappers: `get_practice_reminder_recipient(p_practice_id uuid)` and `set_practice_reminder_recipient(p_practice_id uuid,p_membership_id uuid,p_expected_version integer)`, returning JSON. The setter uses SQL null for explicit clear; omission/malformed form values must not become a clear. Revoke default EXECUTE from PUBLIC/anon/authenticated, then grant only the wrappers and their checked private implementations to authenticated. Internal helpers remain uncallable. Pin empty search paths and qualify all objects.

Read projection: settings version, selected minimal membership identity/email/role/state or null, readiness, `ready:false`, editor capability, and candidates only for authorized editors. Do not accept a client-supplied `canEdit`. Read and project from live membership under one practice lock, following the existing roster pattern; release at transaction end. Runtime schemas enforce coherence: no-recipient requires null selection; sms-setup-pending requires a selected active administrator/manager; member-unavailable accommodates an invalid stored selection without treating it as eligible; candidates are absent when canEdit is false and contain only eligible memberships otherwise. A defensive invalid selection never reports readiness true. Read must not mutate or invent an audit event.

Setter: lock practice first; recheck authenticated editor; validate expected version; lock settings; check version before no-op detection; validate target's current same-practice eligible membership; then update settings and insert its event. Matching current version and identical target returns current success without an event/increment. A stale version conflicts even if the target happens to match; after a lost response the UI asks the user to reload rather than silently retrying with a newer version. Invalid targets use one neutral `invalid-recipient` result; unauthorized practices return forbidden. SQL invalid scalar inputs cannot report success.

Add a private invalidation helper called from a new-migration replacement of `private.mutate_member`, after a successful state/role update and before return, only when the new state is revoked or role viewer. Under its existing practice/member locks, require the settings row to exist, then clear a matching selection, increment version, and append `member-invalidated` with the same actor. A missing row is an integrity failure even when the member is not selected; never implicitly reinitialize it. With valid settings and a different/null selection, do nothing. Audit failure must roll back the member/access/recipient changes together. Preserve all existing version, final-admin, no-op/repeated-revoke behavior and error signatures. Ordinary direct membership writes remain denied. Privileged SQL repairs must follow the same locking/invalidation helper protocol; they are not an alternative application write path.

Lock order: practice → membership when a member mutation requires it → recipient settings. Recipient assignment does not need to lock candidate membership separately: the practice lock serializes every supported eligibility mutation; reread it after that lock. Create/accept continue using user advisory lock before practice; no recipient operation obtains it afterward. Use volatile mutation functions and fresh READ COMMITTED statements after locks.

### Application and recovery

Add `src/lib/recipients/{schema,repository,operations,messages}.ts`. Reuse live `getPracticeAccess`, verified `auth.getUser`, strict Zod input, bounded version validation, and runtime response validation. Input is a tagged assign/clear union: assign requires a UUID membership ID; clear requires its explicit intent without an ID. Reject unknown fields. Derive practice ID server-side and never accept actor, practice, readiness, consent, or role fields from the form.

Add `src/app/practice/recipient-actions.ts` and `src/components/recipients/recipient-panel.tsx`. Keep action state/types in the recipient domain. Interpret auth expiry as login redirect, denied access as safe permission text, stale versions as reload-required conflict, target invalidation as a replacement/reload instruction, and outages as retryable unavailable. Return only validated safe data.

Keep pending selection in controlled client state so React action resets do not lose it on failure. Store the newest committed response/version separately. On success refresh the server view; key/reset state on authoritative recipient version. Conflict recovery explicitly reloads before saving and does not automatically resubmit against a new version. Current selection is distinct from an unsaved proposed selection. Pending saves disable repeats; empty selection requires an explicit confirmed clear. Use a recipient-specific result message so a save does not imply settings/role changes or SMS delivery.

## Phase 1: Recipient Persistence and Access Contracts

### Files and changes

- Discover pinned local CLI commands with `--help`; create one new migration using `supabase migration new practice_reminder_recipient`. Preserve all three existing migrations.
- Implement settings/events, composite keys/FKs, versioned RPCs, initialization/backfill, and private helpers. Replace only the necessary `private.create_practice` and `private.mutate_member` bodies in the new migration.
- Regenerate `src/lib/supabase/database.types.ts` from the replayed public schema; private tables remain absent from client table types.
- Add `supabase/tests/practice_recipients.test.sql` and `tests/integration/practice-recipients.test.ts`, using existing guarded fixture helpers.

### Automated verification

Run fresh local replay and targeted SQL/integration tests for AC1–AC8: role matrix; same/foreign/unknown/viewer/revoked/invitation targets; explicit clear; no-op and stale save; same-version concurrent replacements; candidate demotion/revocation in both serialization orders; editor revocation while blocked; eligible role transition retained; invalidation and rejoin/promotion; audit failure during assignment, replacement, clear, and invalidation. Inject a failing settings INSERT during new practice creation and assert rollback of profile, initial administrator, profile/access audits, and settings; retain existing creation audit-failure cases. Test missing settings during recipient reads/writes and member invalidation, including an unselected target. Assert exact private event counts/values and event-shape constraints, no profile version changes, direct private/table/helper denials, wrapper grants/invoker status, and restrictive cross-practice FKs.

Required race witnesses use separate real database sessions, a deliberately held practice lock, and observed waiting before release; scheduling two promises alone is insufficient. Use the same preexisting JWT after access changes.

### Manual verification

Inspect only local fixture rows/events for backfill, version progression, correct actor, and complete rollback. Confirm no imaginary consent/phone/job state is stored.

Exit: the new schema/API contracts pass and inherited access invariants remain intact.

## Phase 2: Typed Recipient Operations and Server Action

### Files and changes

- Add the recipient domain modules and dedicated action, without widening team/profile permissions.
- Add `src/lib/recipients/schema.test.ts`, `src/lib/recipients/properties.test.ts`, `tests/unit/recipient-operations.test.ts`, and `tests/unit/recipient-actions.test.ts` for strict inputs, verified identity, role gates, RPC arguments, safe outcomes, and malformed replies.
- Extend `stryker.config.mjs` for new handwritten operations/actions/schema/messages; extend property selection in `stryker.properties.config.mjs` and `vitest.properties.config.ts` for the recipient schema properties.

### Automated verification

Run unit tests, lint, and types. Cover positive bounded versions; zero/negative/overflow/NaN; duplicate/extra form fields and file values; missing assign ID; explicit clear; forbidden posted practice/actor/readiness/role fields; auth/transport failures; safe response projection; post-check database denial; conflict/no-op/version outcomes. Confirm a malformed success never becomes an application success.

### Manual verification

Review input-to-RPC mapping and public action result shape against Phase 1. Confirm a lost response leads to explicit reload with no hidden retry using a new version.

Exit: AC2–AC6 and AC9 have application-boundary witnesses in addition to database witnesses.

## Phase 3: Practice Recipient Interface

### Files and changes

- Add `src/components/recipients/recipient-panel.tsx`; integrate into `src/app/practice/page.tsx`. Adjust `src/app/globals.css` only as needed for the existing panel/form layout.
- Add `tests/unit/recipient-panel.test.tsx` and update `tests/unit/routes.test.tsx` for recipient reads, editor/viewer variants, and errors.
- Add `tests/e2e/practice-recipient.spec.ts`, using existing local account/browser helpers; retain current profile/team/join regression coverage.
- Where team controls revoke/demote staff, add a short explanation that an assigned recipient will be cleared. Derive this from current recipient data for administrators without widening roster access; test the explanatory copy if `src/components/team/member-controls.tsx` and `src/app/practice/team/page.tsx` change.

### Automated verification

Browser scenarios: unassigned → self/manager assignment → replacement → refresh/sign-out/sign-in persistence → explicit clear; manager can edit recipient while profile/team stay restricted; viewer sees selection but no picker or candidate data; two open pages conflict; revoked/demoted selected staff clear; rejoin does not restore; invalidation between picker load/save rejects safely; pending and unavailable saves preserve input; success followed by failure keeps the latest committed version. Verify no-store headers and existing foreign-Origin action rejection on the new action.

Assert keyboard operation, focused error/status message, labeled selection, clear confirmation, axe checks, and 375px horizontal-overflow checks. Any tests traversing invitation links keep traces/screenshots/video off as existing token-bearing suites do. Intentional screenshots must not capture raw invitation links.

### Manual verification

Inspect desktop/mobile rendering and keyboard flow. Read readiness and save text as a user: selection means responsibility assigned; SMS remains pending. Confirm original profile edit/recovery and invitation flows still work.

Exit: AC4, AC9, and AC10 pass in the complete production-built local browser flow.

## Phase 4: Upgrade Evidence, Verification Tooling, and Documentation

### Files and changes

- Add `tools/recipient-upgrade.mjs` for E1-S2 → latest: create two practice fixtures with active/revoked memberships, role changes, pending/accepted/canceled invitations, and audits; snapshot every existing application table and full schema fingerprint; rehearse transaction rollback and compare both row snapshots and the entire pre/post fingerprint, including replaced function definitions/ACLs, constraints, and indexes; then perform real migration upgrade; compare historical rows exactly; assert null/version-1 backfill/no recipient events; compare fresh replay schema. A pg_class-only catalog comparison is insufficient for replaced function bodies. Reuse fixed-loopback/project/non-fixture guards.
- Add a `recipient-upgrade` layer in `tools/layers.json` and `tools/gauntlet.mjs:requiredLayers`. Existing checker controls exercise generic inventories; retain them and add focused coverage for any changed checker behavior. Preserve the older E1-S1-to-latest rehearsal.
- Refresh `tools/schema-contract.json` only after inspecting new tables, composite constraints/indexes, replacement functions, and grants. `tools/schema-fingerprint.mjs` already includes the private objects; change it only if an actual coverage gap is found.
- Extend `tools/foreign-key-controls.mjs` with the new SQL suite/exact TAP inventory and real dropped composite-FK, private-grant, and anonymous-RPC faults. Preserve the existing nine-FK assertion for its existing three tables.
- Extend `tools/sql-mutants.mjs` with recipient role/tenant/version/post-lock authorization/audit/invalidation faults that execute the expected new tests and restore the schema. Replacing `private.mutate_member` must preserve existing fault applicability or update selectors deliberately without weakening checks.
- Existing capability and broad unit/integration/browser discovery should find conventional new files; verify that they do. Maintain mutation/coverage thresholds and checker controls.
- Update `README.md` to describe recipient foundation, eligible roles, access-change clearing, pending SMS, and the new 29-layer verification count. Preserve historical documents. Write implementation evidence under `thoughts/shared/research/` mapping AC1–AC10 to actual source/check results and the deferred rule-9 gate.

### Automated verification

Use the repository's `.tools/node/bin` (Node 24.21.0). Run narrow tests after each phase, then broader checks because shared creation/member functions and schema/tooling change:

| Command                                                                 | Required result                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` | All application/format/type regressions pass                                              |
| `npm run db:reset`, `npm run test:db`, `npm run test:integration`       | Dedicated local replay, grants, constraints, API/race/audit behavior pass                 |
| `node tools/recipient-upgrade.mjs`                                      | E1-S2 historical data preserved; rollback/backfill/replay witnessed                       |
| `node tools/check-generated-types.mjs`                                  | Public types match the resulting schema                                                   |
| `npm run build`, `npm run test:e2e`                                     | Production local UI and inherited browser suites pass                                     |
| `npm run gauntlet`                                                      | All existing 28 layers plus the recipient upgrade layer pass with current-source evidence |

Reset/upgrade/fault-injection commands target only the guarded dedicated local stack. The gauntlet requires committed application source (`tools/source-state.mjs` excludes thoughts); follow implementation-time checkpoint authorization. No source commit, schema reset, or deployment is part of this planning turn.

### Manual verification

Review complete implementation diff, upgrade/rollback records, function-grant changes, final UI, and acceptance evidence. Distinguish automated, agent-observed, and user-confirmed results. Report every unrun check.

Exit: the foundation is verified without lowering inherited gates or claiming SMS acceptance.

## Mandatory E2/E4 Integration Gate: Original Rule 9

After cycles and SMS enrollment/jobs exist, extend the **same transactional recipient setter/invalidation boundary**, rather than polling audit events as a queue:

1. Cancel all unsent jobs associated with the former practice recipient on replacement, explicit clear, and member invalidation. Preserve accepted/in-flight attempt history and do not claim messages can be recalled.
2. Read the new member's current verified phone, consent, and opt-out state; readiness becomes true only when every dispatch requirement is satisfied. Assignment never grants consent or copies another person's enrollment.
3. Reconcile each active cycle against the new eligible recipient. Inside the 60-day window, create one logical catch-up job under the cycle/revision/recipient/lead-day key; outside it, schedule the usual 60-day job. Missing dates produce no guessed job; completed/archived cycles are suppressed.
4. Recheck live recipient/member/enrollment/revision state at dispatch. Recipient changes and concurrent schedulers must not duplicate logical jobs; already accepted messages retain history.
5. Execute tests for before/inside/exactly-60-day/due-today/past-due/missing-date cycles, invalid or opted-out enrollment, revision/completion/archive races, repeated replacement, member invalidation, job/audit rollback, and concurrent reconciliation.

This integration depends on E2-S2 and E4-S1–S3. It is specified future work, not code against imaginary tables. The full original E1-S3 rule-9 criterion remains open until these witnesses pass; record that explicitly in status/evidence.

## Risks and rollback considerations

- Manager recipient editing and limited candidate-email disclosure are explicit scoped decisions; keep profile/team powers unchanged and never return roster history to viewers/managers.
- Replacement of shared private creation/member implementations must preserve their exact existing semantics, privileges, and tested lock order. Prefer explicit lifecycle helper calls under existing locks over a new membership trigger with reverse lock acquisition.
- Audit or settings storage failure during member invalidation intentionally prevents that access mutation from committing. Test atomic failure and document retry/recovery; never leave a successful access change without its required recipient transition.
- The migration is additive apart from compatible private function extensions. The prior E1-S2 application can continue using unchanged RPC signatures with the new database; rehearse that compatibility. New application needs the new schema. A code-only rollback hides the recipient UI but should retain settings/events and lifecycle clearing. Do not drop real assignment history or restore creator-based authority.
- Readiness remains false until SMS enrollment and scheduling exist. An apparently eligible member is not evidence of phone verification, consent, or delivery.
- Privileged repairs bypass ordinary application permission boundaries; operations must use the prescribed locks/lifecycle helper. Defensive reads fail closed for invalid selections.
- Production release is separately authorized work. Future rollout should apply the tested additive migration before exposing the new UI, verify existing data/grants and old/new RPCs, and retain a forward-repair path. No real recipient is changed by release smoke tests.

## Completion Criteria

Foundation completion requires AC1–AC10, current-source evidence for all required checks, preserved profile/team/join behavior, reviewed upgrade/rollback, and truthful SMS status. Full original-story completion additionally requires the E2/E4 rule-9 integration gate. The user approved local implementation; production rollout remains separate work.

## Implementation Progress

- [x] Phase 1: Persistence, real API/SQL contracts, and generated types.
- [x] Phase 2: Typed domain/actions and unit/property verification.
- [ ] Phase 3: Recipient panel and production browser verification.
- [ ] Phase 4: Upgrade/control tooling, full verification, and documentation.
- [ ] User-confirmed manual acceptance.
- [ ] Future E2/E4 original rule-9 integration gate.

Implementation checkpoint: database replay, 72 SQL assertions/23 applied controls, full API regression (62 tests before the additional lock witness), domain/UI unit checks (180), property mutation (100%), production build and three targeted recipient browser scenarios passed. E1-S2 upgrade preserved all five historical tables and full schema rollback. The final full gauntlet, inherited browser suites, and SQL fault campaign remain in progress. User manual acceptance and the future SMS gate remain unchecked.
