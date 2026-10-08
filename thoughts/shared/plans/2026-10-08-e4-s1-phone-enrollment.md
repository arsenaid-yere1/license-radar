# E4-S1: Phone Verification and SMS Consent Implementation Plan

Date: 2026-10-08 (America/Los_Angeles).
Baseline: `886133312e5e7a8b89a327a43c5e918253a8bcc3`.
Status: Phases 1–5 complete locally; all 33 required verification layers passed on checkpoint `761c9878ab4ce1fe3492a695f5745ed7a4f62749`. The user's subsequent “push to prod” authorized deployment: the additive migration and app are live, and read-only hosted checks passed. Provider configuration and authorized test-phone acceptance remain pending; live sending is disabled. See `thoughts/shared/handoffs/2026-10-08-e4-s1-production-release.md`.
Research: `thoughts/shared/research/2026-10-08-e4-s1-phone-enrollment.md`.
Verification: `thoughts/shared/plans/2026-10-08-e4-s1-phone-enrollment-verification.md`.
Implementation evidence: `thoughts/shared/research/2026-10-08-e4-s1-implementation-evidence.md`.

## Overview

Deliver the next P0 story: “As a manager, I can verify my phone and choose to receive reminder texts so messages reach the correct recipient.” Add self-service phone verification, a separate explicit reminder-consent step, withdrawal, signed provider opt-out handling and accurate enrollment readiness.

`README.md` and the E3-S2 production handoff identify this story next. Calendar/dashboard are released. SMS scheduling, catch-up, dispatch and delivery history remain E4-S2–S4. This story sends only explicitly requested verification codes when live provider configuration exists; enrollment itself sends no renewal reminder.

Twilio Verify + Messaging is the proposed provider default. No response to the provider-choice question has been received at drafting time; this is a concrete planning assumption that can be revised, not provider provisioning authorization. All local automation uses a guarded provider fixture. Live activation has explicit prerequisites below.

## Current State

One Next.js application has session-bound Supabase clients and live database membership authority. `src/lib/practice/access.ts:getPracticeAccess` returns practice, role and membership version, but no membership ID. Derive the caller's membership in the database using verified user identity; never infer it from a posted ID.

`private.practice_reminder_settings` selects one active administrator/manager per practice. `private.mutate_member` clears that selection when access is revoked or demoted to viewer. The legacy recipient RPC and `src/lib/recipients/schema.ts:recipientSchema` require `ready: false`. Assignment does not verify a phone or confer consent.

`src/app/practice/page.tsx:Settings` and `src/components/recipients/recipient-panel.tsx` are the enrollment entry location and selection UI. There are no provider routes, service clients, private phone/consent records, jobs or workers. The current capability checker forbids service keys anywhere in application code. Research records the exact extension points, access/recovery witnesses and 32-layer verification inventory.

## Desired End State

### Product decisions

- Each active administrator/manager may verify and enroll their own phone for their current practice, even before being selected. Only the current selected member can become the practice's enrollment-ready recipient. An administrator cannot verify or consent for somebody else.
- Enrollment belongs to `(practice, membership)` and a phone revision, rather than the Auth user phone. Email-code authentication is unchanged. Assignment transfers no phone, verification or consent.
- A phone change immediately ends prior enrollment, advances the phone revision and invalidates prior challenges. Require confirmation explaining this effect before requesting a replacement code. Do not keep the old number eligible while verifying a replacement.
- Requesting a verification text records separate OTP permission after displaying its notice. Successful verification leaves reminders unenrolled until an unchecked checkbox and explicit “Enroll in renewal texts” submission record reminder consent.
- Reminder consent identifies License Renewal Radar, the practice, renewal purpose, variable date-based frequency, rates, STOP/in-app withdrawal and terms/privacy access. It does not claim that reminders are already active.
- In-app withdrawal is one action with no confirmation barrier; active viewers may withdraw an existing personal enrollment but cannot request a code or enroll. Revoked users cannot use practice routes; provider STOP works without a session.
- Revocation/viewer demotion invalidates that member's challenges and clears reminder consent atomically, including when they were not selected. Promotion/rejoin requires fresh verification and consent. Eligible administrator/manager transitions retain enrollment.
- Provider STOP suppresses the phone across all enrollments using the configured Messaging Service. In-app withdrawal affects only the caller's practice enrollment. Shared phones never grant cross-practice consent or disclose another enrollment.
- For this initial story, provider STOP is terminal for that phone in the application's suppression ledger. START is recorded but cannot clear local suppression or reinstate consent. Display a clear blocked state; same-number provider resubscription/reconciliation is deferred to E4-S4. New-phone enrollment and fresh consent after in-app withdrawal remain supported.
- The selected member's enrollment state is visible to every active practice role; phone suffix and challenge/consent details are visible only to the phone's owner. Raw phone numbers, OTPs, provider payloads and service credentials stay out of shared props, links and logs.
- Keep legacy `ready: false`. A new detailed projection exposes `enrollmentReady` and an enrollment reason separately from `deliveryActive: false`. “Phone verified and consent recorded. Renewal texts are not active yet” is the successful state. Missing configuration is explicit, with collection/send disabled.

