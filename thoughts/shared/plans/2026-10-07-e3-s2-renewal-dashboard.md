# E3-S2: Renewal Dashboard Implementation Plan

Date: 2026-10-07 (America/Los_Angeles).
Baseline: `cc1088da1382f50cf1d4301db25d9f19073c9f95`.
Status: All four implementation phases verified locally on 2026-10-08; all 32 layers passed. Hosted release verified on 2026-10-08; user manual acceptance remains unconfirmed.
Research: `thoughts/shared/research/2026-10-07-e3-s2-renewal-dashboard.md`.
Verification: `thoughts/shared/plans/2026-10-07-e3-s2-renewal-dashboard-verification.md`.

## Overview

Deliver the next P0 story, E3-S2: “As a manager, I can see due, past-due, and missing-date items so I can prioritize work.” Add an authenticated read-only dashboard at `/practice/dashboard` with record counts, matching lists, textual urgency badges and links to current authorized record details. Reuse saved cycle dates and the existing active-register read API. No migration or dependency is needed.

`README.md:34` and the E3-S1 production release identify this story next; the original backlog's E3 section defines its acceptance. Calendar/agenda is already implemented and released. E4 phone enrollment and reminder delivery follows the P0 visibility slice; external calendar subscriptions and CSV import remain P1.

## Current State

One Next.js/React/TypeScript application uses Supabase Auth/PostgreSQL and Zod. Routing belongs to `src/app/`, UI to `src/components/`, domain/persistence to `src/lib/`, database contracts to `supabase/` and verification to `tests/`/`tools/`.

`getMaintenanceRegister` in `src/lib/register/repository.ts:97` returns validated active records with current-cycle dates, owner/coverage, metadata, archive state and advisory duplicate IDs. Its maintenance SQL checks live membership. All active roles can read; viewers cannot mutate. `src/lib/register/dates.ts:28`, `trackingDate`, prioritizes action deadline, otherwise expiration/coverage end. `src/lib/calendar/dates.ts:3`, `practiceToday`, provides explicit-instant practice-local today. The calendar renders two date-purpose events when both dates exist; those events are unsuitable as dashboard counts.

`src/app/practice/calendar/page.tsx` supplies the dynamic guarded route/snapshot pattern. The existing detail page rereads current authorized records and has calendar back navigation. Settings and `RegisterFeedback` supply entry links, with the latter suppressing navigation during uncertain saves. No dashboard, urgency classifier, persisted workflow state, completion, jobs or SMS dispatch exists.

## Desired End State

| ID   | Acceptance criterion                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | All active credential types and owner kinds contribute one credential to a date-based urgency bucket; two dates, shared coverage and duplicate warnings never multiply counts. Distinct legitimate records remain distinct.                       |
| AC2  | Past due means tracking date before today; due today is explicit; due within 60 days includes today through +60 inclusive. +61 belongs to later. Tracking uses the entered action deadline before end date.                                       |
| AC3  | Counts derive from the exact displayed list arrays. Missing expiration/coverage-end records remain visible even with an entered action deadline; both-NULL records display “Dates not entered.” Intentional overlap is explained.                 |
| AC4  | Today comes from one server instant in the practice timezone. Gregorian day differences survive DST, leap days, year changes and supported years 0001–9999 without changing saved dates.                                                          |
| AC5  | A saved snapshot shows date/timezone, refresh, calendar/register/settings links, labeled counts, semantic dates and text urgency badges. Desktop and phone layouts remain readable, accessible and complete.                                      |
| AC6  | Dashboard reads enforce authentication and current practice access for every active role. Anonymous, absent-practice, revoked/foreign and read-error paths match current guards; failures never become zero counts.                               |
| AC7  | Details recheck current authority/active availability and provide a fixed return to dashboard. Existing calendar filter/back behavior remains intact; malformed origin parameters cannot cause external redirects.                                |
| AC8  | Fresh navigation/refresh after correction, date clearing or archive updates both count and list membership. Reads preserve records, cycles, coverage, receipts, audits and versions. Pending/uncertain register saves continue hiding navigation. |
| AC9  | Urgency uses only dates and archive eligibility, independently of progress. No workflow persistence is introduced. E5 must add the persisted in-progress/past-due regression when workflow exists.                                                |
| AC10 | New unit/property/API/browser witnesses and all inherited gates pass against the implemented source, with visual/manual acceptance limits recorded. Text reminders stay visibly inactive.                                                         |

