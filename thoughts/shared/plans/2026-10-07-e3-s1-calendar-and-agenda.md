# E3-S1: Unified Calendar and Agenda Implementation Plan

Date: 2026-10-07 (America/Los_Angeles).
Baseline: `1d80100e4088df16488fbc85d1ebddd8bae85e1f`.
Status: Planned; implementation has not started.
Research: `thoughts/shared/research/2026-10-07-e3-s1-calendar-and-agenda.md`.
Verification: `thoughts/shared/plans/2026-10-07-e3-s1-calendar-and-agenda-verification.md`.

## Overview

Deliver the next P0 story, E3-S1: “As a manager, I can view all renewal dates in one calendar and agenda so I can plan ahead.” Provide a month calendar, a readable agenda, combined clinician/type/jurisdiction filters, and an authenticated read-only credential detail page. Derive every event from the saved active credential cycle. Reuse the current read API; no database migration or new dependency is required.

`README.md:34` names this story next. The original backlog is `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md:185`; E3-S2 dashboard follows this story. The latest `thoughts/shared/handoffs/2026-10-07-e2-s3-production-release.md` reports E2-S3 released. Older documents' empty-workspace and create-only observations are historical.

## Current State

There is one Next.js/React/TypeScript application with Supabase Auth/PostgreSQL and Zod. Routes belong to `src/app/`, UI to `src/components/`, domain/persistence to `src/lib/`, database contracts to `supabase/`, and verification to `tests/`/`tools/`. There are no independent monorepo applications or calendar packages.

`getMaintenanceRegister` in `src/lib/register/repository.ts:97` reads validated credentials with owners, coverage, issuer/jurisdiction, initial cycle dates/revision, archive state, and advisory duplicate IDs. The maintenance SQL list excludes archived credentials unless explicitly requested, checks live membership, and isolates the practice. All active administrators, managers, and viewers can read.

`src/lib/register/dates.ts:trackingDate` chooses the earlier action deadline, otherwise expiration/coverage end. `RecordDates` in `src/components/register/register-panel.tsx:212` displays both dates and unknown values. There is no month arithmetic, calendar/agenda route, or credential detail route. `src/app/practice/register/page.tsx` supplies the route/auth/error pattern. The existing 32-layer verification pipeline and strict mutation/coverage gates remain in force.

## Desired End State

| ID   | Acceptance criterion                                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | Active state licenses, DEA registrations, and malpractice policies appear in both selected-month calendar and agenda from the same projection.                                                                                                                  |
| AC2  | Every entered end date and earlier action deadline has its own clearly labeled event; the effective tracking date is identified without inventing dates or reminder jobs.                                                                                       |
| AC3  | Clinician, credential type, and jurisdiction filters combine with AND semantics and survive month navigation, view changes, reload, browser back/forward, and detail/back navigation.                                                                           |
| AC4  | Clinician filtering matches direct ownership or covered clinicians on a practice policy; a shared policy produces one event per date purpose, never one per covered clinician.                                                                                  |
| AC5  | Previous/next month, direct month selection, and “This month” work across leap days and year boundaries. Today/current month use the practice timezone; saved date-only values never shift with browser timezone.                                               |
| AC6  | Event links open authorized read-only detail with title/type/owner/coverage/metadata, both dates, tracking purpose, and a register link. Foreign, missing, malformed, and newly archived IDs disclose no record.                                                |
| AC7  | Archived records produce no active events or undated entries after a fresh read. Saving a correction moves/removes the right events on fresh navigation/refresh; all retained history stays unchanged by reads.                                                 |
| AC8  | Records with both dates unknown remain in a separate filtered “Dates not entered” section across months; action-only records keep their unknown-end label and their real deadline event.                                                                        |
| AC9  | Desktop defaults to month and phone screens to agenda at the existing 700px breakpoint; either explicit view is available. Keyboard/screen-reader operation, textual purposes, long text, dense days, and 375px layouts are usable without horizontal overflow. |
| AC10 | Anonymous/no-practice/revoked/outsider requests respect existing route/API guards. Every active role can read. Read faults or malformed responses show retry/error UI, never a fabricated empty calendar or missing record.                                     |
| AC11 | Calendar/detail/filter reads create no rows, receipts, audits, or version changes. Existing register edit/archive recovery and navigation locks continue to pass.                                                                                               |
| AC12 | Existing checks plus calendar unit/property/API/browser witnesses pass, with source-bound implementation evidence and manual acceptance limits. SMS stays visibly inactive; dashboard, subscriptions, workflow, and dispatch remain separate stories.           |

