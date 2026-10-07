# E2-S3 Verification Summary

Date: 2026-10-06 (America/Los_Angeles).
Baseline: `27b728b4578a96d526e7fd25cf8f385284856e3c`.
Plan: `thoughts/shared/plans/2026-10-06-e2-s3-register-maintenance.md`.
Overall readiness: **Ready** for the defined register-maintenance slice.

## Review scope

Reviewed the complete plan against current register schemas, domain operations, repository/action/page boundaries, create forms and list merge, ownership/date migrations, generated public types, register unit/property tests, date SQL/API/browser tests, upgrade tooling, schema catalog/contract, fault controls, mutation configurations, and both gauntlet inventories. This is a static/manual plan review by the planning agent, supplemented by the automated existing-behavior checks below; no independent reviewer agent was used.

The backlog and current README identify E2-S3 next. The production-release handoff confirms E2-S2 delivery historically; current hosted state was not reprobed. The plan's archive/revision foundation is implementable now. The original calendar-event and unsent-job acceptance criteria remain explicit dependencies of E3/E4, not completed behavior or new tests claimed here.

## Findings

### Major — coverage discriminator edits need ordered transactional replacement

Location: Implementation Approach; Phase 1.
Evidence: `supabase/migrations/20261006180010_register_ownership.sql:policy_coverage_credential_fkey` references credential type and owner kind with restrictive deletion. Updating those columns while old shared-policy links exist fails the FK.

Disposition: **Resolved in the plan.** Remove the old links before discriminator changes and insert the final validated coverage set within one transaction. Inject delete/insert/write/audit/receipt faults and prove all rows roll back.

### Major — existing saved-record merge cannot represent edits or archive

Location: Interface and domain boundary; Phase 3.
Evidence: `src/components/register/register-panel.tsx:merge` inserts only IDs absent from the current map. It does not replace older versions and has no archive tombstone.

Disposition: **Resolved in the plan.** Use highest-known credential version, persist successful archive tombstones until authoritative refresh catches up, and require a current read before starting another edit after historical receipt confirmation. Test stale replies/refresh and concurrent edit/archive.

### Major — historical creation results must remain replayable

Location: Persistence, authority, audit, and recovery; Phase 4.
Evidence: `private.register_replay` stores immutable original results; `credentialSchema` currently requires the detailed creation shape without archive/duplicate fields. Requiring new list fields in that same creation schema would break old results, and reconstructing replay from current rows would change the receipt contract.

Disposition: **Resolved in the plan.** Separate maintenance projections/schemas/receipts from unchanged create contracts; preserve original results after later edit/archive. Duplicate candidates belong to live list reads, not receipts. Legacy list keeps its projection/signature but filters active credentials, including during app rollback.

### Minor — conflict recovery and page-session limits needed concrete behavior

Location: Interface and domain boundary; AC4/AC10.
Full reload would discard a preserved draft; a request-key rotation followed by automatic resubmission could overwrite the winning edit. Browser-level navigation cannot be prevented by disabling in-form buttons.

Disposition: **Resolved in the plan.** Freshness conflict returns safe current values; preserve the blocked draft for comparison, then explicitly reload saved values and warn that the draft is replaced before reentry. Freeze in-form actions and view switching on uncertainty, but state that draft/request retention is limited to the current page session.

## Missing Work

No material omission remains for this slice. The plan covers proposed migration/RPC/storage changes, canonical payload/freshness contracts, no-op/revision semantics, archive/read visibility, duplicate matching, strict authority/error handling, UI recovery, actual SQL/API/browser concurrency and faults, populated upgrade preservation, and source-bound verification gates.

Deliberately remaining product work: E3 active-event exclusion, E4 real transactional unsent-job cancellation/replacement and accepted-message rules, E5 successor-cycle completion, and E7-S2 audit browsing. No reminder infrastructure exists in the inspected repository, so those original dependencies cannot be claimed as implemented by a planning document or fake queue.

## Risks

- Advisory duplicate matching lacks credential identifiers and fuzzy identity; false positives/negatives remain possible and must not block legitimate saves.
- Aggregate credential version, scheduling date revision, archive state, and historical replay serve different purposes. No-op and integer-exhaustion witnesses must test their exact boundaries.
- Existing audit CHECKs must be expanded explicitly while preserving all historical rows and creation semantics.
- Coverage replacement and audit/receipt transactions need real fault/concurrency execution; static review is insufficient evidence of runtime correctness.
- Migration-first rollout and retaining the additive schema on application rollback preserve data. Older UI can hide archives through the legacy active list but cannot browse them.
- Supabase topic documentation loaded; the changelog Markdown endpoint failed to fetch. Recheck applicable platform changes during implementation.

## Suggested Changes

All findings above are incorporated into the final plan. Keep separate creation/maintenance contracts, execute the planned fault controls, and retain the stated E3/E4 acceptance dependencies in final implementation evidence. New file names are proposals; the migration timestamp must come from the installed CLI during implementation.

## Checks run in this planning turn

| Command/check | Actual result |
| --- | --- |
| `git status --short`, `git rev-parse HEAD`, `git log -4 --oneline` | Clean starting tree; baseline and E2-S2 release sequence confirmed. |
| `rg --files`, complete relevant source/history reads, JSON catalog/inventory inspection | Referenced existing components verified; six public/seven private tables, nine schema sections, and 31 required layers confirmed. New receipt storage would make fourteen application tables; thirteen are historical preservation witnesses. |
| `npm test -- tests/unit/register-operations.test.ts tests/unit/register-actions.test.ts tests/unit/register-forms.test.tsx src/lib/register/properties.test.ts src/lib/register/dates.test.ts` | **5 files / 33 tests passed**, covering existing register behavior only. |
| `node --test --test-name-pattern='register public tables\|register fingerprint\|cycle trigger\|all required layers' tools/gauntlet-controls.test.mjs` | **4 tests passed**, including positive schema comparisons and real protection-removal checks. |
| `node node_modules/prettier/bin/prettier.cjs --check` on the three E2-S3 documents | All three passed formatting. |
| Plan file-reference inventory | Every referenced existing path located; proposed implementation additions identified separately; no unexpected missing files. |
| `git diff --check`, new-document content/whitespace review, and final `git status --short` | Passed; exactly three new research/planning documents, no tracked runtime changes. |

Existing checks ran on host Node **26.3.0**. The repository `.nvmrc` requires **24.21.0** for implementation verification; this turn's narrow baseline results are not a production/gauntlet result.

Only three research/planning documents are added. No runtime, dependency, migration, tool, or README change; no local database reset/write, commit, deployment, or new-story acceptance test. Application-wide lint/type/SQL/API/browser/mutation/gauntlet work is specified for implementation and was not run for this documentation-only task. Agent plan review is manual/static verification, not user acceptance.

## Final Recommendation

**Approve the plan for implementation of the defined slice.** No unresolved material decision remains. All implementation/acceptance checkboxes remain unchecked; the original job/event criteria remain dependent on E3/E4.
