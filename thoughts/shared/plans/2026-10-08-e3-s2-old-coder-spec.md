# SPEC — E3-S2 renewal dashboard

Date: 2026-10-08 (America/Los_Angeles).
Tier: **3** — tenant-authorized reads, date semantics and retained history.
Baseline: `cc1088da1382f50cf1d4301db25d9f19073c9f95`.
Plan: `thoughts/shared/plans/2026-10-07-e3-s2-renewal-dashboard.md`.

## Authorization and setup

User instruction: **“create specs and implement it”**. Implement the verified plan autonomously. Separate pre-code SPEC approval: **not obtained (autonomous run)**. Implementation authorization does not constitute independent review of this new spec; disclose this confidence limit in EVIDENCE.

- Isolation: local branch `codex/e3-s2-renewal-dashboard` in the existing checkout to retain ignored pinned tools and guarded local fixture environment. Preserve and checkpoint the three existing untracked planning documents.
- Tools/new dependencies: **none**. Reuse recorded Node 24.21.0, Docker/local Supabase, Vitest/fast-check, Playwright/Axe, Stryker, SQLFluff and Gitleaks. No schema, grant, RPC, generated type or provider API change.
- Git: local specification and implementation checkpoints required by the clean-source gauntlet; no push/merge/production operations.
- Fixtures: only existing dedicated guarded loopback endpoints 55321/55322/55324. Resets/upgrades/mutations run sequentially. No hosted writes or key output.
- New source: `src/lib/dashboard/summary.ts`, `src/components/dashboard/dashboard-panel.tsx`, `src/app/practice/dashboard/page.tsx`.
- New tests: `src/lib/dashboard/summary.test.ts`, `properties.test.ts`, `tests/unit/dashboard-views.test.tsx`, `tests/integration/practice-dashboard.test.ts`, `tests/e2e/practice-dashboard.spec.ts`. Extend route/calendar/register-maintenance witnesses and the three explicit mutation/property inventories.
- Existing source edits: settings/calendar/register navigation, detail fixed dashboard origin and not-found link, scoped global CSS. Existing `tools/gauntlet.mjs`/`tools/layers.json` are reused at 32 layers. No new tooling layer.
- Documentation: update README and plan progress after verification. Evidence: `thoughts/shared/research/2026-10-08-e3-s2-implementation-evidence.md`. Machine outputs/RED results live in ignored reports/coverage; required transient records survive gauntlet report cleanup via safe temporary copies.

## Failure model

| Failure                                        | Executable defense                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Two dates/coverage inflate counts              | Exact record-set/cardinality properties and real shared-policy UI fixtures.                     |
| DST/day-60/year overflow misclassifies urgency | UTC ordinal helper, independent Gregorian oracle, boundary/invalid/full-range tests.            |
| Unknown end disappears behind real deadline    | Overlapping missingEnd list, action-only/both-NULL exact UI/API assertions and overlap copy.    |
| Read outage or missing cycle becomes zero      | Validated repository, route faults and real missing-cycle restoration witness.                  |
| Foreign/revoked/detail URL exposes data        | Current access and checked active list, role/negative API/browser cases, fixed return paths.    |
| Snapshot/edit/archive diverges from counts     | Fresh navigation and two-session correction/clear/archive witnesses with exact count/list sets. |
| New link loses uncertain save recovery         | New navigation inside existing lock, pending/lost-response/exact retry assertions.              |
| Read page changes history                      | Complete six-table before/after snapshots and inherited schema/upgrade gates.                   |
| Dense/mobile/text badges fail                  | Complete list rendering, unique IDs, keyboard/Axe/375px overflow and screenshot inspection.     |

## Observable contract and named scenarios

Dashboard is a saved read-only snapshot of the full active practice. Derive authority only from authenticated current membership, then existing `getMaintenanceRegister(..., false)`. No query input sets practice, today or horizon. Error is unavailable, never fabricated empty. Capture one practice-local today. Detail still reauthorizes its current active record. Origin accepts only scalar `from=dashboard`, yielding fixed dashboard back navigation; all other origins retain validated calendar fallback.

Tracking date is action deadline when entered, otherwise expiration/coverage end. Each active record contributes once to pastDue (<today), dueWithin60 (today through +60), later (>60) or undated (both NULL). All unknown end records also appear in missingEnd; this overlap is explicitly explained and cards are never summed. Date differences use calendar-day ordinals, supporting 0001–9999. Sort dated rows by tracking/title/ID, missing rows by title/ID; do not mutate inputs or merge legitimate records.