### Acceptance criteria

| ID   | Required behavior                                                                                                                                                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | Additive upgrade preserves every historical practice/member/register/cycle/coverage/audit/receipt row and legacy API shape. No existing member is auto-enrolled or auto-consented.                                                                 |
| AC2  | Self-service access derives verified identity and live membership. Viewers/nonmembers/foreign or revoked actors cannot verify/enroll; another person's challenge/proof cannot be used.                                                             |
| AC3  | E.164 phone validation, six-digit provider-checked codes, ten-minute bounded challenge lifetime, persistent send/check limits, one active challenge per endpoint and versioned invalidation are enforced server-side.                              |
| AC4  | Only a trusted server provider result commits verification for the matching challenge, service, account, phone and revision. Browser/direct authenticated RPC calls cannot forge approval.                                                         |
| AC5  | OTP permission and reminder consent are separate immutable events. Verification, assignment, retries, START and access promotion never imply reminder consent.                                                                                     |
| AC6  | Withdrawal and STOP immediately make the eligibility predicate false; duplicate callbacks are idempotent; wrong signatures/account/service/sender are rejected. STOP persists across phone removal/reuse and acts across shared-phone enrollments. |
| AC7  | Phone replacement, demotion/revocation, stale forms, concurrent checks, uncertain submissions and lost responses cannot restore stale proof/consent. Audits/state/receipts commit or roll back together.                                           |
| AC8  | Shared readiness is accurate and private. Owners can see their own masked phone/state; other members see no phone/challenge/consent detail. Legacy applications remain compatible.                                                                 |
| AC9  | Desktop/mobile enrollment, separate consent, withdrawal, pending/error/reload recovery, keyboard focus and accessible labels work. OTPs are never retained in browser storage or diagnostic artifacts.                                             |
| AC10 | Real SQL/API, provider-contract, properties, production-local browser and inherited verification gates pass. Offline fixtures cannot activate in hosted environments. Live provider/manual acceptance is reported separately.                      |

## Key Discoveries

1. Preserve the legacy RPC projection: its strict readiness schema rejects a true value, so introducing a new detailed RPC avoids a schema-first rollout outage and permits application rollback.
2. `private.mutate_member` is the supported practice-first lifecycle boundary. Extend it with personal enrollment invalidation without changing last-administrator, access-audit or assignment-clearing behavior.
3. A publishable/authenticated client cannot securely assert verification. Service-only function grants and an isolated server module are required, with an explicit exception in `tools/check-capabilities.mjs` and negative controls.
4. Twilio verifies by SID; persist and bind it before checking a code. Approval across a provider/database network boundary is not a distributed transaction. An unverifiable ambiguous result must leave enrollment incomplete.
5. Twilio Verify requires OTP opt-in evidence as well as reminder consent. Terms/privacy/customer-care configuration is therefore part of the activation boundary, rather than a decorative checkbox.
6. Existing test discovery is broad, but mutation selections, SQL TAP inventories, upgrade layers, dependency pins and local secret preparation are explicit. The new adapter must be exercised through a real server fixture, not just mocked UI success.

Provider contracts and their official citations are in the companion research. Everything below is the proposed application design, not an assertion that the provider implements these database guarantees.

## What We Are Not Doing

- Renewal scheduling/sending, worker claims, delivery histories, automatic catch-up, jobs or fictitious job cancellation. E1-S3 rule 9 remains open until E4-S2/S3.
- SMS login/MFA, changing Supabase Auth phones, backup recipients, alternate channels, country inference or a provider lookup product.
- Same-number recovery after provider STOP, automatic START consent, international sender provisioning, billing/account creation or legal-compliance certification.
- General audit browsing, record workflow/completion, unrelated dashboard/register changes, deployment, commits or real message sends in this planning task.

## Implementation Approach

### Private data and permissions

Create one CLI-named migration for private tables, private definer implementations with `search_path = ''`, and public invoker entry wrappers. Revoke default PUBLIC/anon/authenticated privileges explicitly; enable RLS on every new private table. Grant entry functions deliberately, including the required private-schema USAGE for the service role; never grant ordinary direct table DML/read or internal proof mutation.

