# Verification Summary

Date: 2026-10-05
Plan: `thoughts/shared/plans/2026-10-05-e1-s3-responsible-reminder-recipient.md`.
Baseline: `aeedf1cff3aba58218046483955a05b506c0b90c`.
Overall readiness: **Ready for the proposed assignment foundation under its stated product defaults.** Full original E1-S3 scheduling acceptance remains dependent on the explicitly documented E2/E4 integration gate.

This is plan review and baseline checking, not verification of implemented recipient behavior. Only the new plan, research, and verification Markdown artifacts changed.

## Findings

### Major: manager selection must not broaden team administration — resolved

Location: Permission matrix; Storage and lifecycle; Application and recovery.

`private.list_practice_team` returns a complete administrator-only roster/invitation projection. The plan adds separate recipient RPCs and an administrator/manager editor helper, leaving `private.require_administrator`, profile edits, and team management permissions intact. Viewers read the selected minimal recipient but receive no candidate roster.

### Major: original scheduling acceptance has unavailable prerequisites — explicitly retained

Location: Overview; Mandatory E2/E4 Integration Gate; Completion Criteria.

No phone enrollment, credential cycles, or jobs exist. Assignment alone cannot demonstrate rule 9 or SMS readiness. The plan requires readiness false for this foundation and specifies cancellation/catch-up/enrollment/dispatch integration witnesses. It explicitly leaves original-story scheduling acceptance open until those pass.

### Major: access invalidation must retain the established lock order — resolved

Location: Storage and lifecycle; Phase 1.

Existing access writes lock practice before membership. The plan extends `private.mutate_member` with a private invalidation helper under that lock, then locks settings. Assignment reads candidate eligibility after its practice lock without acquiring a reverse membership lock. Selected revoked/viewer memberships clear atomically and do not restore on rejoin. Tests require observed real-session waiting, current authority after the wait, and audit-failure rollback of access and assignment together.

### Major: rollback catalog-only checks miss replacement functions — resolved

Location: Phase 4 upgrade rehearsal.

The existing upgrade tool's pg_class comparison would miss altered definitions of `private.create_practice` and `private.mutate_member`. The new E1-S2-to-E1-S3 rehearsal snapshots all historical application data and full schema fingerprints, including function definitions/ACLs, and compares both after deliberate rollback before actual upgrade/replay.

### Minor: initialization and audit shapes require exact contracts — resolved

Location: Storage and lifecycle; Phase 1 verification.

The revised plan specifies event-shape and version-transition CHECKs, direct settings-insert failure during practice creation, and absent-settings integrity failures during reads/writes/invalidation. Initialization creates no fictional assignment event. A target mismatch cannot hide missing settings.

### Minor: malformed read projections can contradict readiness/permissions — resolved

Location: Read projection; Phase 2.

Runtime schemas validate selection/readiness/editor/candidate coherence and distinguish an invalid stored membership from an eligible SMS-pending member. Strict action input separates assign from explicit clear, rejects duplicate/unknown fields, and never trusts posted authority/readiness.

### Minor: verification discovery does not cover every explicit inventory — resolved

Location: Phases 2 and 4.

Broad unit/integration/coverage/capability discovery already finds conventional new modules. Property mutation lists, SQL control suites/TAP counts, schema contract, public generated RPC types, and required gauntlet layers need explicit updates. A new upgrade layer brings the total to 29; README's literal layer count is included. Existing generic checker inventory controls remain applicable.

## Missing Work

No blocking omission remains in the planned foundation. Every phase is future implementation. The original cancellation/catch-up acceptance is future E2/E4 integration, not silently removed from completion criteria.

## Risks

- Manager editing, eligible roles, minimal email visibility, and explicit clear are proposed product defaults, not user-confirmed choices.
- Two shared private function bodies change; preserve signatures, grants, retry/final-admin semantics, and exact old mutation fault applicability.
- Audit failure intentionally prevents member invalidation from committing; witness complete rollback and retry recovery.
- Privileged repair SQL must follow the prescribed lifecycle/locking protocol; it is outside ordinary client DML authority.
- Old-application/new-database compatibility is proposed until the local upgrade rehearsal verifies it.

## Suggested Changes

The concrete initialization, event-coherence, runtime-projection, absent-settings, rollback-fingerprint, and inventory refinements above were incorporated. Preserve existing regression assertions and assurance thresholds during implementation.

## Final Recommendation

Approve implementation of the assignment foundation using the documented defaults. Keep original rule-9 acceptance open through E2/E4. No application implementation, database migration, or release was performed in this planning turn.

The parent read the plan and relevant source/documents. A delegated read-only discovery pass inspected migrations, SQL/control/upgrade contracts, then reviewed the complete draft against those facts. The parent incorporated and checked the refinements. This is a planning review, not an independent implementation audit.

## Commands and Results

Commands ran from `/Users/macbookpro/Coding/license-radar`; application checks used `PATH="$PWD/.tools/node/bin:$PATH"` and Node 24.21.0.

| Command                                                            | Result                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `git status --short`, `git log -5 --oneline`, `git rev-parse HEAD` | Initially clean; baseline `aeedf1cff3aba58218046483955a05b506c0b90c`        |
| `rg --files`, targeted `rg -n`, complete reads                     | Next story and implementation/test/tooling facts inspected                  |
| `npm run lint`                                                     | Passed, exit 0                                                              |
| `npm run typecheck`                                                | Passed, exit 0                                                              |
| `npm test`                                                         | Passed, exit 0; 158 tests in 18 files; seed 20261003                        |
| `npm run format:check`                                             | Passed, exit 0; repository-matched files use Prettier style                 |
| Prettier with `--ignore-path /dev/null` on the three new artifacts | Formatted and explicitly checked because the repository ignores `thoughts/` |
| `git diff --check` and complete artifact review                    | No whitespace errors; documentation-only scope                              |

No new feature tests can run before implementation. Database resets, integration/browser/mutation tests, the full gauntlet, production probes, and manual product acceptance were not performed. Earlier E1-S2 evidence is historical evidence for its own source.