## Key Discoveries

1. `supabase/migrations/20261007004303_register_maintenance.sql:130` already provides an authorized active list and complete date/coverage projections. Reusing it avoids a competing date store, read grants, or a new privileged function.
2. `maintenanceRegisterSchema` requires valid nullable archive state and coherent dates. Missing cycles are errors, not undated credentials. Preserve this boundary.
3. Existing date support spans `0001-01-01` through `9999-12-31`. Month helpers must support this range and handle years 1–99 without Date constructor remapping.
4. `RecordItem` already has `record-<UUID>` anchors. Detail can link to the existing editor instead of duplicating maintenance forms or mutation logic.
5. The practice timezone affects which day is today, not the saved date of an event. The server must supply one practice-local today value to both views.
6. `RegisterFeedback` suppresses view links during uncertain maintenance. Put the new register-to-calendar link within that same guard; a static page-level link would bypass the existing protection.
7. The proxy already covers new `/practice/` descendants and sets private/no-store headers. Test the resulting routes and use document-navigation event/detail links so clicking checks fresh authority rather than depending on a prefetched or client-cached record.

## What We Are Not Doing

- E3-S2 dashboard counts, due-within-60-days summaries, or an urgency/workflow subsystem. The basic undated section protects visibility in this story; dashboard prioritization is next.
- External calendar subscription/export/import, new credential types/fields, renewal URLs, attachments, protected identifiers, full history/audit screens, or clinician maintenance.
- Editing/archiving on the detail page, completing a renewal, successor cycles, reminder events 60 days earlier, phone enrollment, jobs/outbox, dispatch, cancellation, or fake SMS readiness.
- Database/schema changes, new calendar libraries, deployment, production writes, or committing implementation as part of this planning request.

## Implementation Approach

### Read and authorization boundaries

Add `/practice/calendar` and `/practice/register/[credentialId]` as `force-dynamic` server pages. Each uses `requireUser`, then `getPracticeAccess`, then `getMaintenanceRegister(client, access.practice.id, false)` in that order. Do not accept a practice ID from URL/search input. Access failure uses the existing safe error boundary; no active practice redirects to onboarding.

Calendar derives data only after a successful validated list. Detail validates UUID syntax after auth/access, reads the same fresh active list, and finds the normalized UUID within that result. Call `notFound()` for malformed/foreign/missing/archived records; a read failure throws instead. Add a segment `not-found.tsx` with neutral wording and fixed calendar/register links. This choice means archived detail links do not reveal archive status; existing archived register remains the history access point. No new repository or RPC is necessary.

Use ordinary document-navigation anchors for event/detail/back links so each click makes a fresh authenticated server request; disabling prefetch alone must not be treated as proof against client router cache reuse. Provide an explicit refresh link that fetches a current server snapshot, and label the page as a saved snapshot rather than promising real-time updates. A previously rendered page can remain visible until its next request, matching the existing access contract; do not claim revocation erases a loaded browser. Browser tests must prove subsequent navigation/reload is denied and a record archived after a stale calendar read cannot be opened from that link. Browser history may restore a prior snapshot; explicit refresh must check current authority/data.

### Event projection and dates

