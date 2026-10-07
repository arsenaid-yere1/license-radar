# SPEC — E3-S1 calendar and agenda

Date: 2026-10-07 (America/Los_Angeles).
Tier: **3** — tenant-authorized detail reads, hostile URL inputs, historical date semantics, and retained archive visibility.
Baseline: `1d80100e4088df16488fbc85d1ebddd8bae85e1f`.
Plan: `thoughts/shared/plans/2026-10-07-e3-s1-calendar-and-agenda.md`.

## Authorization and setup

User instruction: **“create specs and implement it”**. Execute the verified E3-S1 plan autonomously. Separate pre-code SPEC approval: **not obtained (autonomous run)**. Implementation authorization is not independent approval of this new specification; disclose that limit in evidence.

- Isolation: local branch `codex/e3-s1-calendar-and-agenda` in the existing checkout, retaining ignored pinned tools and the guarded fixture environment. Preserve the three current untracked planning documents.
- Tools/dependencies: **none added**. Reuse Node 24.21.0 at `.tools/node/bin`, npm, local Docker/Supabase/PostgreSQL, Vitest/fast-check, Playwright/Axe, Stryker, SQLFluff, and Gitleaks. No schema migration, grants, RPC, service key, or database types change.
- Git: local specification and implementation checkpoints needed by the existing clean-source 32-layer gauntlet. No push, merge, forced operations, production write, or deployment.
- Fixture setup/reset: existing dedicated guarded project and loopback ports only. Database resets/upgrades/faults run sequentially. Never print keys or private production data.
- New domain files: `src/lib/calendar/events.ts`, `dates.ts`, `query.ts`; corresponding `events.test.ts`, `dates.test.ts`, `query.test.ts`, `properties.test.ts`.
- New routes: `src/app/practice/calendar/page.tsx`, `src/app/practice/register/[credentialId]/page.tsx`, `not-found.tsx` in the latter segment.
- New UI: `src/components/calendar/calendar-panel.tsx`, `month-calendar.tsx`, `calendar-agenda.tsx`, and shared `src/components/register/record-dates.tsx`. Modify register-panel date import and guarded navigation, practice-settings navigation, and scoped global styles.
- New witnesses: `tests/unit/calendar-views.test.tsx`, `record-dates.test.tsx`, `tests/integration/practice-calendar.test.ts`, `tests/e2e/practice-calendar.spec.ts`; extend route/register navigation witnesses and explicit property/mutation inventories. Existing `tools/gauntlet.mjs` and its 32 layers are reused unchanged.
- Evidence: `thoughts/shared/research/2026-10-07-e3-s1-implementation-evidence.md`; actual machine results/RED records in ignored `reports/` and `coverage/`. No browser storage.

## Failure model

| Failure                                                                    | Executable defense                                                                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Foreign/stale URL or cached event reveals another practice/archived record | Derive practice from current access, checked active-list RPC, fresh document navigation, negative API/route/browser cases.                    |
| Missing cycle or read outage fabricated as empty/not-found                 | Validated existing repository, route error assertions, real malformed-cycle/outage witnesses.                                                 |
| Calendar shifts saved dates or miscalculates years/leap days               | Date-only projection, practice-local injected instant, independent Gregorian/UTC properties, contrasting browser zones.                       |
| Coverage expands one policy into multiple duplicate events                 | Filter credential once, project one event per entered purpose, exact event-set/cardinality tests.                                             |
| Invalid or repeated filters silently widen results                         | Strict bounded query parsing, neutral invalid state, suppressed navigation until explicit fix/reset, encoding/round-trip/hostile-input tests. |
| Calendar hides unknown dates or confuses both purposes with jobs           | Separate undated section, end/action labels and single tracking flag, exact rendering assertions.                                             |
| New navigation breaks uncertain edit/archive recovery                      | Calendar link placed inside existing lock; real lost-response and frozen-navigation regression.                                               |
| UI truncates dates or unusable phone calendar                              | All-event rendering, CSS responsive default/override, long/dense fixtures, keyboard/Axe/375px overflow checks and image inspection.           |
| Read-only feature alters history or existing workflows                     | Complete before/after row snapshots, unchanged schema/type fingerprint, full inherited tests/upgrades.                                        |

