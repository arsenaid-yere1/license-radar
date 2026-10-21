# Insurance Payer Provider Directory Renewal Type Implementation Plan

Date: 2026-10-21 (America/Los_Angeles).
Status: all three implementation phases and all 48 required automated verification layers complete locally on 2026-10-21. Human acceptance and hosted deployment remain separate.
Research: `thoughts/shared/research/2026-10-21-insurance-payer-provider-directory-renewal-type.md`.
Plan verification: `thoughts/shared/plans/2026-10-21-insurance-payer-provider-directory-renewal-type-verification.md`.
Baseline: HEAD `cca99a7` plus the inspected working tree, including PCI, external record numbers, successor cycles, evidence, Gmail, and scheduler work. Preserve unrelated changes. The subsequent request authorizes implementation and required local checks. Deployment remains outside scope.

## Overview

Add **Insurance payer provider directory** as a fifth renewal record type. Staff can record one payer obligation for the practice or one clinician, enter its next directory update due date, track an optional earlier action deadline, and record completion with a new future due date. Reuse the existing register, calendar, dashboard, renewal cycles, portal link, reminders, and evidence.

This is manual recordkeeping. Saving a record or recording completion does not update a payer directory or independently verify an attestation.

## Current State

The repository contains one Next.js application. Register contracts and persistence adapters live in `src/lib/register/`; forms in `src/components/register/`; authenticated pages/actions in `src/app/practice/register/`. Renewal, evidence, and reminder domains compose these contracts. PostgreSQL owns transactional authorization, tenancy, revisions, audits, and retry receipts. These are code responsibilities, not separate applications or named team assignments.

- `src/lib/register/types.ts:3` accepts four values and defines `typeLabels`. `src/lib/register/schema.ts:38` reuses that type schema for creation, maintenance, and saved projections. Only PCI is practice-owned only; multiple covered clinicians are exclusive to practice malpractice policies.
- `src/lib/renewals/history.ts:5` imports the same type schema; completion replies and evidence pages embed cycle validation through `src/lib/renewals/schema.ts` and `src/lib/evidence/schema.ts`. A fifth value therefore reaches these parsers through the existing shared leaf dependency.
- `src/lib/register/dates.ts:42` and `src/lib/register/numbers.ts:6` exhaustively map types to field labels. `CredentialFields` builds its selector from `typeLabels` (`src/components/register/credential-fields.tsx:76`).
- The latest type CHECK and three SQL whitelist definitions are in `supabase/migrations/20261020210728_pci_compliance_certificate_records.sql:2`, `:30`, `:90`, and `:178`. Number-aware APIs call the shared validator from `supabase/migrations/20261016221310_credential_record_numbers.sql:166`, `:226`.
- Both dates can be unknown at creation/edit; an action deadline must precede the end date when both exist. Completion requires an explicit end date after today in practice time and an optional future earlier action deadline (`src/lib/renewals/schema.ts:45`; `supabase/migrations/20261013172507_credential_renewal_completion.sql:331`).
- Tracking/calendar purpose, history, and evidence currently call every non-malpractice end date an expiration. Dashboard missing-date copy also mentions only expiration/coverage. These must accommodate directory due dates without changing old-type date meanings.
- Reminder schedule rows have generic `action-deadline`/`end-date` purposes and no credential type (`src/lib/reminders/schema.ts:19`). A directory-specific database purpose or new schedule payload is unnecessary for this scope.
- The verification inventory currently has **47** layers. The PCI populated upgrade runner is the closest pattern for a new additive type (`tools/pci-certificates-upgrade.mjs`).

## Desired End State

### Product decisions and their resolution

| Decision                             | User-confirmed choice                                                                   | Implementation consequence                                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1: ownership and record granularity | Practice or one clinician; one record per payer obligation                              | Reuse both ordinary ownership paths and same-practice clinician checks. No directory covered-clinician list or multi-provider relationship.                                                         |
| D2: date meaning and completion      | Staff-entered next directory update due date; completion requires a new future due date | Store the date in existing `endDate` / `end_date`; label it as a directory due date. Retain strict earlier-deadline ordering and practice-timezone future-date validation. No automatic recurrence. |
| D3: first-version scope and data     | Manual tracking using existing fields, portal link, and evidence                        | No payer integration, new identifier tables, locations model, structured NPI validation, or new completion API.                                                                                     |

