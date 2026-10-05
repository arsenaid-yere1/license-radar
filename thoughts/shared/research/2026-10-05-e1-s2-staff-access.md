# E1-S2: Staff Access Research

Date: 2026-10-05
Baseline: `491e6905bdbc2aa853c94c9cc7e192d51cd9a676` on the current project checkout.
Status: Current-state research for the next-story plan; no application changes.

## Research question

What is the next story after practice setup, how does the current application authorize and route users, and which existing implementation and verification contracts affect staff invitations and membership roles?

## Summary

The next story is **E1-S2: invite a manager and assign roles**. This is explicit in `README.md:25` and the backlog in `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md:161`. Its original requirements are expiring invitations, role permissions, revoked access, and protection of the last administrator.

Practice setup exists. Access is currently determined by immutable creator ownership, with one practice per owner. There are no membership or invitation tables, team screens, invitation delivery adapter, or membership authorization helpers. A membership transition must change database authorization, practice creation, route decisions, UI labels, and the verification tools together.

## Repository and ownership boundaries

This is one Next.js application, not a multi-application monorepo. `package.json` pins Next.js 16.3.8, React 19.3.0, Supabase JS 2.117.2, SSR 0.12.7, and Zod 4.6.5. Node 24 is the supported major. No independently published libraries or background worker exist.

Logical responsibility boundaries:

- `src/app/`: server-rendered routes and server actions.
- `src/components/`: forms and shared shell.
- `src/lib/auth/`: verified identity and OTP operations.
- `src/lib/practice/`: validation, timezone behavior, persistence, save orchestration.
- `src/lib/supabase/`: cookie client, refresh, generated database types.
- `supabase/`: database schema, policies, audit triggers, local Auth and mail configuration.
- `tests/` and `tools/`: behavior verification and local environment/assurance tooling.

These are code boundaries; no individual or team ownership assignments are recorded.

## Detailed findings

### Identity and routing

`requireUser` in `src/lib/auth/require-user.ts` validates identity with `auth.getUser()`. Authentication failures redirect to `/login`; provider outages throw a generic retryable error.

`requestCode` and `verifyCode` in `src/lib/auth/operations.ts` use email OTP. `src/app/login/actions.ts` redirects successful verification to `/`. It carries no invitation context or allowed return destination today. `EmailCodeForm` in `src/components/auth/email-code-form.tsx` supplies labeled email/code fields and focuses result messages.

`Home`, `Setup`, and `Settings` in `src/app/page.tsx`, `src/app/onboarding/practice/page.tsx`, and `src/app/practice/page.tsx` each call `getCurrentPractice`. No visible practice means setup. The settings route calls every authenticated profile holder “Practice administrator” and always renders the edit form.

`updateSession` in `src/lib/supabase/session.ts:4` refreshes claims/cookies and sets private/no-store headers. `src/proxy.ts:7` matches only `/`, `/login`, `/practice`, and `/onboarding/practice`; future nested team and join routes need explicit coverage. Proxy authentication is not a membership check.

### Practice persistence

`getCurrentPractice` in `src/lib/practice/repository.ts:14` selects all visible practices and calls `maybeSingle()`. Its single-record assumption currently follows from ownership RLS plus owner uniqueness.

`createPractice` at line 31 directly inserts name/timezone. It handles `23505` only when the error mentions `practices_owner_user_id_key`, then returns the existing visible practice. `updatePractice` at line 55 uses the supplied practice ID and expected version. `savePractice` in `src/lib/practice/save.ts:14` verifies identity, validates strict input, and derives the update ID from the current visible practice.

`validatePractice` in `src/lib/practice/schema.ts` rejects unknown fields. `PracticeForm` in `src/components/practice/practice-form.tsx` retains input and the latest successful practice/version through subsequent failures. Its recovery regression must remain covered during role-aware routing changes.

### Database authority and audit

The complete migration `supabase/migrations/20261003191334_practice_profiles.sql` creates only `public.practices` and `private.practice_audit_events`.

- `practices_owner_user_id_key` enforces one practice per creator.
- `practices_select`, `practices_insert`, and `practices_update` compare `owner_user_id` with `auth.uid()`.
- Authenticated clients have SELECT and narrowly granted INSERT/UPDATE columns; delete/protected-column writes are denied.
- `private.validate_practice` trims/validates names and zones, preserves protected fields, and advances the version.
- `private.audit_practice` records the verified actor and profile before/after values in the same transaction.
- Private schema usage and direct execution of trigger functions are denied to normal clients. Restrictive foreign keys preserve creators and audit references.