## Observable contract

All active members can read `/practice/calendar` and `/practice/register/<UUID>`. Auth precedes current practice/access and the existing checked maintenance-list read with `includeArchived=false`. No URL field grants authority. Missing practice redirects to onboarding; unexpected access/read/projection failures use the existing safe retry boundary. Detail returns neutral not-found for malformed, foreign, missing, or archived records, while read outages remain errors. Detail/back event anchors navigate documents for a fresh request; loaded snapshots/browser history may remain old until refresh.

Each active credential produces exactly one end event if its end date exists and one action event if the earlier deadline exists. IDs are `<cycle UUID>:end|action`, with current date revision and purpose. An end event is expiration for state/DEA and coverage end for policy. Only the event selected by existing `trackingDate` has the tracking flag. Shared coverage never expands event count; distinct suspected duplicates remain distinct.

Both views show the same selected month from date components. Years 0001–9999 are supported; Sunday-first grids contain blank adjacent-month cells, stop bounded navigation, and identify today from the practice timezone. Capture now once server-side; never infer expiration or scheduled SMS dates. Both-dates-NULL records appear once in a filtered undated section independent of selected month. Action-only records keep unknown-end text.

Filters combine with AND. Clinician UUID matches direct owner OR covered clinician; `practice` matches practice ownership. Type is an existing enum. Jurisdiction is NULL sentinel `unknown` or `value:<exact saved text>`. URL state encodes through URLSearchParams and preserves month/filter/view/detail-back context. Invalid/repeated/overlong filters yield warning/no results until fixed/cleared; stale valid filters yield no matches. Invalid month/view yields a visible notice and current-month/responsive defaults. Unknown query keys carry no authority. No arbitrary return URL.

Desktop defaults to month above 700px; phone defaults to agenda at/below 700px using mutually exclusive CSS. Explicit view overrides both. Hidden view leaves accessibility tree/tab order; IDs remain unique. All events wrap without silent truncation. Detail reuses extracted date markup and offers existing register anchors, with role-appropriate link wording and no new editor. Calendar/detail visibly state **“Text reminders are not active yet.”**

## Named scenarios