No material product decision remains open for this scope. If multi-provider coverage, inferred recurrence, completion without a next date, or portal integration is requested later, revise this plan before implementation; each changes the agreed contract.

The following are reviewable implementation defaults, not unconfirmed prerequisites:

| Item                         | Planned behavior                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stored type                  | `insurance_payer_provider_directory`                                                                                                                                                                   |
| Visible type                 | **Insurance payer provider directory**                                                                                                                                                                 |
| Title                        | Existing required **Record title**; staff distinguish payer/plan obligations here                                                                                                                      |
| Payer                        | Existing optional `issuer`, labeled **Payer name**; retain existing 120-code-point normalization and optionality                                                                                       |
| Reference                    | Existing optional `recordNumber`, labeled **Directory / provider reference**; preserve leading zeros, case, punctuation, and existing control-character limits                                         |
| Jurisdiction                 | Existing optional **Jurisdiction**; no location relationship is implied                                                                                                                                |
| Due date                     | Existing optional `endDate`, labeled **Next directory update due date** at creation/edit                                                                                                               |
| Earlier action date          | Existing optional **Earlier action deadline**, before the next update due date when both are entered                                                                                                   |
| Tracking purpose             | **directory update due** when the due date drives tracking; existing **earlier action deadline** otherwise                                                                                             |
| Completion                   | Existing generic renewal controls remain; directory-specific explanation says staff have confirmed the directory update and must enter its next due date. No external verification is claimed.         |
| Unknown dates                | Remain unknown; action-only records track the action date and still appear in the missing-primary-date group                                                                                           |
| Missing-date dashboard group | Rename visible heading to **Missing renewal date** and explain expiration, coverage end, or next directory update due date. Preserve internal `missingEnd` key, anchors, counts, and overlap behavior. |
| Reminder schedule            | Preserve purpose values; display **Current due date** for `end-date`, retaining **Current action deadline** for `action-deadline`. Describe the applicable saved due date in introductory copy.        |
| Notifications                | Reuse current sixty-day/catch-up behavior and current recipient/preferences; this feature activates no provider, scheduler, or feature flag                                                            |
| Duplicates                   | Existing advisory matching; similar legitimate obligations remain allowed                                                                                                                              |
| Evidence                     | Existing optional cycle attachments when configured; no upload prerequisite and no extraction/attestation logic                                                                                        |
| Permissions                  | Administrators/managers write; all current practice members read; viewer, revoked-access, and cross-practice restrictions remain                                                                       |

### Acceptance criteria