## Key Discoveries

1. The current maintenance RPC/schema already supplies every field needed, including action-only records and archive eligibility. A separate aggregation endpoint or cached counts would introduce another consistency boundary.
2. Calendar counts date purposes within a month; dashboard counts credentials across the whole active practice. Reuse `trackingDate`, not `projectCalendar(...).events.length`.
3. “Missing dates” has two useful cases: no tracking date, and unknown end with a known action deadline. Keep the latter actionable without stripping its real deadline or silently treating the end as known.
4. Date-only support spans 0001–9999. UTC ordinal differences avoid DST-length days, years below 100 constructor remapping and an overflowing today-plus-60 at the maximum year.
5. `RegisterFeedback` in `src/components/register/register-panel.tsx:266` is the correct location for guarded dashboard navigation. Existing detail UUID/auth/read checks should remain the sole detail boundary.
6. `credentialSchema` currently has no workflow status. A real in-progress browser witness cannot be claimed until E5 persists it; a date-only interface and extra-status invariance tests establish the integration rule now.

## What We Are Not Doing

- SMS enrollment, readiness changes, failed-message counts, scheduling, jobs, dispatch, cancellation, or delivery history.
- Workflow controls, renewal completion/successor cycles, renewal URLs, audit/history UI or new credential fields/types.
- Dashboard filters, search, pagination, external feeds, import/export or chart dependencies.
- Changing the existing settings/home landing route, calendar filter semantics or calendar's both-NULL undated definition.
- Database/schema/grant/policy changes, a new RPC, deployment, production writes or commits in this planning task.

## Implementation Approach

### One pure record projection

Add proposed `src/lib/dashboard/summary.ts` with `calendarDayDifference(due, today)` and `projectDashboard(register, today)`. Accept the existing `MaintenanceRegister` and one valid today date. The projection has no persistence, auth, SMS, browser clock or workflow dependency.

Compute date ordinals from validated components: initialize `Date(0)`, use `setUTCFullYear(year, month - 1, day)` and `setUTCHours(0, 0, 0, 0)`, then divide the UTC timestamp by 86400000. Subtract ordinals; never subtract practice-local instants or parse date strings into local time. Reject invalid helper inputs with a controlled error using `isCredentialDate`; validate today at projection entry even for an empty register, and never silently fall back to another day. Supported maximum-year arithmetic needs no constructed +60 date. Use independent Gregorian integer arithmetic as the property-test oracle.

For each nonarchived record, call `trackingDate` once, derive days until that date and produce one entry containing the record, tracking date/purpose (or NULL), signed days (or NULL) and urgency (`past-due`, `due-today`, `due-soon`, `later`, `undated`). Build `pastDue`, `dueWithin60`, `later`, `undated` and `missingEnd` arrays. The first four partition active credentials; `dueWithin60` combines today/soon. `missingEnd` is an intentional overlay where `current_cycle.end_date === null`, including every undated entry. Counts come from these arrays' lengths; total active is the partition sum, never sum of summary cards.

Sort dated lists by tracking date ascending, then title and credential UUID using deterministic code-point comparison. Sort missingEnd/undated by title/UUID. Preserve input arrays/records; do not merge separate IDs because their metadata matches or expand policies per clinician. Ignore any future progress annotation when assigning urgency. Add synthetic extra-field invariance properties without inventing a persisted workflow field or changing the current schema.

### Dashboard and detail boundaries