| ID                         | Input/action                                                                                                           | Expected output                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| C01 all types/purposes     | State/DEA/policy with end `2028-02-29` and action `2028-02-01`                                                         | Six distinct events; labels expiration/coverage end/action; only action events track.                                    |
| C02 date unknowns          | Both NULL, end only, action only; action/end in different months                                                       | Zero/one/one/two events respectively; one undated record; actual month groups and unknown-end text.                      |
| C03 coverage/filters       | Shared policy covers Rivera/Chen; select either; combine type/jurisdiction                                             | Exactly one event per purpose; owned/covered OR inside clinician filter, filter groups AND.                              |
| C04 query contract         | Repeated scalars, malformed UUID/type/month/view, 121-character jurisdiction, NULL/literal unknown, Unicode/ampersands | Invalid filters do not broaden results; notices/reset; exact round-trip encoding; no raw hostile display/authority.      |
| C05 calendar arithmetic    | February 1900/2000/2028, years 0001/0099/9999, December→January                                                        | Correct weekdays/day counts/blank cells; bounded previous/next; no years 1901/1999 remapping.                            |
| C06 local today            | Same instant in Los Angeles and Tokyo; DST; saved date in browser Honolulu/Tokyo                                       | Practice-local today/month may differ; event dates never shift; invalid timezone errors.                                 |
| C07 detail authority       | Own active UUID, uppercase UUID, foreign/missing/malformed/archive IDs                                                 | Own detail complete; normalized UUID match; others neutral not-found with no data.                                       |
| C08 guarded reads          | Anonymous/no-practice/active viewer/manager/admin/revoked; API failure/malformed cycle                                 | Auth/onboarding/live access; all active roles read; unavailable fails closed, not empty or not-found.                    |
| C09 correction/archive     | Update either date/clear both/archive then reread or click stale event                                                 | Dates move/remove correctly, undated entry follows values, all archived events gone, stale detail not-found.             |
| C10 navigation             | Filters, previous/next/direct/this month, responsive/explicit view, refresh/reload/back/detail/back                    | Valid state preserved; invalid filters require explicit fix/reset; fresh requests recheck authority.                     |
| C11 readable interface     | Dense same-day events, long/hostile/Unicode names, 1440px/375px, keyboard/Axe                                          | No hidden event truncation/XSS/overflow; semantic purpose/owner/type/time; default/override views accessible.            |
| C12 recovery               | Lost committed edit/archive response in register                                                                       | Calendar link hidden with other view controls; exact retry restores navigation and unchanged original receipt semantics. |
| C13 read preservation      | Calendar/detail/filter reads around active+archive fixtures                                                            | Credential/cycle/coverage/audit/create/change-receipt sets and versions unchanged.                                       |
| C14 pipeline               | Final implemented source checkpoint                                                                                    | All 32 inherited layers pass with new app files included in strict coverage/mutation/property gates.                     |
| CP01 projection properties | Seeded credential/date/filter/coverage/archive combinations                                                            | Independent exact expected event/undated sets, input immutability, stable identities/order/cardinality.                  |
| CP02 date/query properties | Seeded years/months/instants and valid/invalid URL states                                                              | Independent weekdays/day counts, bounded navigation, exact encoding round trips, reject invalid inputs.                  |

## Must NOT

| ID   | Constraint and witness                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CN01 | No schema/RPC/grants/generated-type or persisted date/calendar duplication; unchanged schema/type gates and final source review.         |
| CN02 | No history rewrite, receipt/audit write, archive restore/delete, or successor cycle; complete snapshots and inherited maintenance tests. |
| CN03 | No SMS/queue/phone/consent/scheduling or inferred reminder dates; capability/source/UI review. E4 job acceptance stays outstanding.      |
| CN04 | No dashboard urgency counts, export/subscription/import/new types/fields; scoped routes/domain/source review. E3-S2 remains next.        |
| CN05 | No regression to practice/team/auth/join/recipient/register recovery; complete inherited suites/upgrades.                                |
| CN06 | No dependencies/browser persistence/production operations/push; capability/supply-chain/secret gates and Git review.                     |
| CN07 | No weakened checks, skipped new source coverage, invented test results, or historical gauntlet reuse; fresh checkpoint-bound evidence.   |

## Execution and evidence

Phase order: (1) domain/date/query + RED/GREEN properties; (2) authenticated read/detail + real API witnesses; (3) responsive UI/navigation + browser acceptance; (4) full regression gauntlet/evidence. Each phase's automated checks must pass before its checkbox is marked; user manual acceptance remains unchecked.

Observe new behavioral tests failing before implementation; collection/import failure is not a substitute. Record RED outputs. Already-passing inherited guards are regression constraints, not new RED claims. Use actual mutation tools and preserve inherited 100% mutation/complete executable-line gates. Final reproducible entry point: `PATH="$PWD/.tools/node/bin:$PATH" npm run gauntlet` on a clean local checkpoint. Record actual counts, results, source identity, failed intermediate checks/fixes, scenario-to-test mapping, and limitations. No independent fresh-context implementation review is claimed unless its full protocol is actually performed.

## Revisions

- 2026-10-07 — Initial SPEC before runtime edits; implementation authorized by “create specs and implement it.” Declares autonomous-review limit, local branch/checkpoints, no added packages/schema, exact date/filter/access/UI/recovery contracts and 32-layer completion gate.