| ID    | Required behavior                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DIR01 | Fifth type appears in add/edit and calendar filtering. Mixed-type register, detail, dashboard, archive, history, completion replies, and evidence read successfully. Unknown/near-match types remain rejected.                                                                                                                                                          |
| DIR02 | Practice and clinician ownership work through all three creation API generations and both edit generations. Missing, foreign, or incoherent owner IDs fail; directory coverage lists fail. PCI remains practice-only and original ownership/coverage behavior remains intact.                                                                                           |
| DIR03 | Metadata uses existing normalization and limits. Staff-entered next update due date and optional earlier action deadline support unknown/action-only dates. Calendar days do not shift with browser timezone; no cadence is inferred.                                                                                                                                   |
| DIR04 | Directory labels and date purposes are correct across form, saved record, conflicts, dashboard, calendar/agenda, current/history cycles, and evidence. Directory records are not labeled expired certificates/licenses. Existing four-type labels/purposes remain unchanged except deliberately inclusive aggregate/dashboard and generic reminder wording.             |
| DIR05 | Type change confirmation clears draft number, payer, jurisdiction, dates, and coverage; cancel preserves them. Ordinary owner changes preserve detail fields while clearing incompatible owner/coverage selections. Directory-to-PCI still enforces the existing confirmed practice-owner transition.                                                                   |
| DIR06 | Create/edit/archive retain atomic audit and receipt behavior, exact retries, changed-payload conflicts, no-ops, stale comparison/reload, same-practice isolation, and current authority checks including revocation/demotion. Similar records remain allowed.                                                                                                           |
| DIR07 | Confirmed completion requires an explicit new future directory due date and, when supplied, a future strictly earlier action deadline. Concurrent requests create one successor, retaining metadata, previous dates/progress/evidence and historical type snapshots. No external payer action is performed.                                                             |
| DIR08 | Current/historical evidence follows existing permissions, quotas, download/removal, archive, and disabled-storage rules. Uploading evidence does not change completion or dates.                                                                                                                                                                                        |
| DIR09 | Reminders use earlier action deadline first, otherwise directory due date; wholly undated items have no eligible sends and may retain blocked `missing-date` rows. Date correction/archive/completion invalidate stale jobs; metadata-only edits preserve scheduling and consumed permissions. Payloads continue excluding record/reference and payer/provider details. |
| DIR10 | Additive populated upgrade preserves existing rows, Auth state, immutable audits/receipts, cycles, attempts, evidence, grants, and existing payload contracts; creates no directory rows/jobs itself; historical replay and fresh/upgrade catalogs agree. All registered verification layers remain enforced.                                                           |

## Key Discoveries

1. A selector change alone fails: the type CHECK, legacy original/detailed create validators, and shared current create/edit validator all reject an unknown value today.
2. The proposed ownership needs no new ownership model or PCI-style constraint. Existing non-PCI ownership and malpractice-only coverage rules already describe it once the type is allowed.
3. Shared type composition already reaches history/evidence; date presentation does not. Four independent expiration/coverage branches exist in tracking, calendar events, cycle history, and evidence headings.
4. Reusing the stored `end_date` does not require changing SQL scheduling purpose, request keys, RPC signatures, or canonical error literals. UI wording can explain the approved directory meaning while keeping historical receipt contracts intact.
5. Historical completed-cycle type comes from its completion snapshot when present; otherwise current credential type is used (`private.renewal_cycle_history`, completion migration `:312`). Use the cycle's projected type for history/evidence labels, not the current record's type.
6. Six historical upgrade tools seed schemas before this feature and need a new integration-file exclusion, including the PCI runner itself. The final fully migrated suite must still execute the new acceptance tests.

## What We Are Not Doing

Payer portal automation, external directory synchronization, legal/payer cadence determination, automatic quarterly/annual dates, multiple providers/locations attached to one obligation, structured NPI/tax/payer ID validation, a payer catalog, generalized custom renewal types, new notification intervals, reminder transport/template changes, evidence storage/quota changes, provider activation, deployment, or commits.

## Implementation Approach

Implement the confirmed scope as a fifth shared type plus an additive SQL migration. Reuse all existing API payloads, concurrency tokens, ownership, lifecycle, and scheduling mechanisms. Keep directory-specific presentation at the record/cycle boundary; use generic due-date wording where a projection intentionally lacks type information.

Before implementing, recheck the working-tree baseline and current definitions. Follow the Supabase skill's documentation/version and local migration workflow using the pinned CLI; discover supported commands with `--help`, generate the new migration name with the CLI rather than inventing a timestamp, and verify the resulting migration through guarded fresh and populated replay. This plan creates no migration or schema changes.

## Phase 1: Persistent type support and API compatibility

### Files and changes

