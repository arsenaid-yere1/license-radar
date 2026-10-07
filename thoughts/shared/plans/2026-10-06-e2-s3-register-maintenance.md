# E2-S3: Register Editing, Archiving, and Duplicate Review Implementation Plan

Date: 2026-10-06 (America/Los_Angeles).
Baseline: `27b728b4578a96d526e7fd25cf8f385284856e3c`.
Status: Implemented locally and verified; all 32 fresh verification layers passed.
Research: `thoughts/shared/research/2026-10-06-e2-s3-register-maintenance.md`.
Verification: `thoughts/shared/plans/2026-10-06-e2-s3-register-maintenance-verification.md`.
Implementation evidence: `thoughts/shared/research/2026-10-06-e2-s3-implementation-evidence.md`.

## Overview

Deliver E2-S3: “As a manager, I can edit or archive records so the register stays accurate.” Administrators/managers can correct existing credential metadata, ownership, coverage, and dates; explicitly archive an obsolete record; and review deterministic suspected-duplicate warnings. Preserve history, tenant access rules, conflict handling, and recovery after uncertain responses.

`README.md` names E2-S3 next; the original E2 acceptance criteria are in `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md`. E2-S2 is released according to `thoughts/shared/handoffs/2026-10-06-e2-s2-production-release.md`. Calendar events and reminder jobs do not exist yet. This slice supplies durable archive/revision contracts; actual event exclusion and unsent-job replacement/cancellation must be completed and tested in E3/E4. Do not describe the original job-related acceptance criteria as fully fulfilled by this slice.

## Current State

This is one Next.js/React/TypeScript application with Supabase Auth/PostgreSQL and Zod. Routes/actions, UI, domain/persistence, database, and verification are owned by `src/app/`, `src/components/`, `src/lib/`, `supabase/`, and `tests/`/`tools/`, respectively; there are no separate monorepo applications/packages.

`src/lib/register/schema.ts:registerInputSchema` and `src/lib/register/repository.ts:createRecord` support creation only. Credentials have versions, and every credential has an initial cycle with date revision 1 or greater. `src/components/register/register-panel.tsx:merge` adds missing IDs but never replaces existing records. Forms retain drafts and freeze uncertain requests. The applied register/date migrations enforce live authority after a practice lock, same-practice ownership/coverage, strict Gregorian dates, immutable receipts, and private audits; audits currently permit only creation and NULL before-state.

All active members read; administrators/managers write through checked RPCs. No archived state, maintenance API, suspected-duplicate rule, editable record form, calendar, outbox, or reminder worker exists. Current gauntlet inventory is 31 layers.

## Desired End State

| ID   | Acceptance criterion                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | Administrators/managers edit title, type, issuer, jurisdiction, owner, covered clinicians, expiration/coverage end, and earlier action deadline of an active credential, including filling dates on historical unknown-date records.                           |
| AC2  | Existing text/date/owner/coverage rules apply to edits, including unknown, historical, and action-only dates. Shared policies remain one credential/cycle.                                                                                                     |
| AC3  | A changed edit increments credential version once. Either date changing increments the same cycle's date revision once. Metadata/coverage-only edits leave cycle revision/timestamps unchanged; true no-ops change no business rows or audits.                 |
| AC4  | Stale version/cycle/revision writes conflict without overwriting newer data. The interface preserves the draft for comparison and requires an explicit reload/review before another write.                                                                     |
| AC5  | Archive requires a named-record confirmation, hides the record from the default active register, and preserves credential, coverage, cycle, historical dates, receipts, and audits. An explicit archived view remains readable by active members.              |
| AC6  | Archived records cannot be edited or restored in this slice. Concurrent/repeated archives do not add duplicate history; exact uncertain retries confirm the original result.                                                                                   |
| AC7  | Suspected active duplicates are flagged for human review using the rule below. Legitimate similar records can coexist; no automatic merge, deletion, or uniqueness rejection occurs.                                                                           |
| AC8  | Changed edits/archives atomically save full before/after snapshots, actor/time, and a caller-scoped immutable mutation receipt. Identical retries return the original outcome; changed payloads under one mutation key conflict.                               |
| AC9  | Viewer, anonymous, outsider, revoked, and demoted write denial applies before replay/data disclosure, including lock-wait races. Direct DML/private helpers/history remain denied.                                                                             |
| AC10 | Pending/uncertain requests freeze all fields and in-form cancellation/intent controls; exact-key retry recovers. Definite validation failure preserves editable drafts. Updated/archive display survives stale refresh without resurrecting known older state. |
| AC11 | Upgrade preserves every historical column/value/version/timestamp/cycle/link/audit/receipt and old creation responses verbatim; new archive fields start NULL and new receipt storage empty. Inherited and new verification gates pass.                        |
| AC12 | Date revision and archive state are explicit foundations for E3/E4; SMS remains inactive. No guessed dates, scheduled-job claims, legal-validity labels, or renewal completion semantics appear.                                                               |