Proposed tables:

| Table                                 | Contract                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private.sms_phone_endpoints`         | Unique `(account_sid, messaging_service_sid, phone_e164)`; normalized phone, persistent provider-blocked flag, monotonically increasing suppression epoch, timestamp. Endpoint state has no tenant-readable API.                                                                                                                                                                |
| `private.practice_sms_enrollments`    | Unique `(practice_id, membership_id)`; composite membership FK, version, phone revision, endpoint ID, verified revision/time, current reminder-consent event ID/epoch, lifecycle state. Null consent/verification initially; missing row reads as not started.                                                                                                                  |
| `private.sms_verification_challenges` | Enrollment/practice/member/phone revision, endpoint, Verify service/SID, first-request expiry, check counter/lease and state (`reserved`, `pending`, `verified`, `failed`, `uncertain`, `expired`, `invalidated`). One live challenge per endpoint across memberships; explicitly expire an old challenge under the endpoint lock before allocating a successor. No OTP stored. |
| `private.sms_verification_requests`   | Caller/practice/request UUID, send/check intent, challenge reference, immutable non-OTP payload fingerprint, individual claim/lease/outcome/time. Resend is another send request for the same challenge, not a second live challenge. Each entered code uses a new check request ID; retries read that request outcome without replaying an unknown provider call.              |
| `private.sms_enrollment_events`       | Immutable OTP-permission, phone-change, verification, reminder-consent, withdrawal and member-invalidated events; actor, practice/member, phone revision, exact server-owned disclosure version/text, state references and DB time. No raw OTP; references to phone endpoint rather than repeated phone values.                                                                 |
| `private.sms_action_receipts`         | Unique caller/practice/request UUID; intent, normalized payload excluding OTP, result and version/revision references for exact retry of phone preparation/consent/withdrawal. Receipt replay never overrides current enrollment eligibility.                                                                                                                                   |
| `private.sms_provider_events`         | Unique `(account_sid, message_sid)`; service/endpoint, recognized opt-out type, receipt time and sanitized provenance. No retained message Body. STOP event and suppression update are atomic.                                                                                                                                                                                  |

Give tenant entities composite keys/FKs for all tenant-bearing references, including consent-event ownership/revision. Restrictive deletion retains audit/proof. Global endpoint/provider records intentionally span tenants; no public endpoint search or uniqueness detail leak. Store minimal private E.164 values in protected database storage; do not claim application encryption beyond existing infrastructure. No new public table is required.

Authenticated wrappers: `get_my_practice_sms_enrollment`, `get_practice_reminder_recipient_with_enrollment`, `prepare_my_sms_verification`, `consent_my_practice_sms`, `withdraw_my_practice_sms`. Derive actor from `auth.uid()`, check live membership after locking, and reject posted authority. Preparation records OTP permission and phone intent but cannot call the provider or record verification. Internal helpers are not executable by ordinary clients.

Proposed service-only wrappers: `claim_sms_verification_send`, `record_sms_verification_send`, `claim_sms_verification_check`, `record_sms_verification_check`, and `apply_sms_provider_opt_out`. These implement claim/start/check-reservation transitions for an already prepared request, record provider start/check outcomes, and apply a verified opt-out event. Grant only to `service_role` (plus the private implementations needed by invoker wrappers); reject `anon`/`authenticated` direct execution. For user operations, resolve membership through the request bound to the server's verified actor and recheck live eligible membership in SQL. Webhook operations accept only the allowlisted service/account/endpoint event path, never an arbitrary user/practice mutation. A server service key is privileged infrastructure, not a claim of database-level least privilege.

Keep legacy recipient getters/setters and their historical outputs unchanged. Add a detailed getter that composes existing selection/candidates with a safe `enrollment` projection: `no-recipient`, `member-unavailable`, `not-started`, `verification-pending`, `verification-uncertain`, `consent-required`, `withdrawn`, `provider-opted-out`, or `enrolled`. Calculate `enrollmentReady` from selected active editor membership, current verified revision, matching current consent/disclosure and unblocked endpoint/current suppression epoch. Derive stale pending challenges as expired from DB time; do not leave an expired UI waiting indefinitely or mutate records during reads. No read changes state or manufactures history. Missing/corrupt referenced records fail unavailable, rather than falling back to enrolled.

### State transitions, races and retry semantics

Use practice-first locking for user/lifecycle operations. User SMS operations then lock their endpoint, enrollment and challenge/receipt in consistent order. Existing member mutation takes practice/member/settings, then personal enrollment/challenges, but never the endpoint lock. STOP locks only the endpoint/provider-event rows and never takes a practice, membership or enrollment lock. The eligibility predicate consults endpoint suppression directly, so STOP need not bulk-update enrollment rows or acquire multiple tenant locks. All endpoint operations lock one endpoint only; phone replacement invalidates the old personal state without locking its old endpoint. Test both serialization orders and document the order in SQL.

A phone change or demotion/revocation clears verification and consent, advances enrollment version and invalidates challenges under the practice lock. The global endpoint record and STOP tombstone remain. Recipient changes use the existing selection version and only alter which enrollment is projected; consent remains personal. Same-target/same-phone no-op operations preserve versions; stale expected versions conflict before no-op detection. Database positive integer bounds and overflow failures remain fail closed.

Server-owned limits: 60 seconds between sends per phone and actor; at most 5 sends per rolling 30 minutes and 10 per 24 hours for either phone or actor; tenant ceiling 100 sends/24 hours. Count reservations, including failures/unknown results, so changing phones/request IDs or restarting a server cannot bypass the budget. Maximum five code-check reservations per challenge, one concurrent leased check, and ten-minute expiry from the first request. Use DB time, the practice lock for tenant/current-actor budgets and endpoint locks for phone budgets. Count historical actor requests across practices; the existing one-active-practice invariant and live recheck must also hold at each service reservation. Add a membership-transition/budget race witness to ensure moving practices cannot bypass actor limits. These are proposed conservative pilot defaults, not provider guarantees. No resend extends expiry. New challenge after expiry still respects rolling budgets.

Each user send has a request UUID and an exact normalized payload. The service atomically claims a prepared send once, releases all DB locks, invokes Verify with SMS and then records the SID/result. Disable SDK automatic retries and use a bounded ten-second network timeout. A reservation/check lease expires after 30 seconds; an expired in-flight lease transitions to uncertain, never directly to a new send claim. Explicit resend is a new request within the same known-SID challenge/expiry and budget, initiated by the owner. Unknown start outcome blocks resend for that attempt's lifetime; show reload/wait instead of silently sending again.

Check only a persisted, known SID with the configured Verify service. Validate account/service/SID/phone/channel and `approved` in the provider response; then atomically commit matching verification proof/audit/receipt with current membership/revision checks. A response for an invalidated challenge cannot verify the replacement phone. Duplicate approval/confirmation retries return committed state without duplicate events. Wrong/expired/exhausted checks never grant readiness.

If the provider approved but the database commit cannot be confirmed, read the existing local receipt first. If no committed proof exists, mark the challenge uncertain and require a fresh verification after expiry; do not infer success from provider 404, browser claims or a previously entered code. A real lost response after database commit is recovered through the durable receipt/read. The OTP lives only in the form/server request and provider call: no database payload, telemetry, URL, action result, storage, screenshot or failure dump retains it. Consent/withdrawal receipts are OTP-free. No generic cross-intent retry or silent version rebasing.

Consent requires explicit true, current verified phone revision, expected enrollment version, server disclosure version and current unblocked endpoint/epoch. Replays return a historical receipt alongside current state; historical success never implies currently enrolled. Withdrawal clears consent atomically and is idempotent. Enrollment version is independent of recipient assignment version; refresh must apply enrollment changes even when assignment version is unchanged.

### Provider/server and webhook boundary

Add proposed `src/lib/sms/{schema,repository,operations,messages,provider,config,disclosures,webhook}.ts` for strict schema/state, owner-safe repository, operations/messages, provider adapter/config/disclosures/webhook and an isolated `privileged-repository.ts`. The latter owns the Supabase service client and exports only named SMS operations, never a raw client or arbitrary RPC method. Keep provider/privileged modules behind `server-only`; install exact reviewed `twilio` and `server-only` dependency pins during implementation and update the recorded toolchain. Unit tests may mock the marker, but the production build must reject a client import.

Proposed server settings: `SUPABASE_SECRET_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_AUTH_TOKEN` for callback validation, `TWILIO_VERIFY_SERVICE_SID`, `TWILIO_MESSAGING_SERVICE_SID`, `SMS_WEBHOOK_URL`, `SMS_SENDER_ALLOWLIST`, `SMS_SUPPORT_EMAIL`, `SMS_LIVE_ENABLED`. No secret uses `NEXT_PUBLIC_`. API credentials and webhook Auth Token have distinct purposes. Add placeholder names only to `.env.example`; no credentials are tracked. Keep sign-in and existing routes functional when SMS configuration is absent; disable enrollment sending and show setup unavailable. Treat callback validation/persistence configuration separately from the live-send flag: switching live sends off must retain processing of already-configured STOP callbacks and self-withdrawal. Terms/privacy and live checks are gated independently from later reminder activation.

Add `/api/sms/twilio/inbound`, Node runtime, POST-only, bounded form body and no-store responses. Validate `X-Twilio-Signature` with the official SDK, the exact fixed external URL and all received fields before projecting any data; do not reconstruct trusted origin from Host/forwarded headers. Reject duplicate security-sensitive form fields, unexpected content type/size, wrong account/service/destination sender, absent/bad signature and malformed SID/phone. Configure a finite sender-number allowlist belonging to the selected service for callback validation. Do not require a user cookie or change practice-route auth.

Recognized STOP inserts its provider event and sets `provider_blocked = true`, advancing the suppression epoch once per distinct event. Create a suppression tombstone even for a currently unknown phone. START/HELP only append their deduplicated sanitized event; neither removes local suppression nor supplies reminder consent. Delayed STOP always suppresses; delayed START never restores. Other valid inbound messages receive an empty TwiML response without storing body or invoking application messaging. Duplicate SID with incompatible content fails safely. Commit before a 2xx empty response; DB failure returns 503 for retry. Do not send a second confirmation, since Advanced Opt-Out handles it.

The callback cannot revoke user membership or assign a recipient. User actions live at `/practice/sms/actions.ts`; this path inherits existing practice protection and Next server-action Origin checks. Direct service-only RPCs and callback errors must not reveal private phones or database/provider details.

### UI, disclosure and activation

Add `/practice/sms`, `force-dynamic`, with current identity/access and owner-safe enrollment fetch. Settings link “My reminder texts” is available to active editors and active viewers who need withdrawal; shared selection retains its existing editing rules. Add separate SMS status presentation to the recipient panel using the detailed projection, preserving the existing selection action and legacy result parser. Its assignment-success message should describe responsibility saved without incorrectly claiming enrollment is pending when detailed enrollment is complete.

The self-service panel has saved masked phone/status, explicit international-format phone input, OTP notice/request action, six-digit verification form, then a separate unchecked reminder-consent control. Trim surrounding ASCII whitespace only; require `+` followed by 2–15 ASCII digits with a nonzero first digit. Do not guess a country, accept extensions, or claim syntax proves a routable number. Provider geographic permissions/delivery can still reject syntactically valid numbers. Persist no draft after navigation. Only owner props include suffix; OTP is cleared after every check response.

Use focused status/error feedback, explicit expiry/resend delay from server values, disabled repeated/pending submissions and neutral provider failures. Preserve nonsecret phone draft on validation/unavailable errors; conflict/uncertainty requires rereading current state. Reload does not automatically opt in, resend or rebase a draft. Show changing phone ends previous enrollment, missing provider configuration, incomplete verification, consent required, withdrawn, STOP-blocked and enrolled states as text, independently of assignment and inactive reminders. Withdrawal stays directly accessible without a code check.

Add public `/sms-information` with clearly named SMS terms/privacy sections covering both requested codes and future date-based reminders, actual data use, customer-care contact, rates, STOP/HELP and carrier delivery limitations. Keep it outside auth proxy matching. Copy/version is server-owned and recorded with each consent. Missing customer-care contact or unfinished copy disables live OTP/enrollment; fixture configuration supplies a test contact. Do not fabricate company/contact/retention assurances or label draft terms legally approved. Before live activation the operator supplies usable contact and reviews actual terms/privacy, sender registration/coverage, Verify six-digit/ten-minute configuration, geographic permissions, Advanced Opt-Out and callback mapping. These external prerequisites do not block offline implementation; they block representing live enrollment as accepted.

### Offline provider contract tests

Default automated runs cannot contact Twilio. Add a loopback provider fixture under `tools/` and `tests/helpers/` implementing create/check responses, expiry, wrong/exhausted codes, error classes, pauses and accepted-but-lost replies, plus signed inbound callbacks. Use generated fixture OTPs available only to the test harness, never a universal application bypass.

The production-built local server may select a fixture only with an explicit server flag, exact loopback app/Supabase/fixture endpoints and a test credential. Refuse fixture mode when a deployment environment is detected, with hosted URLs, arbitrary adapter URLs, missing guard values or conflicting live config; `NODE_ENV` alone is insufficient because local browser tests use a production build. No unguarded fixture routes ship in `src/app`. Extend `tools/serve-covered.mjs` to start/stop the fixture cleanly with coverage flushing, rather than relying on an unowned background process. Unit/integration tests inject the adapter directly; browser tests exercise real actions against the fixture and local database.

## Phase 1: Persistence, access and upgrade contract

### Files and changes

- Discover CLI help and create an additive migration through `supabase migration new practice_sms_enrollment`. Implement the private tables/functions/grants, detailed read projection and lifecycle helper call from `private.mutate_member`. Preserve old migrations/API definitions.
- Add `supabase/tests/practice_sms_enrollment.test.sql`, `tests/integration/practice-sms-enrollment.test.ts` and `tools/sms-enrollment-upgrade.mjs` using existing local guards/fixture patterns.
- Refresh `src/lib/supabase/database.types.ts` and `tools/schema-contract.json` after replay. Keep private tables outside client table types.

### Automated verification

Target real SQL/API cases AC1–AC8: self/role/tenant matrix; private-table/helper and service-only proof denials; composite references; empty/read states; revision/version/no-op/conflict; missing/corrupt storage; explicit consent independent of verification; withdrawal; member invalidation including unselected staff; unchanged legacy APIs; same-JWT revocation.

Use separate sessions with observed waits for phone change versus approval, consent versus STOP, two simultaneous sends/checks, and member invalidation versus proof commit in both orders. Force audit/receipt failure and assert complete rollback. Rehearse migration transaction rollback/full catalog restoration and upgrade from the last pre-SMS migration with two populated practices, selected recipients, dates/shared coverage/archived records and all 14 historical tables populated; compare rows exactly and upgraded/fresh replay catalogs. Existing enrollments remain absent; no consent backfill.

Commands: guarded `npm run db:reset`, `npm run test:db`, targeted `npm run test:integration -- tests/integration/practice-sms-enrollment.test.ts tests/integration/practice-recipients.test.ts`, `node tools/sms-enrollment-upgrade.mjs`, `node tools/check-generated-types.mjs`. Run reset/upgrade/fault campaigns sequentially.

### Manual verification

Inspect fixture-only state/audits and grants, lock order, historical snapshots and rollback evidence. Exit: no ordinary client can mint proof and lifecycle/access invariants remain intact.

## Phase 2: Server verification adapter and request recovery

### Files and changes

- Add the SMS domain/provider/privileged modules and `/practice/sms/actions.ts`; add `schema.test.ts`, `properties.test.ts`, and `tests/unit/sms-{operations,provider,actions}.test.ts`.
- Update exact dependency pins in `package.json`, `package-lock.json` and `tools/toolchain.json`; review SDK transitives/licenses with the existing supply-chain gate.
- Extend `tools/local-environment.mjs:prepare` for required ignored local-only secret/fixture values. Read status without printing key values; preserve file mode 0600 and existing endpoint guards on every reset/upgrade.
- Replace the capability check's blanket secret rejection with an exact exception for the single server-only privileged file; preserve user-metadata and all other secret bans. Add negative import/client-secret/raw-client-export/public-secret/fixture-mode controls, using a new `tools/sms-capabilities.mjs` and `tools/sms-controls.test.mjs` included in `test:controls`.

### Automated verification

Run targeted SMS unit/property and real integration suites, `npm run typecheck`, `npm run lint`, `npm run test:controls`. Verify request binding, fake posted authority/proof/disclosure, duplicates/files, limits/clock boundaries, SID/service/phone/channel mismatch, malformed provider success, wrong/expired codes, no automatic retries, expired lease, unknown start/check, proof-commit failure and receipt recovery. Check no OTP in returned objects/receipts/logs. Test absence/configuration failures without blocking existing non-SMS routes. Update explicit mutation/property selections for new domain contracts; retain 100% thresholds.

### Manual verification

Review provider-to-proof trust boundary, dependency/environment capabilities and action output privacy. Exit: verified phone can be recorded only through a matching trusted outcome; reminder consent remains absent.

## Phase 3: Signed withdrawal callbacks

### Files and changes

- Add inbound route and webhook validation/projection module, `tests/unit/sms-webhook.test.ts`, and real API cases in the SMS integration suite.
- Add sender allowlist validation to server config; keep full form parameters available only for signature validation and sanitize before persistence.

### Automated verification

Signed fixtures cover STOP/duplicate/unknown phone/shared number, wrong account/service/sender, altered URL/fields, missing signature, repeated sensitive fields, size/type errors, START/HELP and out-of-order delivery. Hold endpoint locks to witness consent/check versus STOP; force event-storage failure and verify 503/no partial suppression, then successful retry. Assert duplicate callback produces one event/epoch transition, all readiness becomes false through the endpoint predicate, no response body exposes data and no outbound confirmation call occurs.

Commands: targeted webhook unit suite, SMS integration suite, types/lint and production build route checks. Exit: local opt-out state cannot be bypassed by stored proof or consent.

### Manual verification

Inspect sanitized fixture audit and empty response, callback URL assumptions and setup instructions. No live callback/provider send is part of this phase's automated acceptance.

## Phase 4: Enrollment and readiness interface

### Files and changes

- Add `src/app/practice/sms/page.tsx`, `src/components/sms/enrollment-panel.tsx`, `src/app/sms-information/page.tsx` and scoped `src/app/globals.css`. Integrate settings navigation and detailed shared readiness; retain old recipient repository/action contracts.
- Add `tests/unit/sms-panel.test.tsx`; extend `tests/unit/routes.test.tsx`, recipient unit tests/properties where presentation changes, and add `tests/e2e/practice-sms-enrollment.spec.ts`.
- Add `tools/sms-provider-fixture.mjs`, `tests/helpers/sms-fixtures.ts` and controlled lifecycle in `tools/serve-covered.mjs`. Keep OTP/phone tests on the private artifact policy.

### Automated verification

Run targeted unit suites, `npm run build`, and targeted SMS/recipient/team browser suites. Exercise request → wrong code → verification → no consent → explicit consent → refresh/sign-in persistence → direct withdrawal; phone replacement confirmation, resend budget, stale tabs, role/access changes, assignment of independently enrolled member, unselected enrollment, provider STOP and shared readiness. Verify enrollment updates with unchanged assignment version, viewer withdrawal/read-only status, no phone disclosure to another member and private/no-store headers. Foreign-Origin replay cannot start verification or alter consent.

Test accepted-then-aborted action/provider responses, error recovery, setup unavailable, public terms/privacy links, masked displays, OTP clearing, keyboard focus, Axe and no horizontal overflow at 375px/1440px. Disable traces/video/screenshots/automatic DOM dumps for phone/code-bearing scenarios; intentional visual captures use sanitized fixture states after code/phone inputs are removed. Assert fixture mode fails closed against hostile configuration.

### Manual verification

Inspect sanitized desktop/mobile rendering and enrollment wording. Verification never implies consent or active reminders. Distinguish agent inspection from human acceptance. Exit: AC8–AC9 have production-local browser witnesses.

## Phase 5: Verification tooling, full regression and evidence

### Files and changes

- Add `sms-enrollment-upgrade` to both layer inventories, yielding 33 required layers if this is the only additional layer. Preserve the original 32.
- Extend exact SQL TAP inventory and grant/FK/invariant controls in `tools/foreign-key-controls.mjs`; add behavioral fault cases in `tools/sql-mutants.mjs` for proof/authority/revision/consent/suppression/audit/lease boundaries. Preserve applicability of inherited `mutate_member` faults.
- Extend `stryker.config.mjs`, `stryker.properties.config.mjs`, `vitest.properties.config.ts`, checker controls and capability reporting; private catalog discovery already covers new objects. Add no arbitrary coverage exclusions or gate reductions.
- Update README after implementation with enrollment versus active-reminder distinction, limits, terminal provider STOP behavior, setup/terms prerequisites, offline tests, secret handling, rollback and E4-S2 next. Write source-bound implementation evidence under `thoughts/shared/research/`.

### Automated verification

Use Node 24.21.0 (`PATH="$PWD/.tools/node/bin:$PATH"`) and existing local Chromium. Run narrow checks after each phase, then full checks because schema, shared lifecycle functions, server secrets, dependencies and harness changed:

| Commands                                                                        | Required result                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`         | All existing/new checks pass.                                                                           |
| `npm run test:controls`                                                         | Checker changes reject planted secret/proof/fixture/import faults without weakening inherited controls. |
| `npm run db:reset`, `npm run test:db`, `npm run test:integration`               | Guarded schema/access/proof/consent/race/audit regression passes.                                       |
| `node tools/sms-enrollment-upgrade.mjs`, `node tools/check-generated-types.mjs` | Historical rows/APIs, rollback/full catalog and fresh types match.                                      |
| `npm run mutation`, `npm run mutation:properties`                               | Inherited 100% thresholds maintained; new testable mutants killed.                                      |
| `npm run build`, `npm run test:e2e`                                             | Production-local application/provider fixture and all existing browser flows pass.                      |
| `node tools/check-capabilities.mjs`, `node tools/supply-chain.mjs`              | Reviewed server boundary, pinned dependencies, runtime advisory/secret checks pass.                     |
| `npm run gauntlet`                                                              | All 33 layers pass on the actual clean committed implementation checkpoint; no live Twilio call occurs. |

