# Verification Summary

Date: 2026-10-21 (America/Los_Angeles).
Plan: `thoughts/shared/plans/2026-10-21-insurance-payer-provider-directory-renewal-type.md`.
Research: `thoughts/shared/research/2026-10-21-insurance-payer-provider-directory-renewal-type.md`.
Overall readiness: **Ready** for implementation under the confirmed scope. This task produced planning documents only.

The user confirmed three product decisions during planning:

1. A record belongs to the practice or one clinician, with one record per payer obligation.
2. Staff enter the next directory update due date; recording completion requires a new future due date.
3. The first version is manual tracking using existing title, payer, optional reference, jurisdiction, portal link, and evidence fields.

No blocking product decision remains. Visible field labels, inclusive dashboard wording, and generic reminder due-date wording are specified implementation defaults. Multi-provider relationships, inferred recurrence, completion without a next date, or payer integration would require a scope revision.

## Findings

No unresolved Critical, Major, or Minor findings were identified by the independent plan review.

Verified repository facts:

| Area                      | Evidence and conclusion                                                                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type persistence          | `supabase/migrations/20261020210728_pci_compliance_certificate_records.sql` defines the current CHECK and three whitelist functions. A new additive migration can widen these while preserving PCI ownership, signatures, grants, and payload contracts.          |
| Number-aware APIs         | `supabase/migrations/20261016221310_credential_record_numbers.sql` delegates current create/edit input to `private.credential_change_values`; no new numbered RPC is needed.                                                                                      |
| Ownership                 | `src/lib/register/schema.ts` and current SQL support practice or one clinician for non-PCI records and reserve covered clinicians for practice malpractice policies. This matches D1.                                                                             |
| Dates and completion      | `src/lib/register/dates.ts`, `src/lib/renewals/schema.ts`, and `supabase/migrations/20261013172507_credential_renewal_completion.sql` support optional saved dates plus a mandatory future successor end date. This matches D2 when directory wording is applied. |
| Date presentation         | Independent branches exist in tracking, calendar events, history, and evidence. The plan covers all four, as well as form guidance, directory error display, dashboard missing-date copy, and generic reminder presentation.                                      |
| Retained type             | `private.renewal_cycle_history` uses completed-cycle snapshot type when available, otherwise current type. The plan uses cycle context and preserves this behavior.                                                                                               |
| Historical upgrades       | Six older-schema seeding runners need the new integration exclusion, including `tools/pci-certificates-upgrade.mjs`; the plan retains positive acceptance on the upgraded schema.                                                                                 |
| Verification registration | `tools/layers.json`, `tools/gauntlet.mjs`, and `tools/verify-workspace.mjs` currently register 47 layers. The proposed upgrade check requires 48, exact-count controls, and the documented capability/mutation wiring.                                            |

The plan explicitly preserves old-type labels, retry payloads, original API generations, current-cycle readers, notification permission consumption, and existing security boundaries. Planned completion tests include missing/invalid/past/today next dates, action-date ordering, and explicit clearing of the previous action deadline.

## Missing Work

No planning omission was identified. The three implementation phases, DIR01–DIR10 acceptance tests, new migration, application changes, populated upgrade, documentation, and complete 48-layer verification remain future work. Their presence in the plan is not evidence that the feature exists or passes acceptance.

## Risks

- Older parsers can reject entire registers once a fifth-type record exists. Migration/application ordering and compatible rollback readers are required.
- Completed-cycle snapshots, immutable receipts, and consumed notification permissions must survive upgrade and rollback handling.
- A fifth type must not silently broaden malpractice coverage or weaken PCI ownership.
- Directory due-date presentation must remain consistent while SQL purpose values and historical error/result contracts remain stable.
- Existing uncommitted prerequisite work must be preserved; source and migrations must be rechecked before implementation or release.

The plan assigns verification and rollback constraints for these risks. No hosted state was inspected.

## Suggested Changes

No blocking revisions were requested. During final plan editing, completion boundary cases and blank successor action-deadline clearing were made explicit, and the companion verification reference/status was added. No runtime source changed.

## Checks Performed

Existing-behavior baseline, with the repository's pinned Node runtime:

```sh
PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH" npm test -- src/lib/register/properties.test.ts src/lib/register/dates.test.ts src/lib/register/numbers.test.ts src/lib/register/pci.test.ts src/lib/renewals/history.test.ts src/lib/calendar/query.test.ts src/lib/calendar/properties.test.ts src/lib/dashboard/properties.test.ts tests/unit/pci-record-forms.test.tsx tests/unit/register-number-forms.test.tsx
```

Result: **10 files, 53 tests passed**, exit 0. These tests establish the inspected existing behavior, not new directory acceptance.

Read-only verification-inventory assertion, run by the verification-tool researcher using ambient Node:

```sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {requiredWorkspaceLayers,assertWorkspaceLayers} from "./tools/verify-workspace.mjs"; const layers=JSON.parse(readFileSync("tools/layers.json","utf8")); assertWorkspaceLayers(layers); console.log(JSON.stringify({layers:layers.length,workspace:requiredWorkspaceLayers.length,ids:layers.map(x=>x.id)}));'
```

Result: exit 0; `layers: 47`, `workspace: 47`, with the current 47 IDs enumerated. This imports the assertion and reads the manifest; it does not run the verification pipeline.

Document checks:

```sh
npx --no-install prettier --ignore-path /dev/null --write thoughts/shared/plans/2026-10-21-insurance-payer-provider-directory-renewal-type.md thoughts/shared/plans/2026-10-21-insurance-payer-provider-directory-renewal-type-verification.md
npx --no-install prettier --ignore-path /dev/null --check thoughts/shared/plans/2026-10-21-insurance-payer-provider-directory-renewal-type.md thoughts/shared/plans/2026-10-21-insurance-payer-provider-directory-renewal-type-verification.md
```

Result: both documents formatted and passed. The explicit ignore override includes `thoughts/`, normally excluded by the repository. New-file diffs were reviewed using `git diff --no-index -- /dev/null <document>`; exit 1 indicates the expected added-file difference.

Manual/source review: current source, test patterns, migrations, display paths, upgrade fixtures, and verification registrations were inspected, with independent review of the complete plan. No lint/type-check, feature implementation tests, database reset/migration, integration/browser acceptance, or hosted mutation was run for this documentation-only task.

## Final Recommendation

**Approve implementation under confirmed D1–D3.** The plan is technically ready and has no unresolved material product decisions. Implementation and release remain separate from this planning task.
