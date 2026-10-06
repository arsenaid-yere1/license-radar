# E2-S1: Clinician and Practice-Owned Records Implementation Plan

Date: 2026-10-06 (America/Los_Angeles).
Baseline: `fc337c1224d18987896f311d45127059aed41f2a`.
Status: Implementation written; final 30-layer verification pending local checkpoint authorization.
Research: `thoughts/shared/research/2026-10-06-e2-s1-register-ownership.md`.

## Overview

Deliver E2-S1: “As a manager, I can create clinician and practice-owned records so all renewal types can be represented.” Add the ownership foundation and a usable register: clinicians, records belonging to a clinician or the practice, and one shared practice policy linked to several clinicians.

The original backlog is `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md:172`; `README.md:32` names this story next. E2-S2 adds authoritative dates and issuer/jurisdiction fields. E2-S3 adds editing, archiving, and suspected-duplicate review. E2-S1 will display date entry as pending and will not manufacture cycles or reminders.

## Current State

There is one Next.js/React/TypeScript application, with Supabase Auth/PostgreSQL and Zod; no monorepo packages or worker. Routes/actions live in `src/app/`, UI in `src/components/`, domain/persistence in `src/lib/`, schema/security in `supabase/`, and verification in `tests/`/`tools/`.

Practice setup, roles/invitations, and recipient assignment exist. `src/lib/practice/access.ts:getPracticeAccess` derives the caller's practice and live role. `src/lib/auth/require-user.ts:requireUser` and `src/lib/supabase/server.ts:createClient` provide authenticated cookie clients. `src/app/practice/page.tsx:Settings` remains the landing page. Generated types in `src/lib/supabase/database.types.ts` contain no register tables or RPCs.

The E1-S3 release handoff (`thoughts/shared/handoffs/2026-10-05-e1-s3-production-release.md`) records production delivery and 29 passing local verification layers. This is historical evidence; this planning turn checked the local baseline only.

## Desired End State

| ID   | Acceptance criterion                                                                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | An active administrator or manager can create a clinician by display name without creating a login, invitation, membership, or SMS enrollment.                                                                                               |
| AC2  | Either editor can create a named state license, DEA registration, or malpractice policy with explicit clinician or practice ownership; one clinician can own multiple records, including multiple of the same type.                          |
| AC3  | A practice-owned malpractice policy can cover zero, one, or multiple same-practice clinicians. It remains one credential ID and one register entry. Duplicate coverage IDs are rejected.                                                     |
| AC4  | Database constraints and RPC validation reject foreign or missing owner/coverage references; every read/write is practice-authorized. IDs in requests are not authority.                                                                     |
| AC5  | All active practice members, including viewers, can read the shared register. Viewers, revoked members, anonymous users, and outsiders cannot create records. Live authority is rechecked after the practice lock.                           |
| AC6  | Names/titles are required and bounded to 120 Unicode code points after normalization. Type/owner combinations, IDs, extra fields, and malformed form submissions are validated at application and database boundaries.                       |
| AC7  | Entity, coverage, immutable create receipt, and private actor/time/after-state audit commit together. A failure anywhere rolls back the complete creation.                                                                                   |
| AC8  | Concurrent or repeated creates with the same actor/practice/request key and identical normalized payload return the original success without new entity/link/audit rows. Reusing a key with another payload or operation returns a conflict. |
| AC9  | The register persists across reload/sign-in, distinguishes a real empty result from a read outage, preserves draft input on validation/save failure, blocks pending repeats, and offers an unchanged retry after a lost response.            |
| AC10 | Forms and shared-policy lists work by keyboard and at 375px width, with labeled fields, linked errors, focused/live result feedback, and read-only viewer presentation.                                                                      |
| AC11 | Existing practice/team/join/recipient behavior and historical data survive upgrade; new public-table protections enter the schema fingerprint and fault controls.                                                                            |
| AC12 | The UI truthfully says “Dates not entered” and “Text reminders are not active yet.” No legal-validity status, calendar event, reminder count, or successful SMS claim is inferred.                                                           |

Planning choices are explicit defaults, not additional user-confirmed requirements. No material decision remains open for this slice.

## Key Discoveries