The later implementation checkpoint is required by `tools/source-state.mjs`; no commit is created by this planning task. Keep reset/upgrade/mutation operations local and sequential. Record actual invocation/results, failures/recovery and acceptance coverage. Never reuse the E3-S2 release run as SMS evidence.

### Manual verification

Review final diff, full phase evidence, private data exposure, callback recovery and current-source coverage. Exit: AC1–AC10 have automated witnesses; live/manual limits are explicit.

## Phase 6: Live activation checklist and future reminder integration

### Files and changes

Write an implementation-time handoff describing actual environment/sender configuration and verification boundaries. Deploy only when the user requests rollout. Apply tested additive migration before the new app; retain the legacy API. Configure reviewed live credentials, Verify service, sender/service registration, Advanced Opt-Out, canonical callback URL, sender allowlist, usable support contact and complete terms/privacy. Default `SMS_LIVE_ENABLED` off until prerequisites are met.

### Automated verification

Read-only deployment checks verify ordinary anonymous practice denial, SMS-page login protection, callback invalid-signature denial, public information availability and legacy recipient API compatibility. They must not send an OTP, change a real phone/consent or simulate a real STOP without an explicitly designated test phone. Offline suite success is not evidence of provider provisioning or handset delivery.

### Manual verification

With a designated authorized test phone, separately witness real OTP receipt, wrong/right verification, explicit reminder consent, in-app withdrawal and signed STOP. Verify dashboard/selection readiness after each transition and callback failure/retry handling. E4-S1 acceptance can be locally complete while this live activation remains pending; hosted SMS acceptance must stay unclaimed until witnessed.