These are resolved planning defaults. No material product or implementation question remains open for this slice.

## Key Discoveries

1. `policy_coverage_credential_fkey` references type/owner discriminator columns. Remove old coverage before switching them and insert only the final eligible coverage set in the same transaction.
2. `private.finish_register_create` and historical receipts must retain their exact creation behavior. Introduce separate mutation receipts/helpers and a maintenance projection; do not call create to implement an edit.
3. `private.credential_details_projection` requires initial cycle 1. Editing updates that row, not a successor; missing/mismatched cycles are failures, not guessed unknown dates.
4. `RegisterPanel` needs version-aware replacement and archive tombstones. Creation's append-only merge is insufficient.
5. `tools/schema-catalog.mjs` already includes all private tables. The new private receipt table needs explicit protection-removal tests, but no unrelated catalog-filter expansion.
6. The existing date upgrade tool applies later migrations too. Preserve its contracts while adding a populated E2-S2-to-maintenance rehearsal and keeping both gauntlet inventories aligned.

## What We Are Not Doing

- Clinician renaming/deactivation/archive, staff changes, new credential fields/types, CSV import, evidence uploads, or protected identifiers.
- Restore/unarchive, hard deletion, automatic merging, duplicate dismissal persistence, fuzzy matching, or an audit-history screen (E7-S2).
- Calendar/dashboard implementation, successor cycles, progress/completion, renewal links, reminder jobs/outbox, scheduling/dispatch, phone/consent, or accepted-message history.
- Hosted migrations, production database resets/deployment, or publication. The initial planning request was read-only; subsequent local implementation and fixture verification were separately authorized by “create specs and implement it.”

## Implementation Approach

### Maintenance and revision rules

An edit submits a full credential payload using the existing canonical normalization plus `id`, `requestId`, `expectedVersion`, `expectedCycleId`, and `expectedDateRevision`. The version/revision values are positive bounded integers. FormData string-to-integer conversion must reject signs, whitespace, exponent notation, decimals, zero, and overflow; never loosely parse with `parseInt`. Practice, actor, archive timestamp, tracking date, and audit data are derived server-side and rejected if posted.

Keep both existing owner modes for every existing type. Owner changes preserve dates/metadata while clearing incompatible owner/coverage choices. Changing type follows the existing create-form reset rule for metadata/dates/coverage, with an explicit warning/confirmation before discarding a populated edit draft; Cancel returns to the untouched saved record. SQL validates the final submitted payload independently, rather than silently clearing fields.

For normalized changed data, increment credential version and `updated_at` exactly once, including date-only edits. Change either date, including known-to-unknown or a changed end date under an unchanged earlier tracking deadline: increment date revision once and update cycle timestamp. Keep cycle ID/number, original creation timestamps, and all historical audits. Type/owner/title-only changes do not increment date revision; future dispatch must reread current metadata as well as archive/revision. Compare authored fields and sorted coverage IDs for no-op detection; derived owner names and duplicate candidates are not authored changes. No-op saves return success with `changed:false` and a receipt, but no version/timestamp/audit change. Check freshness before accepting even a no-op. Handle integer exhaustion as a safe conflict requiring review only when an increment is needed, with no partial writes.

