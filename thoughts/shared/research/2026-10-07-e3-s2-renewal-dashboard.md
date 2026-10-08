# E3-S2 renewal dashboard research

Date: 2026-10-07 (America/Los_Angeles).
Baseline: `cc1088da1382f50cf1d4301db25d9f19073c9f95`.
Purpose: current implementation evidence for planning the next story; no application changes.

## Story selection and repository boundaries

`README.md:34` explicitly names E3-S2 next. The latest release record, `thoughts/shared/handoffs/2026-10-07-e3-s1-production-release.md`, records calendar/agenda deployment and leaves dashboard and reminders as future work. The original backlog in `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md`, section E3, defines E3-S2: show due, past-due, and missing-date items; counts/lists agree; progress cannot hide overdue dates; badges use text. That document's empty-workspace findings are historical.

This is one Next.js/React/TypeScript application, not a multi-application monorepo. `src/app/` owns routing/server actions; `src/components/` owns presentation/forms; `src/lib/` owns domain rules and persistence adapters; `supabase/` owns database contracts; `tests/` and `tools/` own verification. `thoughts/shared/` holds durable evidence and plans. No dashboard module or route exists in the inspected file inventory.

## Verified read and date contracts

- `src/lib/register/repository.ts:97`, `getMaintenanceRegister`, invokes `list_practice_register_with_maintenance` and validates the response through `maintenanceRegisterSchema`. Errors distinguish forbidden/unavailable from success. Reuse this adapter without new RPCs.
- `supabase/migrations/20261007004303_register_maintenance.sql`, `private.list_practice_register_with_maintenance`, checks live practice membership through `require_register_member` and excludes archived credentials unless explicitly included. Its projection includes owner, coverage, dates/revision, archive state and duplicate IDs. Dashboard reads can use `p_include_archived=false` and defensively exclude archived rows again in the pure projection.
- `src/lib/register/schema.ts`, `credentialSchema`/`maintenanceRegisterSchema`, requires a valid initial current cycle, exact date-only strings and an action deadline strictly earlier than the end when both exist. Dates may independently be NULL. Missing cycles are read errors, not missing-date records. The schema has no persisted workflow/completion status.
- `src/lib/register/dates.ts:28`, `trackingDate`, chooses entered action deadline before entered expiration/coverage end. `isCredentialDate` accepts years 0001–9999. `formatCredentialDate` formats components without browser timezone conversion.
- `src/lib/calendar/dates.ts:3`, `practiceToday(timezone, instant)`, computes one Gregorian practice-local date from an explicit instant. Invalid zone/instant throws. Reuse it rather than a browser clock or timezone.
- `src/lib/calendar/events.ts`, `projectCalendar`, produces one event per entered date purpose in a selected month, with one shared-policy event per purpose regardless of coverage size. It separately lists records with both dates NULL. A dashboard must classify records over the whole active snapshot, not count selected-month events.
- `src/components/register/record-dates.tsx`, `RecordDates` and `DateText`, already shows both purposes, tracking date and explicit unknown end labels. It can be reused in dashboard rows.

## Routes and navigation

`src/app/practice/calendar/page.tsx:11` reads user, live access and authorized active register in sequence, throws on read failures and redirects absent access to onboarding. It supplies a saved-snapshot explanation, practice timezone, refresh navigation and truthful inactive-SMS copy. `src/proxy.ts` covers `/practice/:path*`; `src/lib/supabase/session.ts` sets private/no-store headers. `src/lib/practice/access.ts` checks active membership, and `src/lib/auth/require-user.ts` verifies the user.

`src/app/practice/page.tsx` is settings; `src/app/page.tsx` still redirects authenticated accounts there. Add a separate dashboard entry without changing landing/onboarding behavior. `src/components/register/register-panel.tsx:266`, `RegisterFeedback`, hides register/calendar navigation during pending or uncertain maintenance. A dashboard link belongs in the same unlocked branch.

`src/app/practice/register/[credentialId]/page.tsx:17`, `CredentialDetail`, validates UUID, rereads active records under current access and uses neutral not-found for absent/foreign/archived IDs. It currently always returns to calendar, rebuilding validated calendar query state. A fixed `from=dashboard` marker can add a dashboard return path without arbitrary return URLs or weakening guards. The segment's `not-found.tsx` uses fixed return links and can offer dashboard navigation too.

## Resolved planning choices

Classify one active credential by its effective tracking date: past due (< today), due today (= today), due soon (1–60 calendar days), later (>60), or no tracking date (both dates NULL). The visible due-within-60-days list includes today. Counts derive from the same list arrays. Two dates and policy coverage must never multiply a record count. Similar records with distinct IDs remain distinct.

Use a separate missing-end list for every active record whose expiration/coverage end is NULL, including action-only records. This list intentionally overlaps dated urgency lists when a real action deadline exists; disclose the overlap instead of presenting an additive action total. Both-NULL records remain here with “Dates not entered.” Action-only records retain the real deadline and its urgency. The calendar's undated section keeps its established both-NULL meaning.

Dashboard reads the full practice without new filters. Calendar filters remain unchanged. No workflow columns/controls are added: urgency depends only on current cycle dates and archive eligibility. Persisted “in progress” acceptance requires the future E5 workflow; this story can establish date-only independence with synthetic extra-status property cases and document the future integration regression.

## Verification patterns inspected

The discovery agent fully read `tests/unit/routes.test.tsx`, `tests/unit/calendar-views.test.tsx`, `tests/integration/practice-calendar.test.ts`, `tests/e2e/practice-calendar.spec.ts` and `tests/helpers/private-browser.ts`. Existing patterns include hoisted boundary mocks, every active role, neutral not-found, retained revoked tokens, two practices, read-only snapshots of six register-related tables, real correction/archive rereads, outages/missing-cycle recovery, no-store headers, browser timezone contexts, Axe, dense Unicode fixtures and 1440px/375px visual checks. Primary-agent reads additionally covered calendar pure/date/property tests and shared date markup tests.

`vitest.config.ts` discovers new domain/unit/integration tests and source coverage automatically. `tools/check-coverage.mjs` walks all source and requires full executable statement coverage merged with real browser/Node coverage. Both Stryker configs explicitly list mutation files with 100% thresholds. `vitest.properties.config.ts` explicitly lists property suites. Extend those three inventories for the new projection; the existing 32 layers in `tools/layers.json`/`tools/gauntlet.mjs` cover app-only changes. `package.json` supplies phase commands and `.nvmrc` pins Node 24.21.0. `.prettierignore` ignores thoughts, so planning Markdown requires an explicit ignore override.

## External documentation check

The Supabase skill's changelog fetch was attempted; the browsing service could not render its Markdown content type. No changelog completeness is claimed. Official [JavaScript RPC documentation](https://supabase.com/docs/reference/javascript/rpc) and [row-level security documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) were consulted for the existing database function/access model. The design above is based on inspected local implementation. No Supabase signature, schema, grant, policy or client convention change is proposed; recheck current docs before any such change during implementation.

## Inspection limits

The starting working tree was clean. Research used file inventory, complete relevant source/document reads, symbol searches and Git status/history. No application suites, database queries, production operations or acceptance checks were run for the proposed dashboard. This planning task will add research, implementation plan and verification documents only.