Create a pure calendar module with `projectCalendar`, `matchesCalendarFilters`, `parseCalendarQuery`, `calendarHref`, `practiceToday`, and bounded month-grid/navigation helpers. These are proposed symbols in proposed `src/lib/calendar/` files, not current APIs.

Input is a `MaintenanceRegister` snapshot; defensively exclude non-NULL `archived_at`. Each remaining credential produces an end-date event when present and an action-deadline event when present. Store event ID as `<cycle UUID>:<end|action>`, credential/cycle ID, date revision, date string, date-purpose enum, type/title/owner, and whether this is the `trackingDate` event. Metadata changes regenerate display data; date edits change the date/revision without multiplying identities. Two entered purposes represent two dates on one cycle, not two reminders. Suspected duplicate credentials remain distinct records; never silently merge them.

Reuse `trackingDate`, `formatCredentialDate`, `detailLabels`, and `typeLabels`. Format date labels from components. Compute server-side today with injected instant plus practice IANA timezone, using Gregorian/Latin `Intl.DateTimeFormat(...).formatToParts`; do not rely on a locale-formatted string's punctuation. Capture now once per page response and pass the resulting day to all views. Invalid timezone is an unavailable configuration error, never silent browser/UTC fallback.

Month values are exact `YYYY-MM`, years 0001–9999. Use pure Gregorian arithmetic or UTC methods with `setUTCFullYear` for weekday calculation; never parse date-only values as local instants. Month membership uses the date's year/month, not elapsed milliseconds. Calendar weeks begin Sunday with labeled weekday headings. Render leading/trailing blank cells rather than adjacent-month events; stop previous/next links at the minimum/maximum month. “This month” preserves filters and uses the current practice-local month. Mark today with text/`aria-current="date"`, without introducing urgency labels.

Filter first, then project/group events. Sort by date, then title using deterministic code-point comparison, credential UUID, and purpose. The same selected-month event sequence feeds both views. Sort undated records by title/UUID, independent of month. A record with end and action unknown appears once there; a record with action only appears in the agenda and identifies the unknown expiration/coverage end. Neither path invents a date. Missing-cycle API failure is not an undated item.

### Filter and navigation contract

URL state: `month`, optional `view=month|agenda`, optional `clinician=<UUID>|practice`, optional `type=<existing type enum>`, and optional `jurisdiction=unknown|value:<exact saved text>`. Prefixing actual jurisdiction values distinguishes a literal “unknown” jurisdiction from a NULL value. Use `URLSearchParams` for all encoding; preserve spaces, Unicode, ampersands, and slashes safely. Missing values mean all; unknown query keys are ignored and never become authority or SQL inputs.

Clinician UUID matches owner ID OR covered ID, once per credential. The `practice` option matches practice ownership. Jurisdiction matching is exact saved text; NULL has a “Jurisdiction not entered” option. Type matches the existing enum. Combined filters use AND. Build options from the successfully authorized active snapshot and its clinician list, not from the selected month/filtered results. Clinicians with no events remain selectable; foreign/stale UUIDs cannot populate names or broaden the result set.

Resolve repeated query values as invalid, not first-value wins. Invalid/repeated/overlong filters show a neutral filter warning and no filtered results until cleared. Syntactically valid stale clinician/jurisdiction values also yield no matches and a clear/reset path. Invalid/repeated month falls back to practice-local current month with visible notice; invalid/repeated view uses responsive default with notice. Do not display raw invalid values. Bound scalar length before validation; jurisdiction saved text is at most 120 Unicode code points plus prefix. No arbitrary `returnUrl` parameter.

GET filter form, month links, view links, and reset links serialize the same validated query state. When filters are invalid, suppress month/view/This-month links until the user applies valid filters or explicitly clears them; the serializer must never drop an invalid filter and silently show all records. Reset clears filters and retains month/view; “This month” changes only month. Detail links carry those validated parameters; the back link rebuilds a fixed `/practice/calendar` URL through the same parser/serializer. This preserves context without permitting an external redirect. Explicit views survive viewport changes. When `view` is omitted, render month and agenda containers with mutually exclusive responsive CSS: month above 700px, agenda at/below 700px. Hidden view must be `display:none` so its links leave the accessibility tree/tab order; IDs must be unique if both DOM structures exist.