1. Clinicians and authorized staff serve different purposes; never reuse `practice_memberships` as the clinician roster.
2. `private.current_practice_id` in `supabase/migrations/20261005211436_practice_membership_authority.sql` supplies live membership-based RLS. Its administrator-only write guard must not be broadened for register editing.
3. `private.require_recipient_member` in `supabase/migrations/20261006003555_practice_reminder_recipient.sql` provides the practice-lock-before-role-check pattern. Implement a separate register helper with equivalent read/editor role rules.
4. `private.accept_practice_invitation` in `supabase/migrations/20261005212526_practice_invitations.sql` takes user then practice locks; register calls must not take a user advisory lock after a practice lock.
5. `tools/schema-catalog.mjs:schemaQueries` currently omits any new public register tables in seven catalog sections. A regenerated contract alone would miss those protections unless the filters are fixed first.
6. `src/components/recipients/recipient-panel.tsx:safeRecipientAction` demonstrates that a save can commit before its response is lost. Creates need immutable retry keys and payloads.

## What We Are Not Doing

- Dates/cycles, issuer/jurisdiction, credential numbers, renewal URLs, regulatory lookups, or other obligation types (E2-S2/later scope).
- Editing, deleting, archiving, clinician deactivation, ownership changes, or duplicate warnings (E2-S3). Duplicate names/titles remain allowed.
- Calendar/dashboard, CSV, documents, phone enrollment, consent, SMS jobs/provider/worker, or completion workflows.
- Per-record responsible staff or changes to the E1-S3 practice recipient. Ownership identifies the record's subject, not the SMS recipient.
- New hosting/dependencies, auth rewrites, production migrations, deployments, or commits during this planning turn.

## Implementation Approach

### Resolved product rules

Use the three backlog type values: `state_license`, `dea_registration`, `malpractice_policy`. Each may be clinician-owned or practice-owned; do not impose unsupported legal ownership assumptions. Coverage links apply only to practice-owned malpractice. A clinician-owned policy names its owner directly and carries no additional coverage links. Coverage is optional so practice-only policies are representable.

Require only clinician display name, or record title/type/owner plus optional covered clinicians. Practice ownership derives from the record's own `practice_id`; no separately posted owner-practice ID exists. Clinician IDs need no associated staff account. Same-name people/records are permitted; display type and stable ID suffix when choices need disambiguation.

Apply the same explicit leading/trailing whitespace set in TypeScript and SQL (ECMAScript trim whitespace, represented as a literal character set in SQL); count Unicode code points with `Array.from`/`char_length`. Validate 1–120 after trimming, including astral characters and whitespace-only strings. Normalize UUID strings to lowercase before duplicate detection, then sort coverage arrays for payload comparison; SQL UUID values provide the same canonical representation. SQL independently validates NULLs, UUID references, enum values, ownership shape, and coverage eligibility.

### Persistence contract

Create the additive migration through the installed CLI's documented `migration new` command at implementation time; do not invent a timestamp here. Proposed tables:

| Table                              | Data and constraints                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.clinicians`                | UUID ID, practice FK, bounded display name, version 1, created/updated timestamps; unique `(practice_id,id)`.                                                                                                                                                                                                                                              |
| `public.credentials`               | UUID ID, practice FK, bounded title, type, `owner_kind`, nullable `owner_clinician_id`, version 1, timestamps. CHECK: clinician owner requires a clinician ID; practice owner requires NULL. Composite `(practice_id,owner_clinician_id)` FK to clinicians. Unique `(practice_id,id)` and `(practice_id,id,type,owner_kind)`. No date columns yet.         |
| `public.policy_coverage`           | Practice ID, credential ID, clinician ID; PK `(practice_id,credential_id,clinician_id)`. Composite clinician FK. Parent FK includes NOT NULL constant checked type `malpractice_policy` and owner kind `practice`, referencing the credential composite key, so NULLs cannot bypass the FK and non-policy/clinician-owned links fail even outside the RPC. |
| `private.register_create_requests` | Practice/actor/request UUID unique key, operation kind, canonical input JSON, immutable safe result JSON, timestamp. Restrict practice/actor deletion; no authenticated/anonymous direct grants. Store original normalized input separately from future mutable entity state.                                                                              |
| `private.register_audit_events`    | Practice, actor, operation (`clinician-created`/`credential-created`), exactly one clinician/credential target consistent with the operation, time, before NULL, normalized after JSON including coverage. Composite tenant FKs on targets and ordinary actor FK; private immutable client access.                                                         |

Required identity/type/owner/name/request fields are NOT NULL, with enum/positive-version/normalized-name CHECK constraints; nullable clinician ownership is the explicitly checked exception. Use restrictive deletion FKs throughout; add indexes for tenant reads and referencing FK columns, including owner/coverage reverse lookups. Do not seed clinicians, credentials, receipt records, or audit events for existing practices. New-practice creation needs no register bootstrap row or change to existing RPCs.

Enable RLS on every new table. Public SELECT policies use `practice_id = (select private.current_practice_id())`; grant only authenticated SELECT on the three safe public tables. Revoke all direct INSERT/UPDATE/DELETE/TRUNCATE and anonymous/public access. Private receipts/audits have RLS and no ordinary client table grants. No protected identifiers or roster email/history enter these tables.

### RPC and transaction contract

Add public SQL SECURITY INVOKER wrappers over private SECURITY DEFINER implementations, empty `search_path`, qualified references, explicit execute grants, and revoked default PUBLIC/anon execute, matching existing migrations. Private utility helpers remain non-callable by clients.

`private.require_register_member(p_practice_id uuid,p_edit boolean)` takes the practice lock, verifies active membership, and requires administrator/manager for `p_edit=true`; for reads it admits any active role. Keep the existing administrator and recipient helpers unchanged.

- `list_practice_register(p_practice_id)` returns `{clinicians,credentials}` with stable ordering `(created_at,id)`; each credential includes its owner label/ID and sorted coverage IDs/names. Check live active membership through the register helper. Return one credential object irrespective of coverage count. Aggregate the complete pilot register server-side, avoiding the Data API row-limit truncation; pagination/search is later scope. Read faults are errors, never empty arrays.
- `create_practice_clinician(p_practice_id,p_request_id,p_name)` returns `{status:'success',clinician}` or a safe `request-conflict`/`invalid` result.
- `create_practice_credential(p_practice_id,p_request_id,p_title,p_type,p_owner_kind,p_owner_clinician_id,p_covered_clinician_ids)` returns `{status:'success',credential}` or a safe `request-conflict`/`invalid-reference`/`invalid` result. Normalize absent coverage to an empty array only for valid input; invalid NULL elements and repeated IDs fail.

For every create: lock the practice; recheck `auth.uid()`'s active administrator/manager role; normalize/validate the payload; look up the caller-scoped receipt. An identical receipt returns the stored safe result after current authorization. A different payload/operation yields `request-conflict`. Otherwise validate all references, insert the entity/links, write one final audit snapshot, write its immutable receipt, and return. Serialize these operations on the practice lock, sharing the access-change boundary. Do not obtain later user locks or call team/recipient mutations. Authorization precedes receipt reads so revocation cannot replay successful writes as an information leak.

Grant authenticated execution only to entry implementations and wrappers as required by the existing pattern. Document that the directly callable private entry implementations enforce the same checks; implementation helpers have no client grants. Audit/receipt insertion failures abort the transaction. RPCs return safe projections and do not expose database errors or private metadata.

### Application contract and recovery

Add `src/lib/register/{schema,repository,operations,messages}.ts`. Use strict input schemas and runtime-parsed safe read/success projections like the recipient module. Result states: `success`, `invalid`, `invalid-reference`, `request-conflict`, `forbidden`, `unavailable`, `auth-required`. Operations verify Auth and derive practice/role through `getPracticeAccess`; posted practice, actor, role, timestamps, version, or audit fields are rejected.

The form parser ignores framework `$ACTION_` metadata, rejects duplicate scalar fields/files/unknown keys, and allows repeated `coveredClinicianIds` only as an explicitly parsed string array. Reject repeated UUIDs within that array. Discriminated inputs ensure clinician ownership requires its ID and practice ownership omits it; noneligible coverage is rejected, not silently erased. UI type/owner switches deliberately reset hidden incompatible draft fields.

Create a UUID request key once per form creation intent. On submission freeze the canonical payload/key; keep it for retries. A transport failure or generic unavailability is potentially post-commit: retain inputs, show uncertainty, and offer “Retry this save” with exactly that key/payload while blocking changed submissions. An acknowledged validation/reference failure permits correction because its transaction wrote nothing. Rotate the key/reset draft only on acknowledged success or an explicit new creation intent after resolution. A conflicting key requires reload/review, with no automatic new-key retry. Do not persist drafts in browser storage. Reload reads saved records first and never auto-submits; keyed idempotency does not deduplicate manually reconstructed entries or separate requests with new keys.

## Phase 1: Persistence and real authorization contracts

### Files and changes

- Add the CLI-generated register migration under `supabase/migrations/` and `supabase/tests/practice_register.test.sql`.
- Add `tests/integration/practice-register.test.ts` using `tests/helpers/local-fixtures.ts` and `tests/helpers/access-fixtures.ts` for real anonymous, administrator, manager, viewer, revoked, and two-practice clients.
- Regenerate `src/lib/supabase/database.types.ts`; private tables remain absent from public types.
- Add constraints, RLS/grants, checked wrappers/helpers, and create/audit/receipt atomicity before UI work.

### Automated verification

1. Replay on the guarded dedicated local stack; run the new pgTAP suite and targeted integration file, then inherited DB/API suites.
2. Witness multiple records per clinician, all types/both owners, zero/many policy links, wrong-practice/missing UUIDs, duplicate links, malformed direct RPC inputs, and public table SELECT isolation.
3. Verify direct client DML/private access/anonymous execute are denied; no new clinician affects memberships, invitations, or recipient settings.
4. Same-key sequential/concurrent identical requests create exactly one entity/audit/receipt; reordered coverage arrays replay identically. Changed name/type/owner/coverage/operation conflicts. Other actors cannot retrieve another caller's receipt.
5. Inject failures in entity, coverage, audit, and receipt writes and compare complete before/after row sets. Remove faults and demonstrate successful retry.
6. Queue a real create behind a practice lock, revoke or demote its caller, release the lock, and require denial. Separately witness blocking with authority still valid so the test would catch a removed lock, not just a later membership check. Reuse an already issued access token for revoked read/write tests.
7. Run generated-type comparison and SQL lint. Exercise Unicode/whitespace limits on both app-independent RPC calls and SQL.

### Manual verification

Review the complete migration, grants, composite FK behavior, lock order, safe projections, and error mapping. Confirm every audit/receipt is private and create replay cannot bypass current access.

Exit: AC1–AC8 database behaviors have real SQL/API witnesses; inherited mutations still work.

## Phase 2: Typed domain operations and action boundary

### Files and changes

- Add the register domain files above and `src/app/practice/register/actions.ts`.
- Add `src/lib/register/schema.test.ts`, `properties.test.ts`, `tests/unit/register-operations.test.ts`, and `register-actions.test.ts`.
- Use `src/lib/recipients/operations.ts`, `repository.ts`, `messages.ts` and `src/app/practice/recipient-actions.ts` for patterns; keep domain-specific rules separate.

### Automated verification

Run narrow register unit/property tests, then `npm test`, lint, and typecheck. Cover auth absence/expiry/outage, live access lookup failure, forged posted authority, all input branches, duplicate/file form fields, UUID/Unicode boundaries, canonical coverage ordering, safe RPC failures, malformed projections, private-field stripping, and login redirects. Properties must independently assert invariants rather than repeat implementation expressions.

### Manual verification

Review operation/action signatures for derived authority and explicit results. Confirm user-visible messages preserve useful validation while excluding raw database details.

Exit: domain/actions enforce the same ownership and input rules as SQL and cover safe failure paths.

## Phase 3: Register and creation forms

### Files and changes

- Add dynamic `src/app/practice/register/page.tsx`, protected by `requireUser`/`getPracticeAccess`; absent membership redirects to onboarding, read errors use the existing safe error boundary.
- Add `src/components/register/{register-panel,clinician-form,credential-form}.tsx` with separate clinician and record creation forms and saved lists. Use the existing `src/components/shell.tsx:Shell` and visual conventions.
- Add a “Renewal register” link in `src/app/practice/page.tsx` for all active roles and a return link to settings. Preserve `/` redirects, settings/recipient controls, and administrator-only team access. Existing proxy matcher already covers this route.
- Only administrator/manager roles see create controls. Owners are “This practice” or saved clinicians. Practice-owned malpractice exposes an accessible covered-clinician checkbox fieldset. Show owner, type, coverage, and date-pending text on each saved record.
- Add `tests/unit/register-forms.test.tsx`, extend `tests/unit/routes.test.tsx`, and add `tests/e2e/practice-register.spec.ts` following the real-fault/accessibility approach in `tests/e2e/practice-recipient.spec.ts`.
- Limit `src/app/globals.css` changes to register layouts and checkbox styling. Its existing generic `input` rule applies full width/padding, so coverage checkboxes need a scoped override; preserve other forms' styles.

### Automated verification

Test creation/reload/sign-in, multiple records, one practice policy covering two clinicians displayed once, manager creation without profile/team privileges, viewer read-only access, revocation after form load, read outages without fabricated emptiness, field errors retaining draft input, type/owner switch resets, and pending buttons/fields. Observe private/no-store response headers.

Intercept a real action response after database commit, abort it, then retry the immutable request and verify only one entity/link set/audit/receipt. Also test a pre-commit fault followed by same-key retry and a delayed first call plus repeated submission. Distinguish acknowledged save results from refresh failures.

Capture a foreign-Origin create POST using a real local fixture and require rejection without database changes. Run Axe and keyboard checks at 375px; validate no horizontal overflow and focused live feedback. Run the production build and targeted browser suite, then inherited browser suites.

### Manual verification

Inspect desktop/mobile empty, populated, read-only, coverage, validation, and uncertain-save states. Confirm the language makes ownership and coverage clear and says dates/SMS remain pending. Record agent inspection separately from user acceptance.

Exit: AC9–AC10/AC12 pass and existing navigation/role behavior remains intact.

## Phase 4: Upgrade, controls, and completion evidence

### Files and changes

- Add `tools/register-upgrade.mjs`, starting from migration `20261006003555` (E1-S3). Follow `tools/recipient-upgrade.mjs` and the guarded `tools/local-environment.mjs` reset/target rules.
- Seed two local practices with edited profiles, roles/invitations and recipient assignment/replacement/clearing history. Snapshot all seven existing application tables: practices, memberships, invitations, profile/access audit events, reminder settings, and recipient events. Settings ordering uses its `practice_id` key; the others use ID.
- Deliberately roll back the new migration transaction and compare every old row and all nine catalog sections. Apply normally, require unchanged old rows and empty new tables, create representative register data, and demonstrate old RPC compatibility. Fresh full replay must produce the same schema. Restore the local stack in cleanup.
- Expand all seven public-table filters in `tools/schema-catalog.mjs` to clinicians, credentials, and policy coverage; record/review `tools/schema-contract.json` through `tools/schema-fingerprint.mjs`. New private tables/functions are included already. Add tooling controls proving every new public table appears in all applicable sections and removed protections fail comparison; extend `tools/gauntlet-controls.test.mjs` as needed.
- Add the register suite/TAP inventory and applicable removed-FK/check/grant controls in `tools/foreign-key-controls.mjs`; add independent role, tenant read/reference, serialization, idempotency, and audit/receipt faults to `tools/sql-mutants.mjs`. Each needs named behavioral failures, baseline execution, and proven restoration.
- Extend `stryker.config.mjs`, `stryker.properties.config.mjs`, and `vitest.properties.config.ts` with register modules/properties. Preserve the inherited 100% mutation and complete application line coverage gates (`tools/check-coverage.mjs`).
- Add the register-upgrade layer to `tools/layers.json` before replay and to the independently enumerated `requiredLayers` array in `tools/gauntlet.mjs`. Preserve all 29 existing layers; expected total becomes 30. Earlier upgrade rehearsals must tolerate/apply the new additive migration and continue passing.
- Update `README.md` with actual implemented scope, register navigation, deferred dates/SMS, the next E2-S2 story, and verified layer count. Preserve historical research. Write acceptance-to-evidence results under `thoughts/shared/research/` after implementation.

### Automated verification

Use repository Node 24.21.0 and run narrow phase checks first. Required final commands:

| Command                                                                                                  | Required result                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`                                  | All relevant and inherited formatting/lint/type/unit checks pass.                                      |
| `npm run db:reset`, `npm run test:db`, `npm run test:integration`                                        | Guarded full replay and real SQL/API behavior pass.                                                    |
| `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests`                                    | New and inherited SQL pass.                                                                            |
| `node tools/register-upgrade.mjs`                                                                        | Seven historical tables preserved; full rollback, compatibility, empty backfill, and replay witnessed. |
| `node tools/schema-fingerprint.mjs`, `node tools/check-generated-types.mjs`                              | Reviewed expanded schema and tracked public types match live local replay.                             |
| `npm run test:controls`, `npm run mutation`, `npm run mutation:properties`, `node tools/sql-mutants.mjs` | New/inherited controls and faults execute, catch behavior, and restore.                                |
| `npm run build`, `npm run test:e2e`                                                                      | Production-local register and inherited browser behavior pass.                                         |
| `npm run gauntlet`                                                                                       | All 30 required layers pass against current committed implementation source.                           |