Add proposed `src/app/practice/dashboard/page.tsx`, `force-dynamic`. Follow calendar: `requireUser`, `getPracticeAccess`, then `getMaintenanceRegister(client, access.practice.id, false)`. Never take practice ID, today, horizon or counts from URL input. Absent practice redirects to onboarding; access/list failure throws the existing safe error. Missing cycles/malformed responses must remain unavailable through repository validation. Compute `practiceToday(practice.timezone, new Date())` once and pass to projection/presentation. Invalid timezone remains an error.

Use document-navigation anchors for entry/refresh/detail/back paths, fetching current access/data on each request. Show “Saved snapshot” plus formatted “As of” date/timezone and existing inactive-text copy. Browser history can restore old pixels; explain explicit refresh and test current-request authority without promising real-time revocation or midnight auto-update.

Dashboard row links use the fixed route `/practice/register/<UUID>?from=dashboard`. Extend `CredentialDetail` to recognize only the exact scalar `from === "dashboard"`; then show a fixed `/practice/dashboard` back link. Otherwise keep the existing calendar parser/serializer and context behavior, including invalid calendar-filter recovery. Arrays/repeated/unknown/external-looking origin values fall back to existing calendar behavior. No arbitrary return URL is accepted. Do not change detail auth, UUID validation, active list read, error/not-found or register-edit link behavior. Add a fixed dashboard link to the neutral segment not-found page; it cannot infer record ownership/status.

### Interface and missing-date semantics

Add proposed `src/components/dashboard/dashboard-panel.tsx` using existing Shell, typography/tokens and `RecordDates`/`DateText`. Render three labeled count cards linking to stable list section anchors: “Past due”, “Due within 60 days” and “Missing expiration / coverage end”. Due-list helper copy states “Includes today and the next 60 calendar days.” Its rows explicitly badge “Due today” or “Due in N days”; past rows say “Past due” and optionally “N days past due.” Color supplements text and must not imply legal validity.

Render complete `pastDue`, `dueWithin60` and `missingEnd` arrays with per-section empty states. `undated` is represented within `missingEnd`; `later` receives only a count and fixed register/calendar links. Each row identifies title, type, owner, optional shared-policy coverage, urgency and both saved date purposes through `RecordDates`. Missing-end section explains that an entered action deadline may also place a record in a dated list above; do not present these three counts as an additive task total. Both-NULL records have “Dates not entered”; action-only records retain their urgency/entered date and explicit unknown-end label. Rows repeated across sections have unique DOM IDs based on section and credential ID. Summary anchors target section headings; no repeated `record-UUID` IDs.

Show later-record count with text “Tracking date more than 60 days away” and a link to the complete register/calendar. No false “all clear” when there are later or missing dates; distinguish no active records from no urgent dates. Urgency is about the tracking date, so a past action deadline with a future end still says past due while clearly identifying the action purpose. Never label an expiration past merely because its earlier action is past.

Add “Renewal dashboard” document links in settings, calendar actions and the unlocked `RegisterFeedback` branch. Calendar dashboard navigation remains available even for invalid filters because it opens a fixed separate view; it does not clear filters into an unfiltered calendar. Preserve existing register uncertainty freezes. Keep dashboard read-only for all active roles and link editing through authorized detail/register.

Scoped CSS in `src/app/globals.css` lays out summary cards and readable lists with wrapping/stacking at the existing 700px breakpoint. All items remain available; no silent list truncation. Use semantic headings/lists and `<time>`; avoid a new client state manager or responsive duplicate trees.

## Phase 1: Urgency projection and independent date witnesses

### Files and changes

- Add proposed `src/lib/dashboard/summary.ts`, `summary.test.ts` and `properties.test.ts` with the contracts above.
- Extend `stryker.config.mjs` and `stryker.properties.config.mjs` to mutate summary; extend `vitest.properties.config.ts` to discover dashboard properties. Preserve thresholds.

### Automated verification