1. Generate a new migration named for insurance payer provider directory records, after `20261020210728`. Widen only `credentials_type_check` and the three current private whitelist definitions shown by the PCI migration. Preserve PCI's ownership CHECK, same-practice constraints, policy coverage rules, signatures, grants, canonical payload versions, result shapes, and original type behavior. Do not edit historical migrations.
2. Retain current number-aware and latest-cycle projection helpers from the number/completion migrations. Do not copy obsolete cycle-1-only implementations. No new column, table, public RPC, enum, or request field is needed under D1–D3.
3. Add proposed `supabase/tests/practice_payer_directories.test.sql`: fifth-type persistence and raw shared validation, practice and clinician ownership, owner coherence, unknown types, illegal coverage, private helper/direct write denials, and all existing types/PCI restrictions.
4. Add proposed `tests/integration/practice-payer-directories.test.ts`, following PCI's fixture and API-generation patterns. Exercise original/detailed/number-aware create plus legacy/number-aware edit, foreign clinicians, viewer/anonymous/cross-practice denials, revoked/demoted requests, exact request replay, changed-payload/stale conflicts, no-op and explicit number clearing, legacy omission semantics, duplicates, audit/receipt failure rollback, and archive.
5. Add directory equivalents of the relevant type-gate faults in `tools/sql-mutants.mjs`; test actual accepted/rejected combinations. Do not add a directory practice-only fault because D1 deliberately permits clinician ownership.
6. Regenerate `tools/schema-contract.json` from the replayed fixture and inspect its delta: type CHECK and three intended private function bodies only. Run generated-type drift validation; `credentials.type` is currently generated as `string`, so do not hand-write a new generated union.

### Automated verification

Use Node 24.21.0 throughout all phase commands (`export PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH"`). Database commands require the guarded dedicated local stack; reset deletes fixture data.

```sh
npm run db:reset
npm run test:db
npm run test:integration -- tests/integration/practice-payer-directories.test.ts
node tools/schema-fingerprint.mjs record
node tools/schema-fingerprint.mjs
node tools/check-generated-types.mjs
```

Exit criteria: DIR02/DIR06 persistence cases pass; new and old API contracts are compatible; catalog delta contains only intended changes. Tests that require application parsing/rendering are completed in Phase 2.

### Manual verification

Review the migration against the latest source definitions and catalog diff. Check that no Auth, evidence, notification state, payload-version, or privilege change is included. No hosted query or migration is part of this phase.

## Phase 2: Shared type, forms, date wording, and workload views

### Files and changes

1. Extend `src/lib/register/types.ts` with the approved fifth type and label; add its field labels to `src/lib/register/dates.ts` and `src/lib/register/numbers.ts`. Existing schema/history/evidence composition should pick it up without new parser branches or relaxed unknown-type validation.
2. Add small shared date-presentation helpers in `src/lib/register/dates.ts` (proposed `endDatePurpose` and `cycleEndLabel`). Preserve exact old purpose/short-label values; directory returns `directory update due` / `Next directory update due`. Keep existing string/fallback behavior for `trackingDate` callers. Use the purpose helper in `trackingDate` and `src/lib/calendar/events.ts`, and the cycle-label helper in `src/app/practice/register/[credentialId]/history/page.tsx` and `src/components/evidence/panel.tsx` with their cycle type. Do not introduce a general renewal-type configuration framework.
3. In `src/components/register/credential-fields.tsx`, add directory-specific date guidance and the new labels; use the existing ordinary owner path. Preserve reset/confirmation behavior and malpractice-only coverage. `RecordDates` and `RecordNumber` already consume shared maps; verify them and conflict comparison through tests rather than rewriting them unnecessarily.
4. In `src/components/renewals/completion-fields.tsx`, label the new field **New directory update due date**, explain confirmation of the completed update, and retain checkbox/next-cycle requirements. Keep generic surrounding renewal controls and response messages. Translate only recognized canonical `end date`/ordering validation errors for directory display; the source SQL/result-schema literals remain unchanged. Apply the same display translation to relevant register date errors. Do not change submitted values or frozen retry payloads.
5. Update missing-date heading/hint/empty copy in `src/components/dashboard/dashboard-panel.tsx` to include directory due dates. Keep `missingEnd`, stable DOM anchors, date-group calculations, and count overlap unchanged.
6. Update `src/app/practice/reminders/page.tsx` to use generic **Current due date** for `end-date` rows and introductory due-date wording that includes directory obligations. Retain action-deadline wording, original/frozen schedules, transport messages, SQL purposes, and schedule contracts. Reminder delivery history already uses generic due-date wording.
7. Extend `src/lib/register/properties.test.ts` create/update ownership matrices and exact labels, and `src/lib/register/dates.test.ts` all-type loops, exact maps, and independent purpose oracle. Extend `src/lib/calendar/properties.test.ts` and `src/lib/dashboard/properties.test.ts` type generators and independent purpose expectations; do not derive expected behavior solely from production maps.
8. Add proposed `src/lib/register/payer-directory.test.ts` for mixed-register parsing/API arguments, ownership/coverage rejection, shared cycle/history/completion/evidence parsing, dates, filters and urgency. Register it in the explicit include list in `vitest.properties.config.ts`. Existing Stryker configs already target types/dates/numbers/calendar contracts; retain them and add any new production module to both appropriate inventories if introduced.
9. Add proposed `tests/unit/payer-directory-forms.test.tsx`, following `tests/unit/pci-record-forms.test.tsx`. Cover practice/clinician ownership, field labels/errors, reset/cancel, owner preservation, directory↔PCI transitions, explicit clear, conflict comparison and exact retry. Add directory cases to `tests/unit/calendar-views.test.tsx`, `tests/unit/dashboard-views.test.tsx`, `tests/unit/renewal-history-routes.test.tsx`, and `tests/unit/evidence-routes.test.tsx`. Update the intentional generic-copy assertion in `tests/unit/reminder-routes.test.tsx`. Preserve existing old-type assertions, including PCI completion expiration and historical evidence expiration labels.