Archive posts the same target/freshness tokens plus a new request ID; no editable metadata. Set nullable `credentials.archived_at` from database clock, increment credential version/time once, and leave cycle/coverage intact. New requests against an archived same-practice record return `archived` without a new receipt/audit; exact replay of a previously successful edit/archive is checked first and returns its original result. Unknown/foreign targets have the same safe `not-found` result and disclose no record. Archive has no automatic restore.

### Persistence, authority, audit, and recovery

Create an additive migration through the documented installed CLI during implementation; do not edit applied migrations or invent a migration timestamp here.

- Add nullable `archived_at timestamptz` to `public.credentials` with no backfill updates. Existing direct SELECT/RLS remains tenant-scoped, so archived inventory stays readable; active filtering is a read-view concern, not authorization. Add a practice/active-list index where appropriate after checking the query.
- Add `private.register_change_requests`: ID, practice/actor/request IDs, credential ID, operation (`credential-updated`/`credential-archived`), canonical payload, immutable result, creation timestamp, unique `(practice_id,actor_user_id,request_id)`, and restrictive practice/actor/composite credential FKs. RLS enabled, no PUBLIC/anon/authenticated table privileges/policies; helper execute denied. Mutation keys share this new namespace; the unchanged legacy creation namespace remains separate. Request UUIDs are independently generated for each intent.
- Expand the existing register-audit operation, entity-shape, and before-state CHECKs: creation still requires NULL before; credential update/archive requires credential ID only and non-NULL before. Historical rows and creation helper semantics remain identical. Use a new non-client-callable finish-change helper to insert audit and receipt together; no-op inserts only a receipt. Snapshots contain the complete safe credential, dates, coverage, and archive state, including old owner/type.
- Add uniquely named public invoker wrappers/private checked definer entries for `update_practice_credential`, `archive_practice_credential`, and `list_practice_register_with_maintenance(p_practice_id,p_include_archived boolean)`. Empty search paths, fully qualified references, minimal authenticated execution, private utilities inaccessible. Reject NULL include-archived input. Keep original creation signatures, projections, receipt payloads/results, parsers, and initial-cycle trigger unchanged.
- Each mutation first invokes `private.require_register_member(practice,true)`, which locks the practice before checking live membership. Validate/canonicalize, replay by actor/practice/key/operation/full payload, then locate the tenant-scoped credential and cycle and enforce archive/freshness. Recheck referenced clinicians within that practice. Holding the same practice lock serializes creates, edits, archives, and membership changes. Never put replay ahead of authority.
- Capture before-state; replace coverage safely; update credential and, only when dates differ, cycle; capture after-state; insert audit/receipt; return. Any exception rolls back every write. Expected input/reference/conflict states are safe acknowledged replies; unexpected SQL/transport/malformed-response faults stay unavailable/uncertain.
- Return `{status:'success',changed:boolean,credential:<maintenance projection>}`. The maintenance projection composes the unchanged details projection with required nullable `archived_at`. Duplicate candidates are live read data and do not belong in receipts. Original legacy and detailed creation replays return their historical projections even after edit/archive; they must never restore historical values or visibility.

Use `p_practice_id`, `p_request_id`, `p_credential_id`, `p_expected_version`, `p_expected_cycle_id`, and `p_expected_date_revision` for both mutations, plus the existing detailed-create authored arguments for update. All expected identifiers/integers must be non-NULL and valid at SQL entry. Canonical receipt payloads include the intent/contract discriminator, target ID, every expected token, and every normalized authored field; reordered coverage is equivalent. Return freshness `conflict` with the safe current maintenance credential so the client can compare it with the draft. Do not store failure/conflict receipts; corrected acknowledged-invalid requests may retry the unused key. Wrong cycle identity is a conflict, while an actually missing cycle is an unavailable invariant failure.

### Active/archived reads and duplicate review