There is no privileged application client. `createClient` in `src/lib/supabase/server.ts` uses only the publishable key and cookies. Authorization does not depend on editable user metadata.

**Inference:** adding membership rows without replacing the ownership policies would leave invited staff unable to see the practice and would leave the creator authorized after membership revocation. This follows from the verified policies; no membership implementation has been tested.

### Local delivery boundary

`supabase/config.toml` exposes only `public`, disables automatic new-table exposure, uses PostgreSQL 17, and captures email locally at port 55324. Email confirmations are enabled; OTP length is six digits and expiry is ten minutes. No external invitation mail provider is configured.

The Auth invitation API sends an authentication invitation link; it is not an application practice-membership model. Existing OTP can authenticate both new and returning users. See [Auth invitation reference](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail) and [email OTP documentation](https://supabase.com/docs/guides/auth/auth-email-passwordless).

### Existing verification

`tests/unit/save.test.ts`, `tests/unit/routes.test.tsx`, and `tests/unit/server-actions.test.ts` cover identity validation, server-derived practice IDs, malformed forms, routing, conflicts, and outages with replaced boundaries.

`tests/integration/practice-profile.test.ts` uses real local OTP accounts and Data API calls for 20-way creation, guessed-ID and metadata attacks, protected columns, stale updates, timezone agreement, and audit rollback. `tests/helpers/local-fixtures.ts` confines privileged fixture access to fixed loopback endpoints.

`supabase/tests/practice_profiles.test.sql` asserts 20 ownership/grant/validation/audit conditions, including denied private-schema usage. `tests/e2e/practice-onboarding.spec.ts`, `practice-isolation.spec.ts`, and `practice-failures.spec.ts` supply production-browser regression coverage; the isolated research pass traced those patterns.

Verification contracts also encode E1-S1 assumptions:

- `tools/schema-fingerprint.mjs` captures public columns/policies/grants/RLS only for practices and public triggers only on practices; functions only in private. New membership tables, public RPC wrappers, function/schema privileges, constraints, and indexes need coverage.
- `tools/foreign-key-controls.mjs` expects three old foreign keys and a `1..20` TAP plan.
- `tools/sql-mutants.mjs` mutates the creator-unique constraint and the TypeScript version predicate, and selects specific S1 integration names.
- `stryker.config.mjs` enumerates existing application modules; `stryker.properties.config.mjs` and `vitest.properties.config.ts` select only the practice schema/properties.
- `tools/check-capabilities.mjs` detects Auth and `client.from` spellings but not new `client.rpc` calls.
- `tools/check-generated-types.mjs` already generates the complete public schema.
- `tools/shuffle-browser.mjs` discovers browser tests but hardcodes ten completed results; new suites require inventory-based completion checks.
- `tools/layers.json` defines 26 verification layers, including database replay, mutation, browser execution, coverage, source checks, and secrets.

## Current execution flow

1. Email OTP request is captured in local mail.
2. Verification writes cookie session and redirects to `/`.
3. Root verifies identity and queries owner-visible practices.
4. No row routes to setup; an existing row routes to editable settings.
5. Create/update action verifies identity and strict input.
6. Column grants, ownership RLS, constraints, and triggers validate and atomically audit the mutation.
7. Successful create redirects; edit returns the saved version; failures preserve inputs.

## Historical context

The 2026-10-03 system design is a proposal whose empty-workspace findings are historical. Its role table proposes administrator, office manager, and clinician/viewer, with viewers limited to assigned future records. Those records do not exist today.

The E1-S1 executable specification in `thoughts/shared/plans/2026-10-03-e1-s1-old-coder-spec.md` deliberately deferred memberships. The project verification report records a later saved-version recovery fix and a historical 26-layer successful run. That prior run is evidence for its recorded source, not for E1-S2.

## Open questions and evidence limits

- The user was asked about multiple practices and invitation delivery. Pending a response, the companion plan explicitly proposes one active practice per account and administrator-shared invitation links with existing OTP sign-in.
- Seven-day invitation validity and the viewer's current profile-only read access are plan proposals, not verified product requirements.
- `changelog.md` failed through the web tool (unsupported content type) and shell curl failed DNS resolution. The HTML [Supabase changelog](https://supabase.com/changelog) and official topic pages were available. The Data API exposure change is relevant; explicit grants are already an existing pattern. Planning does not claim an exhaustive release audit.
- New membership behavior, migrations, races, browser flows, and invitation acceptance have not been executed. See the companion plan's verification requirements.