Run destructive/fault/replay tools sequentially on the guarded dedicated local fixture stack. Do not run them against hosted projects. The gauntlet's `tools/source-state.mjs` requires an implementation checkpoint; obtain any needed commit authorization during implementation rather than bypassing the gate. No commit is requested or made in this planning turn.

### Manual verification

Review the final diff, schema/upgrade/fault restoration records, acceptance evidence, and interface. List commands with actual results and unrun checks. User-confirmed acceptance stays separate from automated and agent-observed checks.

Exit: AC11 and all inherited gates pass; documented behavior matches the delivered ownership slice.

## Risks and rollback considerations

- Several covered clinicians must not multiply policy identities. E2-S2 creates cycles on the credential ID; E4 jobs use cycle/revision/recipient/lead-day keys and must never fan out from coverage joins. Actual single-reminder dispatch remains unverified until those stories exist.
- Live access checks and practice serialization intentionally order creates with revocation/demotion. A create committed before revocation remains valid history; queued writes after it must fail. Avoid reverse lock order and preserve existing shared functions.
- Stable request keys prevent repeated delivery of the same create intent. They do not detect two intentionally new requests for the same named person/policy; duplicate review stays E2-S3.
- Complete pilot aggregation follows the existing roster pattern. Larger-register pagination is future work; do not add a silent result cap or claim production-scale benchmarking.
- The additive schema should remain compatible with the current E1-S3 app. A code-only rollback hides register creation while preserving new data/audits/receipts; do not drop real records or restore creator-based authority. Prefer forward repair.
- Future deployment applies the reviewed migration before the new app, checks historical preservation/grants and old/new RPCs, and keeps smoke probes read-only. Production release requires its own authorized request.

## Completion Criteria

AC1–AC12 have named source/test witnesses, the final diff is reviewed, all required inherited/new checks pass on the actual implementation, and rollout/recovery evidence is recorded. Ownership/coverage is complete; dates, calendar, editing, SMS, and E1-S3 rule-9 cancellation/catch-up remain explicit future gates. The next story is E2-S2.

## Implementation Progress

- [x] Phase 1: Persistence and real authorization contracts.
- [x] Phase 2: Typed operations/actions and unit/property checks.
- [x] Phase 3: Register/forms and production-local browser checks.
- [x] Phase 4: Upgrade/controls, full verification, and implementation evidence.
- [ ] User-confirmed manual acceptance (separate from automated completion).

All four implementation phases are complete. The clean committed checkpoint `888c1a773cf02cc7a523f90ec66323921967ee4e` passed all 30 required layers in run `16c41735-1e89-4e92-8502-1ee799bb0fd1`; final counts, commands, failed-run repairs, and assurance limits are recorded in `thoughts/shared/research/2026-10-06-e2-s1-implementation-evidence.md`. The source-state gate and existing thresholds remain intact. The later explicit “push to prod” request authorized the required checkpoints and coordinated production rollout. User-confirmed manual acceptance remains separate and unchecked.