Carry forward E4-S2/S3 contracts: each future dispatch rechecks selected live membership, phone revision, current consent/disclosure, endpoint suppression epoch and provider block. Phone/consent/access/assignment changes must atomically invalidate unsent jobs once jobs exist; reconcile catch-up only for currently eligible recipients/cycles. E1-S3 rule 9 and E2-S3 date/archive cancellation remain open. START recovery and permanent-provider-block reconciliation belong to E4-S4. No read or enrollment creates a guessed job now.

## Risks and rollback considerations

- Service keys increase server authority. Only the reviewed module may hold them; functions still recheck live actor/request binding. Client import/build/asset and negative direct-RPC witnesses are release gates.
- Provider acceptance and database writes cannot be made atomic. Uncertainty conservatively leaves setup incomplete; extra verification effort is preferable to fabricated readiness. No exactly-once OTP guarantee is made.
- Private phone/audit retention and operator terms need review before live use. Do not put raw phone/OTP/provider Body in routine reports or screenshots. Retain consent proof and STOP tombstones; no destructive cleanup is introduced here.
- STOP callback availability matters when reminders later exist. Preserve endpoint suppression and provider-side blocking; future dispatch must reconcile missed callbacks and provider 21610 in E4-S4. Terminal local STOP prevents delayed START from reopening permission.
- Global phone locks serialize limited pilot enrollment traffic; no scale SLA is claimed. Existing user/practice locks must not be acquired after an endpoint lock in any SMS path.
- Roll back application code while retaining schema, consent history and suppression. Keep the validated STOP route available independently during rollback (or retain the current callback-capable deployment and disable enrollment UI/live sending); blindly promoting the old app would remove the callback. Do not drop private SMS history or restore consent through rollback.
- If provider configuration/secrets fail, disable live sends/enrollment and preserve withdrawal/read/status capability; do not silently fall back to fixtures. Future reminders remain inactive throughout this story.

## Completion criteria

Phases 1–5 and AC1–AC10 pass with current-source evidence, reviewed diff and 33-layer success, preserving all old APIs/data/access invariants. Phone verification and consent are separate; withdrawal/STOP always defeat eligibility; private state does not leak. Human acceptance and Phase 6 live activation are reported separately. E4-S2 scheduling is next; no reminder delivery or original rule-9 completion is claimed.

## Implementation progress

- [x] Phase 1: Persistence/access/upgrade.
- [x] Phase 2: Provider adapter/server trust/recovery.
- [x] Phase 3: Signed opt-out callbacks.
- [x] Phase 4: Enrollment/readiness UI and offline browser provider.
- [x] Phase 5: Full regression/verification evidence.
- [x] Phase 6 deployment: User-authorized additive migration, app promotion and read-only hosted checks.
- [ ] Phase 6 activation: Provider configuration, reviewed terms and authorized test-phone acceptance.
- [ ] User-confirmed manual acceptance.
