# E3-S1 calendar and agenda research

Date: 2026-10-07 (America/Los_Angeles).
Baseline: `1d80100e4088df16488fbc85d1ebddd8bae85e1f`; working tree clean at inspection.
Scope: evidence for planning only; no runtime or database changes.

## Story selection and repository overview

`README.md:34` explicitly names E3-S1 next. The original backlog at `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md:185` requires all three credential types, clinician/type/jurisdiction filters, labeled date purposes, authorized event detail, and a phone-sized agenda. E2-S4 is optional P1 CSV import; E3-S2 is the subsequent P0 dashboard. The latest release record, `thoughts/shared/handoffs/2026-10-07-e2-s3-production-release.md`, reports register maintenance deployed and SMS/calendar still future work. These are repository release records, not a new hosted inspection.

This repository contains one Next.js/React/TypeScript application, not multiple monorepo applications. `src/app/` owns routes/actions; `src/components/` owns interface state and rendering; `src/lib/` owns domain validation/authentication/persistence; `supabase/` owns PostgreSQL migrations and access rules; `tests/` and `tools/` own verification. No calendar package, calendar route, detail route, worker, or outbox exists in the inspected source inventory.

## Existing data and access contracts

- `src/lib/register/schema.ts:credentialSchema` validates all three types, owner identity/name, covered clinicians, issuer/jurisdiction, version, and initial `current_cycle` with Gregorian date strings and date revision. It deliberately requires `cycle_number: 1`; successor-cycle support belongs to later renewal work.
- `maintenanceRegisterSchema` adds required nullable `archived_at` and advisory duplicate IDs. Invalid/missing cycle shapes are unavailable rather than fabricated empty data.
- `src/lib/register/repository.ts:97`, `getMaintenanceRegister`, calls `list_practice_register_with_maintenance` with an explicit include-archived flag and validates/strips the response through that schema. SQL returns one aggregated JSON object, without a table-result pagination limit in this code.
- `supabase/migrations/20261007004303_register_maintenance.sql:130` filters credentials by practice and, for `false`, by `archived_at IS NULL`. It performs `private.require_register_member(practice,false)` before returning owners, dates, coverage, or candidates.
- `supabase/migrations/20261006180010_register_ownership.sql:private.require_register_member` locks the practice, then checks active membership. All active roles can read. SQL wrappers are public security invokers; checked implementations are private security definers. Calendar work can reuse these without adding grants/views/functions.
- `src/lib/auth/require-user.ts:requireUser` checks the current user; `src/lib/practice/access.ts:getPracticeAccess` resolves the current practice and live membership role. The practice ID must come from this access result, never a URL parameter.
- `src/app/practice/register/page.tsx` models dynamic authenticated reading, no-practice onboarding redirect, and safe unavailable errors. `src/proxy.ts` already covers `/practice/:path*`; `src/lib/supabase/session.ts:updateSession` supplies private/no-store headers. New nested routes need tests of these protections, not a speculative proxy change.

## Dates and interface reuse

`src/lib/register/dates.ts:isCredentialDate` accepts exact Gregorian dates from year 0001 through 9999. `formatCredentialDate` formats components without timezone conversion. `trackingDate` chooses action deadline first, otherwise expiration/coverage end. `detailLabels` distinguishes expiration from policy coverage end. Calendar day arithmetic must preserve that full range and avoid JavaScript's special handling of years 0–99 in multi-argument Date construction.

`src/components/register/register-panel.tsx:RecordDates` already shows both entered dates, unknown end dates, and which date tracks the record. `RecordItem` has a stable `record-<UUID>` anchor; editing/archive controls remain in that register. `RegisterFeedback` hides active/archived navigation while an uncertain maintenance request is frozen. Any new calendar link placed there must obey the same lock, so it does not create an unguarded exit from an uncertain save. `retainCredentialReplies` retires historical active replies after an authoritative archive read; calendar must use a fresh list, not mutation receipts or a second optimistic cache.

The design's “all renewal dates” can be met by one event per entered date purpose: end date and optional earlier deadline. This is a resolved planning choice, not existing behavior. Two events on one credential do not represent two reminder jobs. A shared policy stays one event per purpose, including when a clinician filter matches coverage.

`src/app/globals.css` supplies the existing paper/green palette, serif headings, panels, focus outlines, and 700px phone breakpoint. Responsive calendar/agenda selection can use CSS without deriving a different first render from browser time or viewport.

## Verification patterns and constraints

- `tests/unit/routes.test.tsx` mocks auth/access/read boundaries and checks every role, redirects, outages, and malformed archive queries. Extend with calendar/detail guards and not-found mocks.
- `src/lib/register/dates.test.ts` has independent UTC date oracles, leap-century tests, year boundaries, unknown-date cases, and contrasting timezones. Model new calendar properties after these rather than testing helpers against themselves.
- `tests/integration/practice-register-maintenance.test.ts` exercises real authenticated RPCs, shared coverage, active/archive filtering, complete row snapshots, missing cycles, and live authority. New calendar integration should call the real repository and pure projection together, with fixture writes through existing checked RPCs.
- `tests/e2e/practice-register-maintenance.spec.ts` uses real sign-in, multiple sessions, mobile/Axe checks, and date displays in contrasting browser timezones. `tests/helpers/private-browser.ts` and `tests/helpers/coverage.ts` supply protected artifact handling and browser coverage; reuse them.
- `vitest.config.ts` discovers new unit/integration tests by glob; `playwright.config.ts` discovers new browser specs and serializes the production-local suite. `vitest.properties.config.ts` and both Stryker configs use explicit inventories and must include new pure calendar modules/properties.
- `tools/layers.json` and `tools/gauntlet.mjs` contain 32 required layers. A read-only application story needs no added migration-upgrade layer. `tools/check-coverage.mjs` inventories every application source file and requires all executable lines covered; new pages/components must participate normally.
- Default shell Node is 26.3.0. Existing `.tools/node/bin/node` is 24.21.0, matching `.nvmrc` and README; use that runtime for verification.
- `.prettierignore` excludes `thoughts/`; use targeted Prettier with `--ignore-path /dev/null` to actually check the new planning artifacts.

## External documentation checks

Official [Supabase database function documentation](https://supabase.com/docs/guides/database/functions) and [row-level security documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) support retaining checked RPC execution and live tenant authorization. Official [Next.js page documentation](https://nextjs.org/docs/app/api-reference/file-conventions/page) and [notFound documentation](https://nextjs.org/docs/app/api-reference/functions/not-found) support asynchronous route/search parameters and a segment not-found boundary. The proposed architecture is an inference combining those contracts with the inspected code; installed package compatibility remains an implementation test obligation.

The Supabase changelog Markdown reader rejected its content type; a shell fallback could not resolve the host. No successful changelog review is claimed. Recheck it before any implementation change to Supabase contracts; this plan introduces none.

## Remaining acceptance boundaries

E3-S1 will fulfill E2-S3's active-event archive exclusion through actual calendar witnesses. E4 must still implement and verify unsent-job invalidation/cancellation, eligible recipients, and dispatch. E3-S2 must supply the urgency dashboard and counts. No production write, external calendar feed, scheduling, full audit/history UI, or renewal completion is needed for this story.