The original `list_practice_register(uuid)` keeps its signature and existing projection shape, adding only active filtering (`archived_at IS NULL`). This makes old application rollbacks omit archived records too. The new maintenance list returns clinicians and complete maintenance credentials; default reads are active only, while `p_include_archived=true` includes preserved archived rows. Both paths perform live membership checking. Add sorted `suspected_duplicate_ids` to each new-list row only; archived rows have an empty list. Missing cycles or malformed archive/duplicate response shapes fail safely.

Duplicate suspicion compares two distinct active credentials within the same practice, with identical type, owner kind, owner clinician ID (NULL-safe), and exact normalized title, issuer, and jurisdiction. Normalize each text with existing trimming plus **ASCII A–Z to a–z only**, explicitly avoiding locale-dependent Unicode folding; treat absent optional metadata as equal NULLs. Dates and coverage are excluded so differing renewal dates or shared-policy selections cannot conceal an accidental second record. Different owners, types, titles, issuers, or jurisdictions do not match. This conservative rule is a suspicion, not identity proof; records with substantially different spelling may not be flagged.

Derive candidates in checked SQL reads with a private utility; there is no client authority for candidate IDs or persisted duplicate flag. Show “Possible duplicate — review these records” with titles, owner/type, date summaries, and links to in-page records. Warn after creation and on list reload/edit; do not add a blocking create-time preview or change immutable create responses. Editing a match apart or archiving one immediately removes both sides' active warning after successful reload. Reads isolate candidates by practice before matching; no foreign candidate is revealed. A read failure must not display an all-clear duplicate result.

### Interface and domain boundary

Keep `credentialSchema`/creation actions able to parse historical create projections. Add distinct maintenance read/success/input/result schemas in `src/lib/register/schema.ts`, using the existing fields/invariants and safe reply allowlists; new statuses include `conflict`, `archived`, and `not-found`. Domain operations derive practice authority and check authentication/access before input validation, matching `createRegisterRecord`. Repository functions bind new RPCs and strip private fields. Existing FormData parsing can be reused, but add strict expected-token conversion in the maintenance path. Add maintenance action/messages in the existing action/message files; preserve login redirect outside catch handling.

Add separate edit/archive components. Reuse the existing credential field markup through a small initial-values-capable extraction from `credential-form.tsx`; keep create defaults/reset behavior covered. Do not force maintenance into the create-only lifecycle abstraction. Edit opens prefilled fields, shows Save changes/Cancel, retains validation drafts, and holds baseline freshness tokens. Archive has an explicit confirmation naming the record and explaining it leaves active tracking but retains history. Viewers can read archived entries and duplicate warnings and see no maintenance controls.

Use `?view=archived` to request the maintenance list including archived rows and display only archived entries in that view; default view shows active records. Any other/multiple query values select the default active view. No new public route or record-detail feature is needed; list anchors support review. Give edit/archive success/conflict/retry feedback accessible focus and associated errors; return focus to an appropriate record/list control after closing.

As with current create drafts, maintenance drafts and frozen requests live only in the current page session; do not promise recovery after hard reload/navigation or add browser storage in this slice. Uncertain feedback tells the user to retry before leaving, and the register's view-switch controls are disabled while a mutation is pending/uncertain. Browser-level navigation remains possible; server receipts still prevent repeating a retained exact request from writing twice.

Replace append-only credential merge with a highest-version overlay shared by active/archived display. Remember successful archive results as tombstones until server data catches up. Server or returned newer versions win; an older reply/refresh cannot replace newer known state or resurrect an archive. Historical successful receipt results confirm the submitted action; refresh the authoritative list and require a fresh current baseline before opening another edit, rather than treating that receipt as proof of current data. Derive duplicate warnings only from the latest successful list response; show refresh failure visibly. Preserve creation's unsaved drafts during refresh and existing saved-clinician behavior. Freeze complete payload/tokens/key on uncertainty; disable cancel/intent changes and offer exact retry. Definite conflict preserves the blocked draft and shows the returned current values for comparison. An explicit “Reload saved values” action replaces the draft with that newer snapshot, establishes its freshness tokens, and rotates the unused request key; the user then reenters intended changes. Explain that this choice discards the draft. Do not rotate the key and blindly resubmit old data.