Run `npm test -- src/lib/dashboard src/lib/calendar/dates.test.ts src/lib/register/dates.test.ts`, `npm run typecheck` and `npm run lint`. Assert exact record sets at -1, 0, +1, +59, +60 and +61; earlier action override; end-only/action-only/both-NULL; every type/owner; shared-policy cardinality; archived removal; similar duplicate candidates with distinct IDs remaining distinct; deterministic ties and immutable input.

Independent properties cover the full year range, 1900/2000 leap rules, year/month boundaries, invalid date inputs, ordinal antisymmetry and partition totals. Compute oracle expectations from Gregorian day counts rather than the production helper. Verify counts equal list lengths, undated is a subset of missingEnd, action-only overlap is exact, input permutations preserve order, and synthetic progress annotations leave date urgency unchanged. Existing injectable `practiceToday` witnesses plus explicit today inputs exercise zone-midnight/DST differences. Exit: AC1–AC4/AC9 domain contracts pass.

### Manual verification

Review boundary fixtures against entered dates and existing `trackingDate`. Check that the implementation neither counts calendar events nor uses a local elapsed-time duration as calendar days.

## Phase 2: Authenticated route and record return navigation

### Files and changes

- Add proposed dashboard page and server-renderable dashboard panel (basic semantic markup, completed in Phase 3).
- Extend `src/app/practice/register/[credentialId]/page.tsx` and `not-found.tsx` with fixed dashboard return/navigation.
- Extend `tests/unit/routes.test.tsx`; add proposed `tests/integration/practice-dashboard.test.ts`, following real calendar fixtures and read-preservation witnesses in `tests/integration/practice-calendar.test.ts`.

### Automated verification

Run `npm test -- tests/unit/routes.test.tsx src/lib/dashboard`, `npm run typecheck`, `npm run lint` and `npm run test:integration -- tests/integration/practice-dashboard.test.ts tests/integration/practice-calendar.test.ts` on the dedicated local fixture stack. Cover all active roles; login/onboarding/access failures; list forbidden/unavailable; malformed or missing-cycle response; practice-local today at a frozen server instant; correct own practice and `false` archive argument even with hostile query input.

Route mocks verify fixed dashboard back link, unchanged calendar context, repeated/invalid origin fallback, normalized UUID and neutral missing/foreign/archive details. Real API tests use all three types in two practices, read through `getMaintenanceRegister` plus dashboard projection, deny outsider/anonymous and retained revoked tokens, and preserve complete credential/cycle/coverage/audit/create/change-receipt snapshots and versions. Correct/clear dates and archive through checked existing mutations, then reread and assert exact changed buckets/counts/missing flags. Restore any deliberately removed cycle in a finally block. Exit: AC6–AC9 read/navigation witnesses pass.

### Manual verification

Inspect server props for authorized projection only, dynamic/no-store route behavior and error-versus-empty handling. Verify return context is a fixed navigation choice with no authority effect.

## Phase 3: Dashboard presentation, entry links and browser acceptance

### Files and changes

- Complete proposed `src/components/dashboard/dashboard-panel.tsx` and scoped `src/app/globals.css` styling.
- Add navigation in `src/app/practice/page.tsx`, `src/components/calendar/calendar-panel.tsx` and `src/components/register/register-panel.tsx:RegisterFeedback`.
- Add proposed `tests/unit/dashboard-views.test.tsx` and `tests/e2e/practice-dashboard.spec.ts`. Extend affected existing route/calendar/register-maintenance tests for navigation and uncertainty-lock regressions. Reuse `tests/helpers/private-browser.ts` coverage conventions.

### Automated verification

Run `npm test -- tests/unit/dashboard-views.test.tsx tests/unit/routes.test.tsx tests/unit/calendar-views.test.tsx tests/unit/register-maintenance-forms.test.tsx`, `npm run build` and `npm run test:e2e -- tests/e2e/practice-dashboard.spec.ts tests/e2e/practice-calendar.spec.ts tests/e2e/practice-register-maintenance.spec.ts`.

