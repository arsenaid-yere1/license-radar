# E2-S2 Verification Summary

Date: 2026-10-06 (America/Los_Angeles).
Baseline: `93f058bdd31f0a9cbbcdebb8b397a90c6708a478`.
Plan: `thoughts/shared/plans/2026-10-06-e2-s2-authoritative-dates.md`.
Overall readiness: **Ready**.

## Review scope

The complete plan was reread and checked against register schemas, repository/operations/actions, form recovery, list presentation, the E2-S1 migration, SQL/unit/API/browser tests, generated public types, schema catalog/contract, upgrade rehearsal, fault controls, mutation configurations, and gauntlet inventory. An independent read-only plan reviewer also found no remaining blocking or major findings after the control repair was included.

The backlog, README, and E2-S1 release record agree that E2-S2 is next. The plan is create-time date/metadata entry, with existing records unknown until E2-S3. Scope deliberately includes a minimal initial-cycle foundation; calendar, SMS, editing, and successor cycles remain deferred.

## Findings

### Major — schema protection-removal test can pass without comparing schemas

Location: Phase 4; `tools/gauntlet-controls.test.mjs:153`.

`assertSchema` is called but not imported. The ReferenceError text satisfies `/schema/i`, so the test passes without executing the real comparison. `tools/gauntlet-contract.mjs:assertSchema` exists and rejects mismatched catalog sections correctly.

Recommendation: import the function, add a positive identical-schema witness, and prove removal assertions use the comparator rather than a ReferenceError before extending the cycle controls.

Disposition: **Resolved in the plan** under Key Discoveries and Phase 4. Runtime code is unchanged; the implementation must carry out this repair. The existing isolated test passed, and a separate probe of the exported comparator accepted identical catalogs and rejected a removed credential policy. A passing existing control is not evidence that its missing import is harmless.

### Minor — legacy creation must not be called before detailed initialization

Location: RPC, compatibility, audit, and retry contracts.

The old create function writes its receipt and audit before returning. Calling it and then adding dates would preserve the wrong result snapshot and break the detailed-create retry contract.

Disposition: **Clarified in the plan**. Detailed creation validates the full new payload, inserts credential/coverage/cycle data, assigns initial dates, and calls the shared finish helper only with the final snapshot. All inherited ownership/reference/array checks remain required.

## Missing Work

No material planning omissions remain. The plan names affected existing files and proposed additions, acceptance witnesses, explicit product defaults, database grants/tenant references, migration compatibility, control restoration, and rollout/rollback requirements.

## Risks

- Preserve exact legacy receipt payloads/results and legacy create projection; only list/new-create use the details projection.
- A nullable column addition changes credential row shape; preservation must compare original columns and separately assert new NULL fields.
- Cycle backfill/trigger must establish one unknown initial cycle without fake business dates/audits. Missing cycles must fail safe reads.
- Year range, leap validity, strict earlier ordering, action-only entries, and timezone-independent display require actual implementation witnesses.
- New detailed-create and inherited upgrade/fault tools must pass together. A recorded 31-layer requirement is a future gate, not a current passing result.
- The Supabase changelog index was unavailable to the available fetch paths; official topic docs loaded. Recheck applicable platform changes during implementation.

## Suggested Changes

The two findings above are incorporated. No further prerequisite plan changes or user decisions are required. Maintain the original no-implementation boundary for this planning request.

## Checks run in this planning turn

| Command/check | Actual result |
| --- | --- |
| `git status --short`, `git rev-parse HEAD`, `git log -4 --oneline` | Clean starting tree; baseline/release sequence confirmed. |
| `rg --files` and targeted hidden-file inventory | Relevant source/history located; no local AGENTS file or existing graph found. |
| Complete plan/source reads and file-reference inventory | Existing references located; missing runtime paths are explicitly proposed additions. |
| JSON inspection of `tools/layers.json` and `tools/schema-contract.json` | 30 current layers, nine catalog sections, five listed public tables confirmed. |
| `node --test --test-name-pattern='register fingerprint contains' tools/gauntlet-controls.test.mjs` | One existing tooling test passed. The source still contains the missing-import false-positive described above. |
| Isolated Node probe importing `assertSchema` | Identical catalog accepted; removing the credential policy produced `Fresh schema drift from recorded contract`. No files/database changed. |
| `node node_modules/prettier/bin/prettier.cjs --check thoughts/shared/plans/2026-10-06-e2-s2-authoritative-dates.md thoughts/shared/plans/2026-10-06-e2-s2-authoritative-dates-verification.md thoughts/shared/research/2026-10-06-e2-s2-authoritative-dates.md` | All three final documents passed. |
| `git diff --check`; new-document whitespace/content review | Passed; changes are three planning/research documents only. |

Planning checks used the installed host Node 26.3.0. Implementation must use repository Node 24.21.0 for the gauntlet. No application formatting/lint/type/test suites, SQL/API/browser suites, migration/reset, commit, hosted mutation, or deployment ran; those are specified as implementation requirements. Source review and the independent reviewer are static/manual verification, not product acceptance. Official documentation links and fetch limitations are in the research record.

## Final Recommendation

**Approve the plan for implementation.** This is technical readiness, not a claim that implementation or user acceptance occurred. All implementation-phase and user-acceptance checkboxes remain unchecked.