| ID                          | Concrete input/action                                                                         | Required result                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Q01 boundaries              | Today 2026-10-08; tracking dates Oct 7/8/9, Dec 6/7/8                                         | Past [Oct7], within [Oct8,Oct9,Dec6,Dec7], later [Dec8]; today badge; +60 included/+61 excluded.                          |
| Q02 precedence/cardinality  | Policy covers two clinicians with end Dec8, action Oct7; similar policy distinct ID           | Each policy counted once past due; both dates retained; no automatic merge/coverage expansion.                            |
| Q03 missing/overlap         | Both NULL; action Oct8 with NULL end; known end only                                          | Two missingEnd records; one undated; action-only also within60 with today badge; unknown end explicit.                    |
| Q04 ordering/immutability   | Same dates/titles and distinct IDs, reversed input; archive row                               | Deterministic date/title/ID and title/ID lists, archive absent, input unchanged.                                          |
| Q05 Gregorian/invalid       | 1900/2000 leap rules, 0001/0099/9999; invalid date/newline/day0; empty register invalid today | Exact independent day deltas; reject invalid with `Invalid credential date`; no overflow/local-day shift.                 |
| Q06 local today             | Jan1 07:59Z, LA vs Tokyo; browser Honolulu/Tokyo                                              | Server days Dec31/Jan1 respectively; saved dates unchanged.                                                               |
| Q07 route guards            | Anonymous/no practice/all roles/access or list fault                                          | Login/onboarding redirects; all active roles read own active list; faults throw safe retry error.                         |
| Q08 real access/outage      | Two practices, retained revoked token, anonymous, removed cycle                               | Outsider/anonymous/revoked denial; missing cycle unavailable, restored in finally.                                        |
| Q09 detail origin           | Exact dashboard, repeated/external/unknown origin, existing calendar context                  | Fixed dashboard back; invalid origin uses calendar; own normalized UUID only; foreign/archive/missing neutral.            |
| Q10 fresh mutations         | Correct/clear/archive dates from another session, refresh/stale detail                        | Counts/list membership update together; archived detail unavailable; history retained.                                    |
| Q11 preservation            | Read dashboard/projection/detail around saved fixture                                         | Complete credentials/cycles/coverage/audit/create/change-receipts and versions unchanged.                                 |
| Q12 interface               | Dense Unicode/HTML-looking records at 1440/375px; keyboard/Axe                                | Escaped text, complete lists, textual urgency/time/owner/type/purpose, unique IDs, no overflow/Axe violations.            |
| Q13 navigation/recovery     | Settings/calendar/register entry; uncertain/pending save; confirmed exact retry               | Fixed entry paths; dashboard link hidden while frozen and restored after confirmation; existing receipt semantics intact. |
| Q14 empty/later             | Empty active set; only +61 record                                                             | Honest no-active and no-urgent states; later count/register/calendar links; no invented all-clear/SMS claim.              |
| QP01 independent properties | Seeded arbitrary supported days/archive/type/coverage/date combinations                       | Exact independent partitions, overlap/counts/order, immutable inputs and synthetic progress invariance.                   |
| QP02 date properties        | Seeded years/months/days                                                                      | Independent Gregorian ordinal deltas, antisymmetry, year range, no DST duration arithmetic.                               |
| Q15 gate                    | Final clean implementation source                                                             | 32/32 existing layers pass including full executable coverage and unit/property-only 100% mutation thresholds.            |

## Must NOT

| ID   | Constraint/witness                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| QN01 | No schema/RPC/grant/generated-type/persisted dates change: source/schema/type gates.                                                         |
| QN02 | No history/audit/receipt writes or archive restoration/deletion/successor cycles: snapshots/inherited maintenance.                           |
| QN03 | No SMS/phone/jobs/workflow persistence/inferred dates: source/capability/UI review. E5 persisted in-progress acceptance remains outstanding. |
| QN04 | No home redirect/calendar filter/undated semantics change: existing routes/calendar tests.                                                   |
| QN05 | No weakened thresholds/skips/coverage exclusions/results fabrication: unchanged gates/fresh source-bound evidence.                           |
| QN06 | No new dependencies/browser persistence/hosted writes/push/deploy: supply-chain/capability/Git review.                                       |

## Execution and evidence

Implement phase 1 domain, phase 2 guarded reads/detail, phase 3 presentation/navigation/browser, phase 4 gauntlet/evidence. New tests must first fail on behavior against a stub or missing new behavior, with individually recorded RED. Immediately passing regression constraints require an actual throwaway behavioral fault and restoration; inherited checks are not claimed as new RED.

Entry point: `PATH="$PWD/.tools/node/bin:$PATH" npm run gauntlet`. Preserve all 32 layers and current thresholds. Record final commit/source hash, exact commands/results, RED and intermediate fixes, scenario/test mapping, limits and user acceptance separately. No independent implementation review is claimed unless the complete fresh-context protocol is performed.

## Revisions

- 2026-10-08 — Initial SPEC before runtime edits under autonomous implementation instruction. Setup and scope follow the verified plan; independent human spec approval absent; no production operation authorized here.