Browser fixtures must prove summary count/list agreement, exact 0/60/61 boundaries, both-date purpose labels, nonmultiplied shared policies, action-only overlapping missing-end rows, both-NULL visibility and honest empty/later states. Use a stable injected instant in unit/route tests for exact boundaries. For production-browser boundary fixtures, read the dashboard's machine-readable As-of day, seed dates relative to it, reload and compare the rendered day. If midnight changed it, reseed/reload once before asserting exact expected sets; a further change fails with a clear fixture-clock diagnostic instead of weakening expectations. Browser clocks do not control server time. Check differing browser timezones never shift saved dates.

Exercise all entry links, section anchors, detail/back and existing calendar filter return; viewer read-only behavior; anonymous/revoked/foreign/stale archived detail; outage then recovery; private/no-store dashboard headers. Two sessions correct/clear/archive a saved record and refresh the first snapshot, verifying list/count changes. Assert dashboard navigation is absent during pending/uncertain maintenance and restored after confirmed recovery. At 1440px and 375px, use dense/long Unicode/HTML-looking fixtures, inspect screenshots, keyboard focus/links, Axe and zero horizontal page overflow. Ensure overlapping rows have unique IDs and counts never hide items. Exit: AC3–AC8/AC10 UI witnesses pass.

### Manual verification

Inspect real desktop and phone screenshots, urgent/missing/empty/error states and keyboard navigation. Confirm action deadlines are distinguished from expiration, missing-count overlap is understandable and no badge promises legal standing or text delivery. Record agent inspection separately from user acceptance.

## Phase 4: Regression gates, documentation and evidence

### Files and changes

- Update README only when the dashboard is implemented, describing counts/date boundaries, missing-end overlap, snapshot refresh, inactive SMS and E4-S1 next.
- Preserve the existing 32 layers in `tools/layers.json`/`tools/gauntlet.mjs`. New test files and source coverage are discovered automatically by `vitest.config.ts` and `tools/check-coverage.mjs`; only explicit mutation/property lists change. No SQL upgrade/mutant layer or generated-type change is justified.
- Write actual source-bound implementation evidence under proposed `thoughts/shared/research/2026-10-08-e3-s2-implementation-evidence.md`; update progress only after phase success.

### Automated verification

Use Node 24.21.0 (`PATH="$PWD/.tools/node/bin:$PATH"`) and configured `.browser-cache`. Run database resets/upgrades/mutations sequentially and only on the guarded dedicated local fixture stack documented in README.

