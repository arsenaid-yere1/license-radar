# Insurance payer provider directory implementation evidence

Date: 2026-10-21 (America/Los_Angeles).
Status: all three implementation phases and all 48 required source-bound verification layers passed locally. Human acceptance and hosted deployment are separate.
Plan: `thoughts/shared/plans/2026-10-21-insurance-payer-provider-directory-renewal-type.md`.
Baseline: existing working tree at HEAD `cca99a7`, preserved separately from this task's scoped patch.
Candidate: `380eaebe0e632e9152ae0a8ba31f91fd55900168c9872b82643710d3023487a9`, 431 source inputs, uncommitted workspace.

## Delivered behavior

- Added `insurance_payer_provider_directory`, visible as **Insurance payer provider directory**.
- Practice or one clinician owns each record. Existing ownership coherence, practice isolation, PCI practice-only ownership, and malpractice-only covered-clinician rules remain enforced.
- Reused optional payer name, directory/provider reference, jurisdiction, next directory update due date, earlier action deadline, renewal link, and configured cycle evidence. Unknown dates remain unknown; no recurrence is inferred.
- Completion requires a new future directory due date, retains the old cycle, and clears a previous action deadline when the successor deadline is blank.
- Added directory-specific form, tracking, calendar, history, evidence, and date-error wording. Dashboard missing-date wording and reminder schedule due-date wording now accommodate this type.
- Retained existing normal/catch-up scheduling, notification privacy, exact request retry, stale-edit comparison, audit, archive, and evidence behavior. No hosted provider, scheduler, storage flag, or deployment was activated.

## Implementation boundaries

`20261021210414_insurance_payer_provider_directory_records.sql` was generated with the pinned local Supabase CLI. The reviewed catalog delta contains exactly four definition changes: the credentials type CHECK and the original create, detailed create, and shared create/edit validator bodies. No column, table, public signature, grant, or policy was added or changed.

Shared types/labels and small date-presentation helpers extend the current register contracts. History and evidence use their projected cycle type, preserving completed-cycle snapshot semantics. Canonical SQL/result-schema error literals and schedule purpose values remain intact; directory errors are adapted only for presentation.

The new populated upgrade runner starts at the PCI baseline, snapshots prior application/Auth/Storage rows, tests migration rollback, replays all historical create/edit receipt generations under current authority, exercises the directory lifecycle, and compares upgraded/fresh catalogs. Six historical runners exclude the new integration suite only while seeding older schemas. A dedicated registered upgrade layer and omission/command/mutation controls increase the inventory from 47 to 48 layers.

## Verification performed during implementation

All commands use the pinned Node 24.21.0 runtime except where explicitly noted. Local database/browser commands use the guarded dedicated fixture.

| Check                                                       | Result before the full run                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:reset`                                          | Passed fresh replay including the additive migration                                                                                                    |
| `npm run test:db`                                           | Passed 291 SQL assertions; foreign-key controls passed                                                                                                  |
| Focused directory integration suite                         | Passed initially 13 cases, then 15 including date boundaries, retained type snapshots, and Gmail behavior                                               |
| `node tools/schema-fingerprint.mjs record` and verification | Passed; reviewed four-definition catalog delta                                                                                                          |
| `node tools/check-generated-types.mjs`                      | Passed with no generated type change                                                                                                                    |
| Planned focused unit selection                              | Passed 93 tests in 17 suites after updating the exact number-label expectation                                                                          |
| `npm run typecheck`, `npm run lint`, `npm run format:check` | Passed                                                                                                                                                  |
| `npm run test:controls`                                     | Passed 71 controls                                                                                                                                      |
| Targeted SQL lint                                           | Passed after formatting the new CHECK and pgTAP query                                                                                                   |
| `npm run build`                                             | Passed                                                                                                                                                  |
| Directory production-browser suite                          | Passed four cases covering retained evidence/completion/archive, type reset/conflict/clear, exact uncertain retry, and clinician/viewer/filter behavior |
| `npm run test:coverage`                                     | Passed 690 tests before the final evidence-disabled test addition; final counts belong to the complete run                                              |
| `node tools/payer-directories-upgrade.mjs`                  | Passed rollback, original-row preservation, all old receipt generations, compatible reads/updates, and fresh catalog equality                           |

The initial focused run failed one exact-label expectation in `numbers.test.ts`; it was extended to include the approved fifth label and then passed. Initial SQL lint identified layout issues in the new files; these were corrected without changing SQL semantics. These development iterations are separate from final-candidate verification.

## Complete verification

Command: `PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH" node tools/verify-workspace.mjs`.