### Future scheduling contract

Document E3 event queries requiring `archived_at IS NULL`. E4 must transact edit/archive with its real outbox: a changed date revision obsoletes old unsent jobs; archive cancels unsent jobs; accepted attempts stay historical; replacement suppression/manual updated-send follows original rule 7. Workers must recheck archive state, current cycle/revision, recipient eligibility, and current metadata before dispatch. No placeholder queue, fake cancellation count, or runnable SMS abstraction is added now. The implementation evidence must retain these outstanding original acceptance dependencies.

## Phase 1: Database maintenance contracts

### Files and changes

- Add the CLI-generated maintenance migration under `supabase/migrations/` for archive state, mutation receipts, audit CHECK expansion, projections/duplicate reads, active-filtered legacy list, and checked update/archive/list RPCs.
- Add `supabase/tests/practice_register_maintenance.test.sql` and `tests/integration/practice-register-maintenance.test.ts`. Follow existing date SQL/API tests' real actors, snapshots, locks, and fault injection. Include new receipt storage in all new mutation snapshots.
- Regenerate `src/lib/supabase/database.types.ts` from the replayed public schema.

### Automated verification

On the guarded dedicated fixture stack, run `npm run db:reset`, `npm run test:db`, and `npm run test:integration -- tests/integration/practice-register-maintenance.test.ts`. Verify all types/owners, metadata/date corrections, NULL transitions, same effective date with changed underlying dates, exact version increments, no-ops, coverage add/remove/reorder/discriminator changes, and same cycle throughout. Verify archive/default/archived reads and preserved history; stale edit/edit and edit/archive races; concurrent identical requests; original replay after subsequent edits/archive; changed key payload/operation conflict; actor scoping; foreign/missing target privacy; anonymous/viewer/demoted/revoked denial including after lock waits and before replay.

Inject failures independently at credential, cycle, coverage deletion/insertion, audit, and receipt writes. Each failure preserves complete register row sets; restored exact retry succeeds once. SQL witnesses enforce grants/RLS, wrappers/helper denial, tenant FKs, audit before/after shapes, positive versions/revisions, date CHECKs, receipt uniqueness, and safe integer exhaustion. Missing cycles fail read/write without changes. Duplicate fixtures cover case/trim/NULLs, different owners/types/metadata, date/coverage differences, archived exclusion, cross-practice pairs, and update/archive warning removal.

### Manual verification

Review transaction order, authority/replay ordering, old API preservation, audit CHECK replacements, full projection shapes, and absence of deletion or guessed scheduling. Exit: AC1–AC9 database contracts and compatibility witnesses pass.

## Phase 2: Domain validation and server actions

### Files and changes

- Extend `src/lib/register/schema.ts`, `repository.ts`, `operations.ts`, and `messages.ts`; add separate maintenance schemas/functions/statuses while preserving create contracts.
- Extend `src/app/practice/register/actions.ts` with maintenance action handling and `page.tsx` with explicit active/archived loading and new action props.
- Extend `src/lib/register/properties.test.ts`, `tests/unit/register-operations.test.ts`, and `tests/unit/register-actions.test.ts` with maintenance boundaries. Keep existing creation/date tests unchanged unless a deliberate documented read-filter contract requires an adjustment.

### Automated verification

Run `npm test -- src/lib/register/properties.test.ts src/lib/register/dates.test.ts tests/unit/register-operations.test.ts tests/unit/register-actions.test.ts`, `npm run typecheck`, and `npm run lint`. Verify strict full payload/token parsing, FormData duplicate/file/unknown-field rejection, all inherited date/reference rules, derived practice/actor authority, denial before malformed-input disclosure, exact RPC bindings, safe conflict/archive/not-found messages, expiry redirect, thrown/unexpected/malformed replies, private-field stripping, coherent maintenance projections, and unchanged legacy creation parsing. Exit: AC2/AC4/AC8/AC9/AC12 domain boundaries pass.

### Manual verification

Inspect action/repository responsibilities and messages; ensure an unavailable response is never acknowledged as a definite failed write and duplicate read failures never claim no duplicates.