### Interface and navigation

Keep current Shell and visual tokens. Add named calendar controls/filters, a month heading/timezone label, calendar and agenda view links, and clear empty states: no active records, no matching dates this month, and invalid filters. Offer a register link for adding/correcting records. Display “Text reminders are not active yet.” on calendar/detail.

Use semantic table/caption/weekday headers and ordinary event links for month view; do not claim an interactive ARIA grid requiring a separate keyboard widget. Agenda groups by date with `<time dateTime>` and descriptive event links naming title, owner, type, and purpose. Dense days show all events with wrapping; do not silently truncate dates. On a phone, even an explicitly selected month view must wrap without page overflow, and the agenda switch remains easy to reach.

Extract `RecordDates` and its DateText helper into proposed `src/components/register/record-dates.tsx` so register and server detail share markup without importing the client register panel. Preserve existing content and validation/recovery behavior with regressions. Detail is read-only and links to `/practice/register#record-<UUID>` for managers/admins (and “View in register” for viewers). Keep edit controls solely in the existing register. Add calendar navigation in practice settings and inside `RegisterFeedback`'s unlocked branch; do not add an unguarded link on the register page.

## Phase 1: Calendar projection, dates, and query state

### Files and changes

- Add proposed `src/lib/calendar/events.ts`, `dates.ts`, and `query.ts` with the pure symbols/contracts above; use existing register types/labels/date helpers.
- Add proposed `src/lib/calendar/events.test.ts`, `dates.test.ts`, `query.test.ts`, and `properties.test.ts`. Include independently computed expected sets, not snapshots of helper output.
- Extend `stryker.config.mjs`, `stryker.properties.config.mjs`, and `vitest.properties.config.ts` to cover new pure modules and property suite with inherited thresholds intact.

### Automated verification

Run `npm test -- src/lib/calendar src/lib/register/dates.test.ts`, `npm run typecheck`, and `npm run lint`. Witness all types/owner kinds, zero/one/two dates, two purposes across different months, archive exclusion, policy coverage matches without multiplication, duplicate credentials kept distinct, AND filters, NULL/literal-unknown jurisdiction distinction, deterministic ties, stable IDs, immutable inputs, and parser/serializer round trips.

Cover leap centuries, month starts/ends, 0001 and 9999 edges, years below 100, adjacent-month exclusion, practice-local midnight near UTC date boundaries, DST changes, invalid timezone, contrasting browser/TZ environments, repeated/invalid/overlong query values, Unicode encoding, stale filter choices, and injection-looking text treated only as text. Property tests independently compare projected event sets and calendar weekdays against a UTC oracle initialized with `setUTCFullYear`. Exit: AC1–AC5/AC8 domain witnesses pass.

### Manual verification

Review exact date/identity/filter semantics against register helpers and fixtures. Check that no projection imports persistence/mutation code or derives a guessed reminder day.

## Phase 2: Authenticated calendar and credential detail reads

### Files and changes

- Add proposed `src/app/practice/calendar/page.tsx`, `src/app/practice/register/[credentialId]/page.tsx`, and segment `not-found.tsx` with the read/guard order above.
- Extract proposed `src/components/register/record-dates.tsx`; update `register-panel.tsx` import only for date markup in this phase.
- Extend `tests/unit/routes.test.tsx` with calendar/detail boundary mocks, including `notFound`; add proposed `tests/integration/practice-calendar.test.ts` using real `getMaintenanceRegister` plus projection.

### Automated verification