### Automated verification

```sh
npm test -- src/lib/register/properties.test.ts src/lib/register/dates.test.ts src/lib/register/numbers.test.ts src/lib/register/pci.test.ts src/lib/register/payer-directory.test.ts src/lib/renewals/history.test.ts src/lib/calendar/query.test.ts src/lib/calendar/properties.test.ts src/lib/dashboard/properties.test.ts tests/unit/payer-directory-forms.test.tsx tests/unit/pci-record-forms.test.tsx tests/unit/register-number-forms.test.tsx tests/unit/calendar-views.test.tsx tests/unit/dashboard-views.test.tsx tests/unit/renewal-history-routes.test.tsx tests/unit/evidence-routes.test.tsx tests/unit/reminder-routes.test.tsx
npm run typecheck
npm run lint
npm run format:check
```

Exit criteria: DIR01/DIR03–DIR05 application cases pass. Check known, both-unknown, action-only, earlier-deadline precedence, due today, 60-day boundary, overdue, future, archived, and retained-cycle contexts. No directory date is described as an expiration; four existing type semantics still pass independent expectations.

### Manual verification

At 375px and 1440px, inspect create/edit, a practice and clinician record, unknown/action-only dates, long payer/reference values, register/detail/calendar/agenda/dashboard, completion, history, evidence-disabled display, archive, and viewer read-only controls. Verify keyboard labels, error focus, wrapping, and type-change confirmation. Record agent visual inspection separately from human acceptance.

## Phase 3: Lifecycle, populated upgrade, and complete verification

### Files and changes