## Phase 3: Editing, archive confirmation, and review UI

### Files and changes

- Update `src/components/register/register-panel.tsx` for highest-version records, archive tombstones, active/archived navigation, duplicate review, and edit/archive controls.
- Extract initial-values-capable credential fields from `src/components/register/credential-form.tsx`; add `src/components/register/edit-record-form.tsx` and `src/components/register/archive-record-form.tsx`. Reuse field/error helpers from `src/components/register/create-form.tsx` without changing creation recovery semantics.
- Extend `tests/unit/register-forms.test.tsx`; add `tests/e2e/practice-register-maintenance.spec.ts` following the existing production-local date browser suite.

### Automated verification

Run the narrow register form suite, `npm run build`, and `npm run test:e2e -- tests/e2e/practice-register-maintenance.spec.ts tests/e2e/practice-credential-dates.spec.ts`. Verify prefilled editing, filling a historical unknown cycle, switching type with explicit draft-discard warning, owner/date preservation, shared coverage transitions, known/unknown date display, validation draft/error focus, Cancel with no writes, named archive confirm/cancel, active/archived reload/sign-in, viewer controls, and duplicate review links.

Use two real signed-in sessions for stale edit/edit and edit/archive; conflict must preserve the losing draft without overwrite. Lose an actual update/archive response after commit, retry the frozen request, and compare complete data/audit/receipt row sets. Cover precommit faults, revoked/demoted stale tabs, pending cancellation denial, stale server-refresh tombstones, replay of older success followed by authoritative refresh, read outage, and real foreign-Origin rejection without writes. Run Axe/keyboard at 375px, no horizontal overflow, and date rendering across differing browser timezones. Exit: AC4–AC7/AC10/AC12 interface witnesses pass.

### Manual verification

Inspect desktop/mobile edit/archive/duplicate/error/retry flows and keyboard focus. Confirm archive means retained history, duplicate means suspicion, and dates do not imply scheduled SMS or renewal completion. Record agent inspection separately from user acceptance.

## Phase 4: Upgrade, fault controls, and final evidence

### Files and changes

- Add `tools/register-maintenance-upgrade.mjs`, following `tools/credential-dates-upgrade.mjs` and `tools/local-environment.mjs` guards, with baseline migration `20261006225257`. Populate two practices and all thirteen historical application tables, including detailed/legacy receipts, known/unknown/action-only cycles, and shared coverage.
- Snapshot historical column lists before migration, then rehearse deliberate transactional failure and exact row/catalog rollback. Normal upgrade must preserve all old values and thirteen row sets, with only NULL archive column additions and empty mutation receipts. Replay old receipts verbatim; exercise edit/archive and immutable mutation replay; compare upgraded schema with fresh full replay and restore fixture stack in cleanup.
- Extend `tools/foreign-key-controls.mjs` with exact new TAP inventory and applied FK/unique/audit/grant removals. Extend `tools/sql-mutants.mjs` with executed faults for freshness, replay-before-version, payload/caller scope, version/date revision, archive filtering, duplicate boundaries, post-lock authority, coverage replacement, and audit/receipt atomicity. Require named assertion failures and schema restoration.
- Record/review `tools/schema-contract.json` across all nine sections; extend `tools/gauntlet-controls.test.mjs` to prove new receipt protections, mutation/read function privileges, audit constraints, and active-read definitions are fingerprinted. `tools/schema-catalog.mjs` already captures private tables and unchanged public table set; modify filters only if new evidence requires it.
- Extend both Stryker configs for any new domain module; if properties stay in existing register properties, `vitest.properties.config.ts` needs no inventory change. Preserve inherited mutation/coverage gates.
- Add `register-maintenance-upgrade` before replay in `tools/layers.json` and `tools/gauntlet.mjs:requiredLayers`, preserving all 31 existing layers (32 total).
- Update `README.md` with actual maintenance/duplicate scope, archived/history rules, inactive SMS, remaining E3/E4 job acceptance, and E3-S1 next. Store actual verification evidence in `thoughts/shared/research/` and update this plan's progress.