Run `npm test -- tests/unit/routes.test.tsx src/lib/calendar` and `npm run test:integration -- tests/integration/practice-calendar.test.ts tests/integration/practice-register-maintenance.test.ts` on the dedicated local fixture stack. Cover every role, authentication redirect, missing practice, access/read outage, malformed API response, missing cycle, UUID normalization, own active detail, and identical missing/foreign/archive not-found behavior. Assert practice IDs come solely from access, no client-provided practice/query data reaches read authority, and detail does not trust an event payload.

Create two practices, shared policies, all date/type combinations through real checked RPCs. Assert read snapshots preserve complete credential/cycle/coverage/audit/create/change-receipt row sets. Edit/archive via existing RPCs, reread through repository/projection, and verify events move/disappear and undated entries update. Revoke a manager and retry the real read with the retained access token; denial is required. Exit: AC6–AC8/AC10–AC11 read witnesses pass.

### Manual verification

Inspect server props/private-field stripping, error-versus-not-found decisions, dynamic routing and protected caching. Ensure the shared dates extraction does not pull client maintenance state into detail.

## Phase 3: Responsive calendar, agenda, filters, and navigation

### Files and changes

- Add proposed `src/components/calendar/calendar-panel.tsx`, `month-calendar.tsx`, and `calendar-agenda.tsx`; use server-renderable native GET forms/document links, and an ordinary same-query refresh anchor. No client refresh module is needed.
- Add proposed `tests/unit/calendar-views.test.tsx` and `tests/unit/record-dates.test.tsx`; extend `tests/unit/routes.test.tsx` to cover practice-settings navigation.
- Update `src/app/globals.css` with scoped calendar styles/breakpoints, `src/app/practice/page.tsx` navigation, and `register-panel.tsx:RegisterFeedback` with guarded calendar navigation.
- Add proposed `tests/e2e/practice-calendar.spec.ts` using existing protected browser/coverage helpers and real saved fixtures.

### Automated verification

Run `npm test -- tests/unit/calendar-views.test.tsx tests/unit/record-dates.test.tsx tests/unit/routes.test.tsx`, `npm run build`, and `npm run test:e2e -- tests/e2e/practice-calendar.spec.ts tests/e2e/practice-register-maintenance.spec.ts`. Browser witnesses cover all types/date purposes, direct/covered/practice ownership, combined filters, empty/undated/action-only records, month navigation and direct selection, URL reload/back/forward, both views, detail/back context, viewer access, and register editing links.

Use two sessions: render a calendar, edit or archive the item in another session, then refresh/open the stale link. Date corrections must replace earlier event dates; archive must remove all purposes/undated entries and stale detail must be not-found. Test revocation before navigation/reload, anonymous direct URLs, same-role foreign detail IDs, API interruption/recovery, and missing-cycle errors without fabricated emptiness. Check private/no-store headers on both new routes. Frozen register edit/archive uncertainty must hide the new calendar link, then restore it only after confirmed recovery.

At 1440px and 375px, test responsive default, explicit override, view-equivalent event sets, dense same-day events, long/Unicode text, keyboard filters/links, focus, and Axe; require zero horizontal overflow. Use browser contexts in Honolulu/Tokyo against a differing practice timezone; freeze server-side clock through injected domain instants/unit tests rather than pretending the browser clock controls server rendering. Capture safe fixture screenshots for actual visual inspection. Exit: AC3/AC5–AC11 UI witnesses pass.

### Manual verification

Inspect desktop month, phone agenda, explicit phone month, event detail, empty/undated/filter/error views, and keyboard navigation. Confirm both purposes remain recognizable and the tracking label is clear. Record agent visual checks separately from user acceptance.

## Phase 4: Regression gates and implementation evidence

### Files and changes