1. Complete new integration cases for future-date completion, concurrent one-successor behavior, historical completion-type snapshots after later type correction, current/historical evidence and archive restrictions, metadata retention, and normal/catch-up reminder eligibility. Reject missing, malformed, past, and practice-local-today next due dates; reject past/today, equal, or later action deadlines; accept valid future dates. Blank successor action deadline must clear the previous deadline. Assert action deadline priority, blocked missing-date rows, correction/archive/completion invalidation, metadata-only scheduling stability, retained consumed permission, and unchanged privacy of outgoing payloads. Cover existing configured local provider paths without enabling hosted sending.
2. Add proposed `tests/e2e/practice-payer-directories.spec.ts` following the PCI browser fixture pattern. Exercise real creation with both ownership modes, unknown and supplied dates, edit/reset/conflict/retry, type filtering and cross-view labels, confirmed completion with new future date, historical evidence readback, archive, and viewer denial. Include mobile/desktop accessibility and layout checks and a synthetic supported evidence file; no real payer account is needed.
3. Add proposed `tools/payer-directories-upgrade.mjs`, based on `tools/pci-certificates-upgrade.mjs`, using pre-feature baseline `20261020210728`. Seed existing populated integration fixtures with only the new directory suite excluded. Require nonempty historical credentials/cycles/receipts/completions/reminders/Auth samples; snapshot original application/private rows, Auth users/identities, and Storage objects. Rehearse intentional migration failure/transaction rollback and full catalog equality, then upgrade and require original snapshots unchanged with zero new directory records/jobs.
4. Replay immutable receipts by their actual generation: clinician create, original credential create, version-2 detailed create, version-3 numbered create, legacy update, nested version-3 update, and archive. Require exact saved results and unchanged original state; retain current authority checks. Then separately exercise fifth-type lifecycle and mixed reads, including completion/history/evidence and legacy number preservation. Take new baselines for deliberate lifecycle mutations; do not compare intentional new records against pre-migration equality. Compare upgraded and fresh catalogs after a guarded fresh reset. Save source-linked `reports/payer-directories-upgrade.json`.
5. Add the new integration exclusion only to old-schema fixture seeding in six runners: `tools/renewal-workflow-upgrade.mjs`, `tools/renewal-completion-upgrade.mjs`, `tools/renewal-evidence-upgrade.mjs`, `tools/gmail-reminders-upgrade.mjs`, `tools/credential-numbers-upgrade.mjs`, and **`tools/pci-certificates-upgrade.mjs`**. Run directory acceptance on the fully migrated database; never exclude it globally.
6. Register `payer-directories-upgrade` in `tools/layers.json`, `tools/gauntlet.mjs:requiredLayers`, and `tools/verify-workspace.mjs:requiredWorkspaceLayers`. Update `tools/gauntlet-controls.test.mjs` exact count from 47 to 48. Add proposed `tools/payer-directory-controls.mjs`, following `tools/pci-controls.mjs`, and wire it into both runners and `tools/check-capabilities.mjs`. Add control tests for missing/duplicate/changed commands and omitted required mutation targets. Keep every existing layer, threshold, and control.
7. Update `README.md` with fields, ownership, staff-entered date meaning, explicit next-date completion, conditional evidence, notification reuse, and rollout limits. Save source-identified implementation evidence and a handoff under `thoughts/shared/research/` and `thoughts/shared/handoffs/`. Reconcile statuses against actual results rather than treating this plan's future commands as evidence.

### Automated verification

```sh
npm run test:db
npm run test:integration
npm test
npm run build
npm run test:e2e -- tests/e2e/practice-payer-directories.spec.ts
npm run test:controls
node tools/check-capabilities.mjs
node tools/payer-directories-upgrade.mjs
node tools/schema-fingerprint.mjs
node tools/check-generated-types.mjs
npm run typecheck
npm run lint
npm run format:check
node tools/verify-workspace.mjs
```

The complete source-identified workspace run must pass all **48** registered layers, including all affected historical upgrades, unit/SQL/integration/browser suites, shuffled browser runs, coverage, production/property mutation, SQL fault controls, dependencies, and secret checks. Run against one identified final candidate; any source change invalidating earlier evidence requires the relevant rerun. The clean-commit gauntlet is a distinct claim and does not apply to an uncommitted workspace.

Exit criteria: DIR01–DIR10 have evidence tied to final source; upgrade and legacy replay preserve original state; all existing types and all 48 layers pass without weaker gates. Infrastructure or inherited failures must be recorded with reproductions and remain unresolved until actually fixed within authorized scope.

### Manual verification

Review the complete scoped diff and catalog delta. Inspect mobile/desktop screenshots and the full synthetic directory lifecycle, including retained-cycle wording after record-type changes. Report local automated checks, agent visual checks, human acceptance, hosted deployment, and actual inbox delivery separately. Hosted actions remain a later explicitly requested release task.

## Risks and rollback considerations