### Automated verification

Use Node 24.21.0. Run all inherited/new unit, formatting, lint, types, SQL, API, and production browser suites. Run resets/upgrades/faults sequentially on the guarded local fixture stack only.

| Commands                                                                                                 | Required implementation result                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`                                  | All inherited/new checks pass.                                                                                   |
| `npm run db:reset`, `npm run test:db`, `npm run test:integration`                                        | Fresh replay, full TAP/controls, real API, concurrency, and recovery pass.                                       |
| `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests`                                    | SQL passes.                                                                                                      |
| `node tools/register-maintenance-upgrade.mjs`                                                            | Populated thirteen-table preservation, rollback, old/new replay, and fresh catalog match pass.                   |
| `npm run test:controls`, `npm run mutation`, `npm run mutation:properties`, `node tools/sql-mutants.mjs` | Applied new/inherited faults are killed by required assertions and restored.                                     |
| `npm run build`, `npm run test:e2e`                                                                      | Production-local new/inherited browser flows pass.                                                               |
| `npm run gauntlet`                                                                                       | All 32 layers pass against an actual clean committed implementation checkpoint, including schema/types/coverage. |

The implementation retained the clean-source/checkpoint gate and passed all 32 layers on commit `e67b6e128dfcf7bf14c8a86fa7bfbfb8dba7cd1c`, run `5e3f2dde-4aef-44d8-906f-3f80f3e89dc2`. Actual commands, source fingerprint, witnesses, failure history and manual/hosted limits are recorded in the implementation evidence; these are fresh implementation results rather than copied historical checks.

### Manual verification

Review final diff, preservation proof, controls/restoration, snapshots, and manual acceptance limits. Exit: AC11 and all new/inherited gates pass; documentation explicitly retains future job/event integration dependencies.

## Risks and rollback considerations

- Separate creation/maintenance projections and receipt namespaces prevent breaking uncertain legacy saves. Historical replay is evidence of the old operation, not the current record; refresh before another edit.
- Credential version is aggregate freshness; date revision is scheduling freshness. Incrementing only one inconsistently can lose edits or let obsolete jobs appear current. Archive uses its own persisted state plus aggregate version.
- Coverage FK ordering, no-op detection, archive races, and transactional audit/receipt writes need real concurrency/fault witnesses. Do not broaden authenticated DML grants as a workaround.
- Duplicate matching is intentionally conservative and advisory. Missing identifiers mean it cannot guarantee identity or detect spelling variations. No database unique key should encode this suspicion.
- Archive is intentionally one-way through this UI slice. Confirmation and retained data provide protection; unarchive is a future explicit product change. No destructive down migration or deletion-based rollback.
- Migration-first rollout for a later separately requested release. Verify original rows/receipts/cycles, empty new receipts, NULL archive values, schema/grants, then promote the app. Application rollback to E2-S2 retains the additive schema and active-filtered legacy list; archived data stays retained and hidden, though the older app cannot browse it. Prefer forward repair.
- E3/E4 must implement/test actual event exclusion, outbox replacement/cancellation, and accepted-message rules. This release has no SMS jobs to cancel and must retain the visible inactive-SMS statement.
- Official Supabase topic docs were checked; changelog Markdown fetch failed. Recheck relevant breaking changes and CLI help at implementation time.

## Completion criteria

AC1–AC12 have executable witnesses, each phase passes its exit criteria, all 32 implementation gates pass, the diff is reviewed, and source-bound evidence/manual limits are recorded. Existing records can be corrected or archived, suspected duplicates are reviewable, and immutable history survives. E3-S1 is the next MVP slice; original event/job acceptance remains tracked until E3/E4 implement it.

## Implementation progress

- [x] Phase 1: Database maintenance contracts.
- [x] Phase 2: Domain validation and server actions.
- [x] Phase 3: Editing, archive confirmation, and review UI.
- [x] Phase 4: Upgrade, fault controls, and final evidence.
- [ ] User-confirmed manual acceptance, separate from automated/agent verification.
