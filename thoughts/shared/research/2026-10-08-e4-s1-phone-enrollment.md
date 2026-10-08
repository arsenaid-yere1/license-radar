# E4-S1 phone enrollment: current implementation and constraints

Date: 2026-10-08 (America/Los_Angeles).
Baseline: `886133312e5e7a8b89a327a43c5e918253a8bcc3` on `codex/e3-s2-renewal-dashboard`.
Scope: planning research; no implementation or hosted changes.

## Story and repository boundaries

`README.md`, Planned workflow and E3-S2 status, and `thoughts/shared/handoffs/2026-10-08-e3-s2-production-release.md` identify E4-S1 next. The E4 table in `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md` requires separate phone verification and consent, sender/purpose/withdrawal explanations, opt-out suppression, and visible lack of readiness. Original empty-workspace observations are historical.

This repository contains one Next.js 16 / React / TypeScript application, using Supabase Auth, PostgreSQL and Zod. It is not a multi-application monorepo. `src/app/` owns routes/actions, `src/components/` presentation, `src/lib/` domain and persistence, `supabase/` database authority, and `tests/` plus `tools/` verification. No background worker or separately published library exists. The latest handoff records a deployed dashboard and historical 32-layer success; those checks were not rerun for this planning task.

## Responsibility and readiness today

- `supabase/migrations/20261006003555_practice_reminder_recipient.sql` stores one practice selection in `private.practice_reminder_settings`. Its version is independent of profile/member versions. Private recipient events record assignment, replacement, clearing and member invalidation.
- `private.require_recipient_member` locks the practice before checking current authority. `private.set_practice_reminder_recipient` then checks version and the candidate's current active administrator/manager membership in the same practice.
- `private.mutate_member` clears a selected recipient on revocation/viewer demotion through `private.invalidate_reminder_recipient`. Rejoining/promotion does not restore assignment. Only that supported mutation boundary should be extended; a membership-first trigger could invert practice locking.
- `private.get_practice_reminder_recipient` always returns `ready: false`, with `no-recipient`, `sms-setup-pending` or `member-unavailable`. It returns eligible candidates only to editors and no phone data.
- `src/lib/recipients/schema.ts:recipientSchema` enforces the same readiness combinations and literal false. Changing the legacy response to true would break the deployed application's parser.
- `src/lib/recipients/operations.ts:saveRecipient` checks `auth.getUser`, uses `getPracticeAccess`, rejects viewers, validates strict input, and derives practice identity rather than accepting posted authority.
- `src/components/recipients/recipient-panel.tsx` separates saved selection from a draft, keeps committed versions, refreshes after success, and requires reload after uncertainty/conflict. `src/lib/recipients/messages.ts:recipientMessage` always describes SMS setup as pending.
- `src/app/practice/page.tsx:Settings` reads recipient state dynamically for every active role. It already has the natural enrollment entry location. `src/proxy.ts` covers `/practice/:path*`; `src/lib/supabase/session.ts` applies private/no-store headers. A provider webhook outside that matcher needs its own validation and headers.

## Missing provider boundary

`package.json` has no SMS SDK; `.env.example` has only public Supabase values. `src/lib/supabase/server.ts:createClient` uses a session-bound publishable client. No phone challenge, consent, provider event, reminder job or message attempt table exists. Phone enrollment must not mutate Supabase Auth phone identity or turn email login into SMS authentication.

`tools/check-capabilities.mjs` rejects every occurrence of `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY` or `user_metadata` in application source. A trusted provider result cannot be committed by an authenticated RPC accepting an arbitrary client-supplied `approved` flag. A deliberately reviewed server-only service client and service-only RPC grants are necessary for the proposed adapter. The blanket ban must become an exact, tested exception, retaining prohibition elsewhere. Renaming a secret to evade the checker is not an acceptable solution.

The user was asked asynchronously about provider selection. This plan uses Twilio Verify + Messaging as a proposed default, not as a confirmed selection or authorization to provision an account, purchase a sender or send messages. No existing provider account was inspected.

## Existing test and tooling patterns

