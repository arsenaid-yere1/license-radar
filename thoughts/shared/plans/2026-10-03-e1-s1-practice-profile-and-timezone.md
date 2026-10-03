# E1-S1: Create Practice Profile and Timezone Implementation Plan

Date: 2026-10-03
Status: Planning only; implementation has not started.
Confirmed by user: first story is the original E1-S1; foundation is Next.js + Supabase authentication and database.

## Overview

**Story:** As a practice administrator, I can create a practice profile and configure its timezone so future obligation dates and reminders use the correct local time.

Deliver one small, complete flow: email sign-in → practice setup → saved practice settings. This is the foundation for the expanded product covering practice, facility, clinician, payer, and payment-security obligations. The practice profile is a tenant container, not a legal-entity registration and not an automatically generated compliance inventory.

The first account that creates a practice is its administrator through database ownership. Staff invitations and membership roles remain E1-S2. No obligation-management or browser-agent implementation belongs in this story.

## Current State

- The workspace contains only `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md` before this plan is added. That file was read completely.
- No application, package manifest, Supabase configuration, migrations, tests, or Git metadata exists.
- The original research document defines E1-S1 under “E1 — Practice setup and access,” and lists `Practice` under “Proposed data model.” Its three-credential product scope predates the user's expanded practice-obligation scope. This plan preserves E1-S1 while adopting that broader product context.
- Node and npm are available: inspection returned Node `v26.3.0` and npm `11.16.0`. Docker is on PATH; its daemon has not been tested. Supabase CLI is not on PATH.
- There are no existing source symbols, conventions, migrations, or executable checks to reuse. Every application path and symbol below is proposed, not an existing file.

## Desired End State

### User experience

1. An unauthenticated visitor reaches `/login` and requests an email one-time code.
2. After successful verification, an account without a practice reaches `/onboarding/practice`.
3. The form requests **practice name** and **practice timezone**. The browser timezone is a suggestion; the user can change it before saving. Use UTC only as a displayed fallback if detection fails.
4. Saving creates one practice owned by the authenticated account and opens `/practice` with the saved profile.
5. Returning users open their existing practice directly. They can edit its name and timezone from that page.
6. Show a plainly labeled, illustrative reminder preview at the future default of 09:00 local time. Example: an entered due date of December 2, 2026 would produce a 60-day reminder on October 3, 2026 at 09:00 in the selected timezone. The preview sends nothing and does not imply that notifications are enabled.
7. Signing out removes the browser's session; protected routes require sign-in again. Editing settings never displays another practice's data.

### Acceptance criteria

| ID | Behavior | Required result |
| --- | --- | --- |
| AC1 | Request and verify email sign-in | Only verified authentication reaches practice setup; invalid/expired codes have a retry path. |
| AC2 | Create profile | A trimmed practice name of 1–120 characters and a supported IANA timezone are required; valid values persist. |
| AC3 | Invalid input | Blank/overlong name and unknown timezone are rejected server-side; useful field errors appear and input is preserved. |
| AC4 | Reminder preview | The example displays the selected timezone, local date, and 09:00 default; it is explicitly illustrative and creates no job/message. |
| AC5 | Persistence | Refreshing and signing in again return the same saved practice and timezone. |
| AC6 | Administrator ownership | Account identity determines ownership; submitted IDs, roles, or user metadata cannot assign ownership. |
| AC7 | Isolation | Account A and account B can each create a practice; neither can read or change the other's practice through the UI, server actions, or direct Data API calls. Signed-out access is denied. |
| AC8 | Duplicate creation | Double-click, request retry, and two simultaneous setup submissions create at most one practice per account; existing saved values are not overwritten by a retried create. |
| AC9 | Settings update | Owner can edit name/timezone; changes persist and are audited. A stale settings version produces a conflict rather than overwriting newer values. |
| AC10 | Failure recovery | Database/auth outages do not display success or fabricate a profile. Retry preserves input. Failed audit writes also roll back the profile change. |
| AC11 | Accessible form | Inputs have labels; errors are associated with fields; keyboard navigation works; pending save disables repeated clicks; mobile width has no horizontal overflow. |

## Key Discoveries

### Product and repository evidence

- The existing research document supplies the original story and proposes practice-scoped authorization. No implementation facts can be inferred from its architecture tables.
- The user explicitly selected practice setup over obligation entry, and explicitly selected Next.js + Supabase. These are resolved decisions.
- Broader obligations require future entity/location/clinician associations. This story collects none of their sensitive identifiers and makes no applicability or compliance determination.