- **Reader compatibility:** apply the additive migration before the matching app. The migration does not seed directory rows, but authorized direct API callers can create them once allowed; this is not a strict staged write gate. Once any fifth-type row exists, retain fifth-type-capable register/history/evidence readers during rollback. Archiving does not make old parsers compatible. Prefer a forward fix or compatible build that disables new directory creation/conversion while preserving reads and retained history.
- **Existing data and retries:** keep canonical payload versions, immutable results/audits, current-cycle helpers, and consumed notification permissions. Do not coerce directory records into another type or delete history to support an older build.
- **Date meaning:** `end_date` is internal storage; the product meaning is the next directory update due date. Keep record/cycle labels and error presentation consistent without changing SQL scheduling purpose or leaking internal field names into user guidance. No automatic interval is inferred from date arithmetic or evidence.
- **Type corrections:** completed cycles use completion snapshots for type labels. Current/incomplete history may reflect the current record type. Preserve existing behavior and test it explicitly; do not add an immutable per-cycle payer model implicitly.
- **Upgrade tools:** new tests fail intentionally old schemas unless excluded only during seeding. Include PCI's upgrade runner; require positive post-upgrade acceptance so exclusions cannot hide the feature.
- **Workspace/deployment drift:** prior uncommitted features are prerequisites. Recheck migrations/source before implementation and release; no hosted state was inspected during planning. Keep all unrelated work intact.

## Completion criteria

- [x] Research and important current-source/test patterns inspected.
- [x] Product decisions D1–D3 confirmed and recorded; no unresolved material decision for the agreed scope.
- [x] Companion plan verification completed: Ready; no blocking findings or missing work identified.
- [x] Phase 1 persistent type support, authority, transaction/retry, and old-API compatibility pass.
- [x] Phase 2 shared contracts, ownership/forms, dates, and all display contexts pass.
- [x] Phase 3 lifecycle, populated/historical upgrades, and all 48 registered automated layers pass on final identified source.
- [x] Scoped diff, documentation, evidence, and handoff reflect actual implementation.
- [ ] Agent visual inspection and any human/hosted acceptance are reported separately and accurately.

## Planning verification record

This document is a plan, not implementation evidence. During planning, the following existing-behavior check ran with pinned Node 24.21.0:

```sh
PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH" npm test -- src/lib/register/properties.test.ts src/lib/register/dates.test.ts src/lib/register/numbers.test.ts src/lib/register/pci.test.ts src/lib/renewals/history.test.ts src/lib/calendar/query.test.ts src/lib/calendar/properties.test.ts src/lib/dashboard/properties.test.ts tests/unit/pci-record-forms.test.tsx tests/unit/register-number-forms.test.tsx
```

Result: **10 files, 53 tests passed**. A read-only verification-inventory assertion also confirmed all 47 current layers are registered consistently. No schema reset, migration, feature implementation, integration/browser acceptance, or hosted changes occurred during planning.

The independent plan review verified the migration/type/ownership/date/lifecycle paths, four date-presentation sites, six old-schema fixture exclusions, and verification registration. It found the plan Ready under the user-confirmed scope. Document formatting and scoped diff review are recorded in the companion verification note.

## Implementation progress

Phase 1: generated additive migration `20261021210414_insurance_payer_provider_directory_records.sql`; local fresh replay, 291 SQL assertions, 13 directory integration tests, schema contract and generated-type checks passed. Phase 2: 93 tests across 17 focused unit suites, typecheck, lint and formatting passed. The initial exact number-label expectation needed the fifth label; the subsequent focused run passed. Phase 3 subsequently passed all 48 source-bound layers. The first attempt was interrupted by host sleep during two pre-existing fixture tests; the complete failed layer and remaining layers passed on unchanged-source continuation with idle sleep prevented and all limits unchanged.

## Final implementation outcome

All 48 required layers passed on source `380eaebe0e632e9152ae0a8ba31f91fd55900168c9872b82643710d3023487a9`: 691 unit tests, 301 integration tests, 291 SQL assertions, 79 full and 79 shuffled browser cases, both mutation scores 100%, and 147 SQL/API faults killed and restored. Full counts, source manifest, initial failure, diagnostic, power events, and final run are retained under research. See `thoughts/shared/research/2026-10-21-directory-implementation-evidence.md`. No hosted deployment or clean-commit gauntlet result is claimed. Human manual acceptance remains unconfirmed.