- Update `README.md` with implemented calendar/detail/filter/date/archive scope, snapshot refresh behavior, inactive SMS, and E3-S2 next; link new implementation evidence.
- Preserve `tools/layers.json`/`tools/gauntlet.mjs`'s 32-layer inventory: existing test discovery covers this story. Preserve schema fingerprint/generated types unchanged because there is no schema change. No new upgrade tool or SQL mutant is justified by read-only application code.
- Verify new modules/pages/components participate in existing full coverage and expanded mutation/property inventories; do not lower gates or exclude new files.
- Write actual source-bound evidence under `thoughts/shared/research/2026-10-07-e3-s1-implementation-evidence.md` during implementation, and update progress below only after each phase passes.

### Automated verification

Use Node 24.21.0 via `PATH="$PWD/.tools/node/bin:$PATH"`. Database resets, upgrades, and mutation rehearsals must run sequentially and only in the guarded dedicated local fixture stack described in README.

| Commands                                                                | Required implementation result                                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` | Existing and new application checks pass.                                                                                                                 |
| `npm run test:integration`, `npm run test:db`                           | Real read/archive/access/row-preservation witnesses and inherited DB tests pass.                                                                          |
| `npm run mutation`, `npm run mutation:properties`                       | New projection/query/date mutations are killed with inherited 100% thresholds.                                                                            |
| `npm run build`, `npm run test:e2e`                                     | Full production-local route/calendar/detail/register browser regressions pass.                                                                            |
| `npm run gauntlet`                                                      | All 32 layers pass on a clean committed implementation checkpoint, including inherited resets/upgrades/schema/types/coverage/shuffled-order/secret gates. |
| Targeted Prettier with `--ignore-path /dev/null`; `git diff --check`    | Planning/evidence Markdown actually checked despite thoughts ignore; diff clean.                                                                          |

The clean checkpoint requirement is an implementation gate, not permission to create a commit in this planning task. Do not reuse E2-S3's successful run as E3 evidence or claim hosted acceptance from local results. Exit: AC12 and all inherited gates pass against the actual implemented source.

### Manual verification

Review the resulting diff for scoped files, source-bound results, preserved navigation/recovery behavior, and no schema/authority/SMS changes. Review safe screenshots and record remaining user-confirmed acceptance explicitly.

## Risks and rollback considerations

- Whole-register reads reuse the pilot's existing API, including duplicate computation and a practice lock. Large inventories may need measured pagination/index/query optimization later; this plan does not promise unlimited scale. Exercise a dense fixture and record observed timings before deciding to change the API.
- Distinguishing two date events from one tracking date is essential to avoid confusion with reminder scheduling. Label each purpose and the tracking role; counts in E3-S2 must count credentials rather than accidentally count date events twice.
- Date-only semantics, years below 100, local today, and server/client hydration are common failure points. Inject instant inputs and use one server snapshot rather than client clock/viewport guesses.
- An unavailable aggregate read intentionally blocks detail too. A per-record RPC may later improve scaling/fault isolation, but a broken list must never be mistaken for not-found in this slice.
- Existing access behavior revokes future requests, not pixels already loaded. Use document links for fresh requests, test them, and avoid persistence/browser storage or real-time claims.
- No data migration/write occurs. Application rollback simply restores the previous application build and removes navigation to new routes; existing records/history/schema stay intact. Deployment is a later separately requested action.
- Original E2-S3 event-exclusion acceptance is covered here; its job cancellation/invalidation remains E4. This story is not the complete MVP or reminder feature.

## Completion criteria

AC1–AC12 have executable witnesses; all four phases pass; the final diff is reviewed; all 32 implementation layers pass; actual visual inspection and user acceptance boundaries are recorded. Calendar and agenda agree with saved active cycle dates, every event opens tenant-authorized detail, and archive removes active dates without deleting history. E3-S2 is next.

## Implementation progress

- [x] Phase 1: Calendar projection, dates, and query state.
- [x] Phase 2: Authenticated calendar and credential detail reads.
- [x] Phase 3: Responsive calendar, agenda, filters, and navigation.
- [x] Phase 4: Regression gates and implementation evidence.
- [ ] User-confirmed manual acceptance, separate from automated/agent verification.