- `tests/unit/recipient-operations.test.ts` tests verified identity, live access, strict posted input, exact RPC arguments, denial/errors and runtime output projection. `tests/unit/recipient-actions.test.ts` covers form duplicates/files, version parsing, login redirects and safe text.
- `tests/unit/recipient-panel.test.tsx` tests draft retention, saved-version progression, role refresh at an unchanged assignment version, explicit clear, focused feedback and lost responses.
- `tests/integration/practice-recipients.test.ts` uses real local API/SQL, complete private history, fault-trigger rollback, the same JWT after access changes, and witnessed lock waits. `supabase/tests/practice_recipients.test.sql` checks RLS, grants, invoker wrappers and composite restrictive references.
- `tests/e2e/practice-recipient.spec.ts` uses `tests/helpers/private-browser.ts`, disables automatic traces/screenshots/video, and covers persistence, roles, stale candidates, foreign Origin, pending requests and response loss after commit. Phone/OTP tests need the same artifact discipline.
- `tests/helpers/access-fixtures.ts` builds two practices and authorized memberships. `tests/helpers/local-fixtures.ts` validates fixed local endpoints before using the fixture database.
- `tools/local-environment.mjs:prepare` currently writes only public keys. New privileged local test configuration must be obtained from local status, written to ignored mode-0600 files, never printed, and re-created after every replay/upgrade.
- `tools/schema-catalog.mjs` captures all private tables and application public/private function definitions/ACLs in nine sections. Private SMS storage is automatically in scope; reviewed `tools/schema-contract.json` and generated public types still need refresh.
- `tools/recipient-upgrade.mjs` rehearses a historical migration with fixture guards, exact row snapshots, transaction rollback, full function/ACL/schema comparison and fresh replay. A new SMS upgrade must preserve all 14 current application tables, including selection, register audit and both creation/change receipts.
- `tools/foreign-key-controls.mjs` enumerates SQL suites and exact TAP counts; new SQL witnesses need explicit inventory/control additions. `tools/gauntlet.mjs:requiredLayers` and `tools/layers.json` enumerate 32 layers, so adding an upgrade layer requires both lists.
- `vitest.config.ts` discovers conventional unit/integration files automatically. `stryker.config.mjs`, `stryker.properties.config.mjs` and `vitest.properties.config.ts` require explicit new domain selections. `tools/check-coverage.mjs` includes every handwritten application source file. Mutation thresholds are 100%.
- `tools/supply-chain.mjs` requires exact direct dependency pins matching `tools/toolchain.json`, empty runtime advisory results and classified licenses/advisories. Adding the Twilio SDK must update the lockfile and reviewed toolchain, without weakening this gate.
- `.prettierignore` excludes `thoughts/`; durable documents require explicit formatting with an ignore override.

## Provider facts checked against official sources

These are provider facts, not proof of local functionality or a legal-compliance determination. The proposed architecture is an inference from these contracts and the repository.

1. Verify creates an SMS verification and provides a verification SID. Its check endpoint accepts that SID and a code; phone input uses E.164. Bind the trusted response to the persisted attempt rather than accepting a browser assertion. [Verification API](https://www.twilio.com/docs/verify/api/verification), [Verification Check](https://www.twilio.com/docs/verify/api/verification-check).
2. Default code validity is ten minutes; resending during validity can reuse the token. Local expiry must not extend merely because a resend occurs. [Verify limits/timeouts](https://www.twilio.com/docs/verify/api/rate-limits-and-timeouts).
3. Verify requires documented opt-in for the requested OTP, with disclosures and terms/privacy access. Permission to send the code is distinct from consent to recurring renewal reminders. [Verify consent policy](https://www.twilio.com/docs/verify/consent-opt-in).
4. Messaging consent must identify sender and purpose, preserve evidence and permit withdrawal. The plan's explicit reminder-consent event follows this requirement. [Messaging policy](https://www.twilio.com/en-us/legal/messaging-policy).
5. Advanced Opt-Out reports `OptOutType` values STOP, START and HELP; Twilio handles its confirmation. A callback must not trigger another confirmation text or silently restore practice enrollment. [Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out).
6. Validate the webhook signature using the exact configured external URL and all received form parameters with the provider SDK. [Webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security), [official Node SDK](https://github.com/twilio/twilio-node).
7. Supabase recommends pinned search paths, explicit execute privileges and ownership checks for privileged functions. Preserve private definer implementations/public invoker wrappers. [Database functions](https://supabase.com/docs/guides/database/functions).
8. The Markdown changelog index could not be rendered; the HTML index and relevant table-exposure change were reviewed. Table grants and RLS are separate. The repository already disables automatic exposure; no new public SMS table is proposed. [Supabase changelog](https://supabase.com/changelog), [Data API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Planning verification boundary

Research used file inventory, complete source/test/tool reads, status/history, and official documentation. `git status --short` was initially empty. Local Node 24.21.0 and Prettier 3.9.9 were verified. No code, migration, test data, secrets, hosted configuration or provider resource was changed. Implementation checks are specified in the companion plan; prior deployment checks are historical evidence only.