| Commands                                                                | Required implementation result                                                                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` | Existing/new application checks pass.                                                                                                                                 |
| `npm run test:db`, `npm run test:integration`                           | Real role/isolation/read-preservation/correction witnesses and inherited DB tests pass.                                                                               |
| `npm run mutation`, `npm run mutation:properties`                       | Projection/date mutations killed with inherited 100% thresholds.                                                                                                      |
| `npm run build`, `npm run test:e2e`                                     | Production-local dashboard, calendar/detail and register recovery regressions pass.                                                                                   |
| `npm run gauntlet`                                                      | All 32 layers pass on a clean committed implementation checkpoint, including schema/types, full source coverage, shuffled tests and inherited upgrade/security gates. |
| Targeted Prettier with `--ignore-path /dev/null`; `git diff --check`    | Durable Markdown and resulting diff checked despite thoughts ignore.                                                                                                  |

The clean checkpoint is a later implementation requirement; this planning task creates no commit. Do not reuse prior release results as dashboard evidence. Exit: AC10 and all inherited gates pass on actual source.

### Manual verification

Review final scoped diff, actual screenshots, source-bound checks and truthful acceptance limits. Ensure schema/dependencies/authority and SMS remain unchanged. Deployment requires a later user instruction.

## Risks and rollback considerations

- Whole-register reads inherit duplicate-computation and practice-lock cost. Observe a dense fixture and record timings during implementation; retain pilot scope rather than promise unlimited scale. API/pagination changes require fresh planning.
- MissingEnd deliberately overlaps dated lists. Explicit section copy and count-to-list tests are essential; do not sum cards into a total or discard action-only risk.
- Past tracking may refer to an action deadline while end remains future. Preserve both dates/purpose and phrase urgency around tracking, avoiding incorrect expiration claims.
- Midnight changes urgency; saved snapshots update on fresh requests. One captured instant keeps each response consistent; no live browser refresh promise.
- No persisted workflow exists. Synthetic invariance tests protect current date-only logic; E5 must add a real in-progress/overdue integration/browser regression. This boundary is part of completion reporting.
- Read failure blocks summaries; zero counts are reserved for successful empty lists. Existing detail remains independently authorized on every request.
- App-only rollback restores the previous app build/navigation. Existing data/history/schema remain intact; no database rollback or production write is needed.

## Completion criteria

AC1–AC10 have executable witnesses within the documented workflow boundary; all four phases pass; the diff and visual output are reviewed; all 32 layers pass against the implemented source. Counts/list memberships agree with entered tracking dates, every unknown end remains actionable, access remains practice-scoped and reads preserve history. Document persisted progress acceptance as E5's future integration work, and user-confirmed acceptance separately. E4-S1 is the next P0 delivery story.

## Implementation progress

- [x] Phase 1: Urgency projection and independent date witnesses.
- [x] Phase 2: Authenticated route and record return navigation.
- [x] Phase 3: Dashboard presentation, entry links and browser acceptance.
- [x] Phase 4: Regression gates, documentation and evidence.
- [ ] User-confirmed manual acceptance, separate from automated/agent verification.

## Implementation verification log (2026-10-08)

Phases 1–3: full unit suite 270/270 in 38 files; targeted dashboard/calendar integration 9/9; targeted dashboard/calendar/maintenance browser regressions 16/16; types, lint and production build pass. Dashboard-only property mutation 100% (68 killed, 0 survivors, 33 compiler-invalid); independent Gregorian and generated boundary/order witnesses added. Agent inspected 1440px and 375px populated screenshots. Human manual acceptance remains unchecked. Phase 4 will report only final fresh source-bound gauntlet results in evidence.

Spec is at `thoughts/shared/plans/2026-10-08-e3-s2-old-coder-spec.md`, including append-only fixture/property clarifications. The shared error reset does not re-fetch a server snapshot; recovery witness uses a fresh request, matching the existing calendar contract. Source restoration after temporary faults and historical RED results are recorded at `thoughts/shared/research/2026-10-08-e3-s2-red-history.md`.

Phase 4 complete: fresh run `ba2dfac9-26c0-4b08-95b6-6988d64b9004` passed all 32 layers on `ca8c5fdcb92683f9a79d74b6155383b7dba27d78`, source SHA-256 `28e2f471536c536ae8bd56f8abd438ebfb4bd6b4a7a0bd0b443f799c105ad05c`. Final unit/API/browser counts: 270/107/48, shuffled suites also passed. All 1075 executable lines across 71 files covered. Both mutation selections detect every testable mutant; new dashboard properties independently kill all 68 executable dashboard mutants. Agent inspected fresh desktop/phone screenshots and reviewed the scoped diff. Supplementary local timing, test corrections, first failed attempt, and limits are preserved in `thoughts/shared/research/2026-10-08-e3-s2-implementation-evidence.md`. No pipeline layer skipped or weakened; no deployment performed. Human manual acceptance remains unchecked. E4-S1 phone enrollment is next.

## Hosted release (2026-10-08)

The later user instruction “push to prod” authorized the application release and normal main-branch finalization. READY deployment `dpl_ACPRtVEqMVtMkH3j8JUpfVoUAm7u` was promoted and independently confirmed on `license-radar.vercel.app`. The deployed archive matches the final successful gauntlet source. Read-only hosted dashboard/navigation and anonymous-access checks passed; the live register was empty, so populated hosted acceptance is not claimed. No schema, dependency or environment change was made. See `thoughts/shared/handoffs/2026-10-08-e3-s2-production-release.md`. Human manual acceptance remains unchecked.