The run checks source identity before and after every layer and requires all 48 registered layers. The source manifest is saved in `2026-10-21-directory-final-candidate.json`. Final status: **passed**, all **48** layers, run `8cd3784f-eebf-4b6b-b9aa-a812341574c0`. The completed record is `2026-10-21-directory-verification.json`; concise results are in `2026-10-21-directory-verification-summary.json`. No clean-commit gauntlet result is claimed for this uncommitted workspace.

### Interrupted first attempt and unchanged-source continuation

The first attempt passed 27 layers, including 301 integration tests, then stopped while seeding the pre-directory schema for the directory upgrade. Existing tests `GM04 wrong result token cannot attach a provider identity` and `S23 invitation that expires while queued cannot join after lock release` timed out before the directory migration ran. Their observed durations were approximately 123 and 193 seconds despite a 30-second test limit.

The macOS power log records maintenance-sleep intervals of 125 seconds at 14:43:19 and 194 seconds at 14:46:09, matching those pauses. Both tests subsequently passed on the same pre-directory fixture in 2.69 seconds with idle sleep temporarily prevented. This is evidence of a host-sleep interruption, not a directory assertion failure; the original failure is retained in `2026-10-21-directory-verification-first-failure.json` and `2026-10-21-directory-upgrade-first-failure.log`. Diagnostic and selected power-event logs are saved beside them.

Continuation command: `PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH" caffeinate -i node tools/verify-workspace.mjs --resume`. Source and all layer commands remain unchanged. The failed upgrade layer reruns completely; no test timeout, threshold, or required check was changed. `caffeinate` prevents idle system sleep only while the verification command runs.

## Review and manual verification boundaries

The scoped implementation patch and file list are saved in `2026-10-21-directory-implementation.patch` and `2026-10-21-directory-implementation-files.json`. They compare against the pre-task working tree rather than including unrelated user changes. The runtime change, migration definitions, schema delta, API generation coverage, lifecycle tests, and verification registration were reviewed.

Agent visual inspection examined saved record screenshots at 375px and 1440px. The directory title, next-update date/purpose, long reference wrapping, and available controls are readable within the viewport. Browser tests additionally check accessibility and horizontal overflow. This is agent inspection, not human acceptance of every screen.

Human manual acceptance, hosted migration/deployment, and real inbox delivery remain unperformed. No payer portal was accessed or updated.

## Documentation consulted

The Supabase changelog index was retrieved and scanned for relevant changes; this task did not upgrade the pinned stack. The [official migration guide](https://supabase.com/docs/guides/deployment/database-migrations) confirms the local additive migration and replay workflow. CLI behavior was checked through the installed command's help. No external payer rule or update cadence is asserted.

## Final automated results

| Check                                                                                | Result                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Registered layers                                                                    | 48 of 48 passed on the unchanged candidate                                                                         |
| Unit suite with coverage                                                             | 691 tests passed                                                                                                   |
| Integration suite                                                                    | 301 tests passed                                                                                                   |
| Database suite                                                                       | 291 SQL assertions passed, plus required foreign-key controls                                                      |
| Full production browser suite                                                        | 79 cases passed                                                                                                    |
| Shuffled production browser suite                                                    | 79 cases passed                                                                                                    |
| Production / property mutation                                                       | 100% / 100%; no survived or uncovered mutants                                                                      |
| SQL/API mutation                                                                     | 147 deliberate faults killed and independently restored; completion controls and restored integration suite passed |
| Upgrades, schema/types, build, lint/format, capabilities, dependencies, secret scans | All required layers passed                                                                                         |

The first failure and host-sleep diagnosis are retained above; the final result is an unchanged-source continuation, not an uninterrupted first-pass claim. No required check or timeout was weakened. The final source manifest was checked again against the completed run. Scoped diff and documentation were reviewed; engineering documents passed targeted formatting. Agent visual inspection is recorded separately from unconfirmed human acceptance.