### Current technical references

- Next.js App Router installation and current runtime requirements: [official installation guide](https://nextjs.org/docs/app/getting-started/installation). Choose Node 24 LTS and Next.js 16 for this plan, pinning compatible patch versions during scaffolding. Record the runtime in `.nvmrc` and `package.json` engines. The [Node release table](https://nodejs.org/en/about/previous-releases) lists Node 24 as LTS and Node 26 as Current; do not silently depend on the host's Node 26 installation.
- Supabase email OTP enrollment: [passwordless email guide](https://supabase.com/docs/guides/auth/auth-email-passwordless). Adopt one-time code entry, configure the email template to include the code, and use `signInWithOtp` / `verifyOtp` through a cookie-aware server client. No OAuth providers or password recovery flow are needed for this slice.
- Supabase SSR session setup: [cookie-based client guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs). Use the documented browser/server clients and token-refresh hook appropriate to the pinned Next.js version. Validate identity server-side; a locally read session is not an authorization source.
- Supabase database access: [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Data API security guide](https://supabase.com/docs/guides/api/securing-your-api). Explicit grants and row policies both matter; do not rely on inherited platform defaults.
- Current auth/database changes: [Supabase changelog](https://supabase.com/changelog). The markdown index could not be fetched through the web tool, and a shell fallback failed DNS resolution; the HTML changelog and current guides were reviewed instead. Data API exposure defaults are changing, which reinforces explicit grants. SAML-specific changes do not apply to this email-OTP slice. Refresh relevant release notes when implementation pins dependencies.
- Testing choices follow official [Next.js Vitest guidance](https://nextjs.org/docs/app/guides/testing/vitest) and [Playwright guidance](https://nextjs.org/docs/app/guides/testing/playwright). Test pure validation helpers with Vitest and server-rendered workflows through browser tests rather than pretending unit tests execute async server components.

These are technology references, not proof that an application or database has already been configured.

## What We Are Not Doing

- Obligation entry, automatic obligation discovery, regulatory rule catalogs, or applicability questionnaires.
- Clinician, legal-entity, location, payer, or merchant-account management.
- Staff invitations, shared memberships, multiple owned practices per account, ownership transfer, or practice deletion.
- SMS enrollment, reminder delivery, background jobs, external calendar feeds, or actual reminder scheduling.
- Document uploads, browser agents, portal credentials, payments, attestations, or submission automation.
- Billing, production deployment, cloud project provisioning, or sending messages to third parties during planning.

## Implementation Approach

### Chosen foundation

- One Next.js 16 App Router application at the repository root; Node 24 LTS, TypeScript, and npm with a committed lockfile. Keep `thoughts/` intact when scaffolding into this non-empty directory; if the generator rejects the directory, scaffold in a temporary directory and copy only the new application files after checking for collisions.
- Supabase Auth and Postgres, local Supabase for development and acceptance tests. Add the CLI as a pinned development dependency; do not assume a global install.
- Supabase client SDK plus the current documented SSR helper. No ORM is needed for two small tables and direct Data API operations.
- Zod for application input validation; database constraints enforce persistence invariants independently.
- Plain accessible components and CSS for this story. A full component library and brand design are later work.
- Vitest, Playwright, and database tests using the Supabase CLI's documented database-test runner.
- Prefer local infrastructure for implementation. A hosted pilot later requires its own Supabase project configuration and a working auth email sender. Neither is provisioned by this plan.

### Proposed persistence and access model

`public.practices`:

| Column | Contract |
| --- | --- |
| `id` | UUID generated by the database; stable future tenant identifier |
| `owner_user_id` | Required reference to `auth.users.id`, with deletion restricted while the practice exists; default derived from `auth.uid()`; unique for this initial one-practice-per-owner flow |
| `name` | Required trimmed text, 1–120 Unicode code points; application counting must agree with PostgreSQL `char_length` |
| `timezone` | Required named timezone; validated against supported IANA choices in the application and PostgreSQL's recognized timezone catalog in the database |
| `version` | Integer starting at 1; incremented by the database on update |
| `created_at`, `updated_at` | Database-managed timestamps |

`private.practice_audit_events`: ID, practice ID, actor user ID, operation (`created`/`updated`), previous and new name/timezone, timestamp. Use a separate unexposed schema with RLS enabled and no client grants as defense in depth; no application audit viewer is needed yet. Practice/audit foreign keys restrict destructive deletion; deletion and retention workflows require their own later story.

Access rules:

- Enable RLS on `practices`; revoke inherited `anon`/`authenticated` grants, then grant only required operations.
- Owner-only SELECT, INSERT, and UPDATE policies use verified database identity via `auth.uid()`; no DELETE policy or grant.
- Grant INSERT/UPDATE only for editable columns `name` and `timezone`. IDs, owner, version, and timestamps are not client-editable. INSERT uses the database's owner default; submitted identity is never accepted.
- Validate database names and timezone values on direct API writes too. A private validation/version trigger supplies consistent database behavior.
- A private, narrowly scoped audit trigger writes audit events inside the same transaction. Any privileged trigger function uses an empty/fixed `search_path`, fully qualified references, and revoked direct execution grants. No privileged function is placed in an exposed schema.
- Application queries use the signed-in user's session and publishable key, preserving RLS. No service-role key is required in the application or browser.
- For this story ownership is the administrator role. E1-S2 will add a membership table and explicitly migrate ownership-based access to owner-or-member access; it must not derive roles from editable auth metadata.

### Routes and contracts

| Route/symbol | Responsibility |
| --- | --- |
| `/` | Server redirect to sign-in, setup, or saved practice based on verified user and persisted profile |
| `/login` | Email request, code verification, resend/retry, and safe auth errors |
| `/onboarding/practice` | Create form; an existing practice redirects to `/practice` |
| `/practice` | Saved settings and update form, sign-out, truthful next-step text |
| `requireUser()` | Verify current authentication for each protected page and mutation; never trust an owner ID in form data |
| `practiceInputSchema` | Accept only name/timezone plus server-controlled form metadata; reject unexpected ownership/role fields |
| `createPractice()` | Insert user-owned profile; resolve own unique-owner conflict by returning the existing profile without overwriting it |
| `updatePractice()` | Validate name/timezone and integer expected version; update matching own row/version; distinguish conflict from failure |
| `getCurrentPractice()` | Read profile under the current user's RLS context |
| `getSupportedTimezones()` | Produce server-supplied supported named IANA choices plus UTC; use the same choices for form validation; integration test agreement with the database |
| `previewReminder()` | Render the fixed, labeled date/time example without creating a reminder or claiming notification readiness |

Use Next.js server actions for writes, with verified authentication on every call and normal same-origin protections. Practice data and auth responses must not enter shared caches. Use the SSR client's documented refreshed cookie/cache-header handling, including on redirects.

Input/result contract: `{name, timezone}` for creation; `{name, timezone, expectedVersion}` for editing. Return typed success, field errors, auth-required, conflict, or unavailable results. Internal details and SQL errors stay out of product messages.

For creation, the unique owner constraint is the final concurrency guard; disabling the UI button alone is insufficient. On a uniqueness error, fetch only the current owner's practice. Never treat an unrelated integrity or network error as successful creation.

For updates, filter by practice ID obtained server-side and `version = expectedVersion`. A before-update trigger increments version, so stale updates affect zero rows and produce a recoverable conflict. Preserve unsaved form input and let the user reload current settings. Reject malformed version values separately.

### Proposed files

All paths in this list are future additions; none currently exists.

| Paths | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json`, `.nvmrc`, `.gitignore`, `.env.example`, `README.md` | Runtime/dependency setup, scripts, ignored secrets, local run instructions |
| `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.json` | Framework and quality configuration |
| `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` | Minimal application shell and entry redirect |
| `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/components/auth/email-code-form.tsx` | Email-code sign-in and sign-out actions |
| `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/session.ts`, `src/lib/supabase/database.types.ts` | Cookie-aware clients, refresh handling, generated database types |
| `src/proxy.ts` | Next.js 16 session refresh entry point |
| `src/lib/auth/require-user.ts` | Authentication guard |
| `src/lib/practice/schema.ts`, `src/lib/practice/timezones.ts`, `src/lib/practice/repository.ts` | Validation, preview formatting, and scoped persistence helpers |
| `src/app/onboarding/practice/page.tsx`, `src/app/practice/page.tsx`, `src/app/practice/actions.ts`, `src/components/practice/practice-form.tsx` | Setup, settings, and mutations |
| `supabase/config.toml`, `supabase/templates/email-otp.html`, `supabase/migrations/<cli-generated-name>.sql` | Local auth configuration, OTP email template, profiles/RLS/audit migration |
| `vitest.config.ts`, `src/lib/practice/schema.test.ts`, `src/lib/practice/timezones.test.ts` | Input and preview tests |
| `supabase/tests/practice_profiles.test.sql` | Database constraints, grants, isolation, and audit transaction tests |
| `tests/integration/practice-profile.test.ts` | Real local Data API/authenticated create/update/concurrency tests |
| `playwright.config.ts`, `tests/e2e/practice-onboarding.spec.ts` | Browser flow tests using local email delivery, not mocked persistence |

Generate migration filenames with the Supabase CLI; the placeholder above is not a prescribed timestamp. Generate database types from the tested local schema rather than hand-writing them.

## Phase 1: Application and Authentication Foundation

### Files and changes

- Add the runtime, dependencies, quality scripts, shell, and cookie-aware Supabase clients listed above without replacing existing `thoughts/` files.
- Pin compatible stable patches for Next.js 16, Node 24 LTS, and the selected libraries during scaffolding; record resolved versions in the lockfile and runtime file. Use the documentation corresponding to those versions.
- Initialize local Supabase using CLI help as the command source; configure email OTP with code delivery and explicit resend/expiry behavior.
- Add `/login`, request/verify actions, `requireUser()`, session refresh, and sign-out. Requesting a code is not equivalent to a verified session.
- Document `.env.local` setup using a local/project URL and publishable key. Provide placeholders only in `.env.example`; never commit real secrets.
- If Docker/local Supabase cannot start, report the specific prerequisite and keep authentication/database checks pending; do not substitute mocked success for integration acceptance.

### Automated verification

- Formatting, ESLint, TypeScript, and production build pass with real configuration.
- Browser tests cover valid local email OTP, expired/wrong code, resend limits, protected-route access, sign-out, and signed-out access afterward.
- Existing-user requests should not expose account-existence details beyond what the auth provider safely returns.

### Manual verification

- Request a local code, retrieve it from the local mail viewer, and sign in through the actual UI.
- Refresh the session and sign out; confirm cookie refresh and redirects work without losing session cookies.

Exit criterion: verified user identity is available to pages and mutations; no practice UI fabricates persistence yet.

## Phase 2: Practice Persistence and Isolation

### Files and changes

- Create `practices`, private audit storage, validation/version/audit triggers, explicit grants, and RLS policies.
- Use local SQL iteration and Supabase advisors where available; generate the migration through the CLI's documented workflow and verify it rebuilds a clean local database.
- Implement `getCurrentPractice()`, `createPractice()`, and version-checked `updatePractice()` with the authenticated client.
- Add database and real Data API tests; generate `database.types.ts` after schema verification.
- Keep ownership immutable and practice deletion unavailable. No staff membership endpoints are introduced.

### Automated verification

- Fresh local migration replay succeeds; profile constraints and named timezones are enforced.
- Two authenticated users can create separate profiles and read/update only their own. Test direct Data API read/write, fabricated owner IDs, protected columns, and signed-out roles.
- Two concurrent create calls result in one profile and one creation audit event; both resolve to the existing tenant without overwriting it.
- Two edits with the same expected version allow only the first; the second reports a conflict.
- Audit events capture correct actor and before/after values; attempted direct audit modification is denied. A test-only forced audit failure rolls back the practice mutation.
- Test grants, not only RLS under a privileged SQL connection. Do not use a service role to simulate normal users.

### Manual verification

- Inspect practice and audit rows locally after a create/edit.
- Confirm the second account cannot retrieve or mutate the first account's profile with a guessed ID.

Exit criterion: real persistence, concurrency rules, and tenant boundaries are demonstrated before UI completion.

## Phase 3: Setup and Settings Flow

### Files and changes

- Add root routing, onboarding, saved settings, and the reusable labeled practice form.
- Display name and named timezone; supply supported choices from the server. Offer browser detection as a suggestion with an explicit selected value.
- Show the fixed illustrative reminder preview and explain that saved timezone will govern future practice dates/reminders.
- Implement pending, success, field error, conflict, expired-auth, and unavailable states. Preserve form values for recoverable failures.
- Revalidate or redirect only the current user's settings after successful persistence. Leave obligation-entry UI for its own story.

### Automated verification

- Unit tests cover empty/whitespace/overlong names, Unicode name-length boundaries, unexpected fields, valid named zones/UTC, invalid values, and the example's October 3 date with 09:00 local display.
- Browser tests cover initial creation, refresh, sign-in return, timezone editing, preserved errors, duplicated setup submission, stale settings conflict, and expired authentication during save.
- Test asynchronous server-rendered behavior end-to-end with real local persistence; use unit tests only for synchronous helpers.

### Manual verification

- Test keyboard navigation and error focus, desktop layout, and a narrow mobile viewport.
- Select Pacific, Eastern, and UTC examples; confirm labeling is clear and no message/job is created.
- Use two separate browser sessions and confirm practice isolation and return-user routing.

Exit criterion: AC1–AC11 have demonstrable UI and persistence outcomes.

## Phase 4: Final Verification and Handoff

### Files and changes

- Complete README with local setup, test commands, auth template configuration, schema replay, and expected environment variables.
- Explain the one-owned-practice-per-account constraint and the later membership migration. Record how future obligation records will reference `practices.id` without adding those tables now.
- Review every resulting file against E1-S1 scope, including generated scaffolding files and any migration privileges.

### Automated verification

Define and run these scripts during implementation; they do not exist today:

| Command | Purpose |
| --- | --- |
| `npm run format:check` | Prettier check |
| `npm run lint` | ESLint directly; do not assume a framework-provided lint command |
| `npm run typecheck` | TypeScript without emit |
| `npm run test` | Vitest validation/formatting helper tests |
| `npm run db:reset` | Fresh local migration replay; local development database only |
| `npm run test:db` | Database policy/constraint/audit tests through pinned Supabase CLI |
| `npm run test:integration` | Authenticated local Data API and concurrency tests |
| `npm run build` | Production build with actual environment setup |
| `npm run test:e2e` | Playwright against the production build and local auth/database |

Discover actual Supabase command syntax via `--help` when creating scripts. Database reset and fixture cleanup must assert local test endpoints and never run against a hosted/shared database. Regenerate database types and confirm no unexpected type drift.

### Manual verification

- Repeat the complete sign-in → create → refresh → edit → sign-out → return flow.
- Review final changes, confirm there are no real keys, generated local artifacts, obligation features, or production mutations.
- Report the actual commands, results, and any unmet environment prerequisites; do not claim future checks passed from this planning review.

## Risks and rollback considerations

- **Bootstrap overhead:** authentication and local database setup are unavoidable because no app exists. Keep that infrastructure to this story's needs.
- **Email delivery:** local OTP tests need the local mail service. A public pilot requires a configured email sender and provider rate limits verified separately; no hosted deployment is included.
- **Runtime mismatch:** host Node 26 is not the chosen reproducibility contract. Use the recorded supported LTS runtime for the build/test matrix.
- **Authorization bypass:** direct API access remains possible, so database grants, policies, protected columns, and real-user tests are essential even though the UI uses server actions.
- **Concurrent requests:** database uniqueness and version checks enforce behavior when UI suppression fails.
- **Timezone changes:** there are no existing reminder jobs to reschedule in this story. The later scheduler story must treat a practice timezone change as a reconciliation event.
- **Future staff access:** ownership-only policies are deliberate for this first slice. E1-S2 must introduce memberships before office managers can access another account's practice.
- **Rollback:** disable the new application routes first. For local-only fixtures, reset/replay after confirming the target is local. Once real practice data exists, preserve profiles/audit rows and use a forward repair migration rather than dropping tables. External email requests cannot be recalled.

## Completion Criteria

- Every acceptance criterion AC1–AC11 passes through its specified automated or manual verification.
- Fresh local setup is documented and reproducible; all named checks run with actual results recorded.
- Practices are persistent, private to their verified owners, editable, and protected against duplicate creation and stale updates.
- Audit writes are atomic with practice changes; no application service-role key is required.
- The future reminder preview is truthful and no actual reminder or regulatory applicability claim is produced.
- Existing research documents remain intact; no unrelated feature is implemented.
- A verified implementation diff and any remaining operational prerequisites are reported before declaring the story complete.

## Planning Verification Record

This is a proposed implementation, not a completed story. Current verification consists of reading the existing research file and skills, inspecting workspace/runtime availability, reviewing current official documentation, and reviewing this plan. Application lint, types, migrations, and tests have not been run because their files do not exist yet.

No material product or architecture choice remains open for this plan. Exact package patch versions, CLI flags, Docker availability, and hosted email/project credentials are implementation preflight checks, not permission to provision external resources. The plan can be implemented and verified locally without a cloud project.
