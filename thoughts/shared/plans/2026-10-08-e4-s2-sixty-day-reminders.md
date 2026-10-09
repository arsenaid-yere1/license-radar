# E4-S2: 60-Day Email Reminders Implementation Plan

Date: 2026-10-08 (America/Los_Angeles).
Baseline: `d037bff8c9ae4279d04fae92af52d694cadd1057`.
Status: Local implementation and all 34 source-bound verification layers complete on `codex/email-reminders`. A READY deployment candidate is held pending the hosted backup/migration decision; production promotion and email activation remain pending.
Research: `thoughts/shared/research/2026-10-08-e4-s2-sixty-day-reminders.md`.
Verification: `thoughts/shared/plans/2026-10-08-e4-s2-sixty-day-reminders-verification.md`.

## Overview

**Story:** As the responsible office manager, I receive an email reminder 60 calendar days before the configured due date so I have time to renew. Text reminders are an optional additional channel after SMS configuration and personal enrollment are complete.

Email is the E4-S2 delivery baseline. Schedule at 09:00 in the practice timezone, include the due date and an authenticated record link, and show delivery problems in the app. A missing phone, SMS consent, Twilio account, Verify service or SMS callback never blocks email. E4-S2 is complete when the email phases pass; optional SMS implementation/activation can follow independently.

The user's revision supersedes the original backlog's text-only E4-S2 and the earlier plan's SMS critical path. E4-S3 remains late-entry/reassignment catch-up; E4-S4 remains retries, uncertain-send recovery and expanded history. Preserve historical release records. Planning changes only these three documents and sends no messages.

## Current State

This is a single Next.js/React/TypeScript application. Supabase owns practice membership, dates, recipient selection and verified account identity. There is no reminder queue, worker or application reminder email adapter.

`src/lib/auth/operations.ts` sends/verifies Supabase sign-in OTPs, not reminder emails. `supabase/config.toml` enables email confirmations and captures local Auth mail in Mailpit. README records hosted Resend SMTP for sign-in, historically using an account-only test sender. That does not establish a verified reminder sender, an application API key or current production readiness.

`private.change_reminder_recipient` selects an active administrator/manager membership. Recipient reads join membership `user_id` to `auth.users.email`; email is not stored on membership. Existing recipient and SMS schemas contain literal false readiness/delivery flags, so new channel readiness must use a separate projection. There is no app email-change UI or Auth-email change tracking trigger.

`trackingDate` uses action deadline before end date. Cycles have date revisions but no completion marker. Supported register/profile/recipient/access mutations already lock the practice and retain transactional audit/receipt evidence. Existing SMS enrollment/STOP remain deployed groundwork, with live setup pending.

## Desired End State

### Product decisions

- Email goes to the selected active editor's current confirmed sign-in address. No extra email field, arbitrary destination, cached roster/JWT email or invitation address controls dispatch.
- Selecting a recipient includes transactional renewal email responsibility by default. Explain this in settings. A personal email preference lets the recipient disable future reminders or explicitly enable them again; disabling does not change assignment or SMS consent. Administrators cannot override personal email withdrawal. Personal reminder preferences do not change Auth settings or OTP operations.
- Email setup is separate from optional SMS setup. Do not require phone verification or fresh SMS consent for email, and never interpret email readiness/assignment as text consent.
- Personal email disable changes renewal notifications only. Application suppression never edits Auth settings or phone consent, but a provider-level bounce/complaint may also block sign-in mail if Auth SMTP shares the same Resend team; do not promise provider delivery isolation without separate verified provider teams/transports.
- Fixed lead is 60 calendar days; normal target is 09:00 practice-local. Effective date is action deadline when present, otherwise end date. Shared coverage produces one record reminder, regardless of clinician count.
- Ordinary eligibility must exist by the nominal target. New/changed records, assignment, email verification/address or re-enabled preference established afterward receive a visible **Catch-up not available yet** marker for E4-S3. An existing normal job delayed by an outage stays recoverable. Missing dates never produce guessed reminders.
- Send window is 09:00 inclusive to 17:00 exclusive. A delayed eligible normal job outside it waits until the next 09:00. Include accurate due-today/past-due copy. Aim for submission within 15 minutes of the target during the pilot; this is not an inbox placement guarantee.
- Date/timezone changes recompute unsent work; archive/completion, recipient/access changes, address/confirmation changes, personal disable and hard-bounce/complaint suppression block stale submissions.
- Every consumed submission retains a guard per cycle/recipient user/channel, including failed and uncertain attempts. Date/address/selection changes, revoke/rejoin with a different membership ID and A → B → A cannot silently retry. Logical jobs retain membership identity; the cross-job guard uses stable user identity. No automatic cross-channel fallback. Optional SMS, when later enabled before a target, is an additional deliberately opted-in reminder, with its own guard/status.
- Subject: `Renewal reminder: due {date}`. Plain text and minimal escaped HTML contain the due date/year, authenticated record link, and authenticated email-preference link. Omit clinician/practice names, record titles, credential numbers, attachments and bearer tokens. No open/click tracking. Provider acceptance, delivery to the receiving mail server and renewal completion are distinct.

| ID   | Acceptance criterion                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1  | Additive migration preserves all 21 historical application tables and existing API shapes. No old SMS consent, provider attempts or past-window dispatch is invented.                                                                                                    |
| AC2  | SQL calendar arithmetic/local 09:00 handles leap years, DST, non-hour offsets and supported year bounds; missing/invalid dates fail visibly.                                                                                                                             |
| AC3  | Concurrency/replay produces one logical job per cycle/revision/member/lead/channel. Shared policies do not multiply email.                                                                                                                                               |
| AC4  | Begin-submit rereads live membership, current incomplete cycle/revision, archive, selected responsibility, current confirmed Auth email, account/preference version and email suppression. SMS configuration has no influence on email eligibility.                      |
| AC5  | Supported domain/preference mutations invalidate work and update outbox/audit atomically. Auth changes advance authoritative address state atomically and reject old claims even before reconciliation.                                                                  |
| AC6  | Bounded authenticated worker grants one provider POST permission per consumed attempt. Crashes/ambiguous replies become visible uncertainty without automatic replay/replacement.                                                                                        |
| AC7  | Verified email webhooks bind provider namespace/email ID/attempt and preserve monotonic status; hard bounce/complaint suppress that email endpoint without changing phone consent or Auth settings. Shared-provider delivery suppression is an explicit activation risk. |
| AC8  | Active roles read authorized email schedule/status; recipient controls own email preference. Existing recipient/SMS API contracts remain compatible and UI distinguishes channels.                                                                                       |
| AC9  | Offline SQL/API/provider/browser/property/mutation/upgrade checks pass. Heartbeat/due lag are visible; prior SMS fixture evidence is not email delivery evidence.                                                                                                        |
| AC10 | Live email defaults off until sender/API/webhook/scheduler setup is complete. Email can activate with all SMS settings absent. Optional SMS is independently disabled until its own full configuration and consent gates pass.                                           |

## Key Discoveries

1. Account email is already verified for normal sign-in, but existing recipient selection does not itself verify the email for dispatch. Read `auth.users.email_confirmed_at` and the current address under a user-row lock.
2. Supabase Auth SMTP handles authentication messages. Use a dedicated Resend application send API; do not abuse sign-in OTP/template functions to send reminders or assume Auth SMTP secrets are available to the app.
3. Auth changes run while holding the Auth user row. A tracking trigger must never acquire practice/domain/job locks. Existing schema catalog ignores Auth triggers; explicitly inventory only the new application-owned Auth trigger.
4. `src/lib/sms/privileged-repository.ts` is currently the sole secret-key client boundary. Extend named service methods there, despite its historical name, and update capability controls rather than creating a second unrestricted client.
5. Adding `completed_at` breaks old cycle `SELECT *` upgrade comparisons unless both inherited upgrade tools capture pre-change columns and assert the new null marker separately.
6. Resend's idempotency key expires after 24 hours. Durable database guards remain necessary; no blind resend follows that expiry.

## What We Are Not Doing

- Catch-up dispatch, extra intervals, aggregation, backup recipients, automatic retries/manual resend or complete history/recovery UI (E4-S3/E4-S4).
- E5 renewal completion UI/successor-cycle writing. A minimal completion exclusion marker is groundwork only.
- Arbitrary contact email editing, newsletter/marketing mail, attachments, click/open analytics or automated channel fallback.
- SMS Messaging adapter, fresh delivery consent or live text activation in the mandatory email phases. Preserve existing Verify/STOP behavior; optional SMS work is separately gated below.
- Provider accounts, DNS changes, live scheduler registration, deployment or actual email/text sending during planning. E8 external alert integration and backup restoration remain launch work.

## Implementation Approach

### Scheduling and durable state

Create an additive CLI-named `practice_reminder_jobs` migration after checking CLI help; do not edit old migration files. SQL owns `(effective_date - 60 + time '09:00') AT TIME ZONE practice.timezone`. Round-trip local conversion; skipped targets fail visibly. Specify/test PostgreSQL's standard-time resolution for ambiguity. Outside AD years 1–9999, retain a date-range/catch-up reason without exposing BC dates.

Add nullable `credential_cycles.completed_at`, default null; select greatest cycle number and require it incomplete, never fall back to an old cycle. Permit at most one incomplete cycle per credential; leave public historical projections unchanged.

Job states are blocked, queued, claimed, submitting, accepted, failed, suppressed, canceled and uncertain; blocked reasons distinguish missing verification/preference/configuration, unsupported dates and unavailable catch-up.

New private objects (including `reminder_email_preference_requests` for exact receipts and `reminder_email_preference_events` for append-only personal preference audit):

| Object                         | Contract                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reminder_jobs`                | Composite tenant references; unique cycle/revision/member/lead/channel; channel discriminator with email as the only writable value in this release. Stored nominal local/UTC target, next send, eligibility onset, selected/account/preference/endpoint versions, reason/state and pre-submit lease/token. |
| `reminder_message_attempts`    | Immutable channel, destination/from/reply-to/subject/plain-text/HTML/date/configuration snapshots; attempt token, submission start/deadline, stable idempotency key, provider namespace/ID and sanitized outcome. Unique provider ID and consumed guard per cycle/user/channel.                             |
| `reminder_job_events`          | Append-only sanitized schedule/claim/invalidation/result provenance with user or explicit service actor.                                                                                                                                                                                                    |
| `reminder_reconcile_outbox`    | Dirty generation per practice and fair persistent pagination/cursor. Remove only the processed generation.                                                                                                                                                                                                  |
| `reminder_delivery_events`     | Minimal deduplicated provider event ID/message ID/status/error evidence; no raw payload.                                                                                                                                                                                                                    |
| `reminder_worker_runs`         | Heartbeat, scan outcomes, oldest due lag and failed/uncertain counts; no destinations/content.                                                                                                                                                                                                              |
| `reminder_email_preferences`   | Per practice/user, enabled default, version, enable/disable onset, exact mutation receipt/audit evidence; personal authority. Retain disable across address changes and revoke/rejoin, including replacement membership IDs.                                                                                |
| `reminder_email_account_state` | Auth user ID, current address/confirmation snapshot, revision/onset and dirty generation. No FKs/triggers acquiring practice/domain locks. Retain a tombstone for deleted accounts.                                                                                                                         |
| `reminder_email_endpoints`     | Provider namespace plus canonical address, suppression/epoch/reason; hard bounce/complaint never auto-clear on reenabling or address reuse.                                                                                                                                                                 |

Enable private RLS; revoke direct access for PUBLIC/anon/authenticated/service. Private definer implementations use empty search path; public wrappers are invoker functions with explicit named grants. Index due jobs, expired submitting attempts, cancellation, endpoint/account lookup and dirty pagination. Deterministic clock helpers are fixture-only private functions; production wrappers choose database time, limits and payloads.

Initialize email defaults/account state and dirty practices at a recorded feature-start instant without creating jobs or sending anything. Existing selected recipients' email eligibility starts no earlier than that instant; newly introduced email must not manufacture historic ordinary sends. Persist eligibility onset as the latest of feature enable/default or personal reenable, record/current date revision, timezone basis, assignment and current confirmed email revision. Historical domain evidence supplies earlier dates; unchanged retries/metadata edits do not reset onset. Outage reconciliation never uses the scan time as eligibility onset.

### Live identity, invalidation and locks

Extend `private.finish_register_create`, `private.apply_credential_change`, `private.update_practice` and `private.change_reminder_recipient` through the new migration for transactional dirty generation/cancellation. Member-induced selection clear already uses the recipient boundary. New personal email preference RPC locks practice and cancels pending email work with receipt/audit; a viewer may disable their own retained preference, while enabling requires a current editor membership. No-op/replayed preference requests do not change eligibility epochs.

Recipient assignment creates a default email preference only if none exists, in that transaction with authoritative assignment time; it never overwrites a prior disable. New practices stay unassigned until selection. Missing preference reads show the documented default without writing or using read/reconcile time as an eligibility epoch. Store new preference request receipts and append-only preference events in dedicated private tables with composite practice/user authority, request UUID, intent/version/result and actor/time. Keep replay after selection/address changes exact; audit/receipt failure rolls back preference, invalidation and outbox together.

Add one narrowly scoped Auth-user trigger on insertion/deletion and actual email/confirmation changes. It updates only private account state/version/dirty marker under the Auth row transaction. Ignore unrelated metadata/session changes and pending unconfirmed replacement fields while the current confirmed email remains unchanged. It performs no network calls or practice/domain/job writes; its private writes have no indirect domain FK locks. Account bookkeeping must not add a restrictive Auth FK that prevents otherwise permitted user deletion. A deleted/unconfirmed/changed address invalidates old begin-submit snapshots immediately through version/live checks, though displayed job cancellation is completed by bounded reconciliation. Preserve personal disable across address changes and revoke/rejoin independently of provider endpoint suppression.

Worker order: practice → Auth user row (locking mode conflicts with address updates) → account state → email endpoint → domain/job/attempt → practice outbox. Discover candidates/dirty accounts without prior row locks, then use nonblocking/skip outcomes under this order. Never lock an outbox before practice or account state before Auth. Drain dirty account generations through affected memberships with bounded pagination and acknowledge only the processed generation. Queue hints do not authorize sends. Auth-trigger insertion/backfill ordering must be race-safe and transactional.

Email provider suppression locks only endpoint → matching jobs/attempt/event rows, never Auth/practice/domain rows, including indirect FK/trigger locks. Domain invalidation already holding practice must not acquire an endpoint after job locks. Network calls never hold database locks. Witness both orders of Auth edits, preference changes, domain invalidation and provider suppression versus begin-submit.

### Email provider, worker and callbacks

Use Resend HTTPS REST with bounded built-in `fetch`, fixed production `https://api.resend.com` and no automatic retries. Add the official `svix` signature-verification dependency, pinned exactly during implementation with supply-chain/lockfile/toolchain evidence. No Resend SDK is needed for HTTP sending. This choice follows documented existing Resend use; actual credentials/sender readiness still require activation.

New server-only reminders modules: `{schema,repository,config,messages,email-provider,worker,email-webhook}.ts`; named service RPC exports in the existing privileged module. Add POST `/api/reminders/run` and POST `/api/reminders/email/webhook` (Node runtime, dynamic, no-store).

Configuration: `REMINDER_WORKER_SECRET`, `REMINDER_APP_URL`, `EMAIL_REMINDERS_ENABLED=false` by default, `RESEND_API_KEY`, fixed `EMAIL_FROM`, support `EMAIL_REPLY_TO`, stable `EMAIL_PROVIDER_NAMESPACE`, `RESEND_WEBHOOK_SECRET`. Validate addresses/HTTPS origins/header injection and reject test sender for general live rollout. None depends on Twilio or `SMS_LIVE_ENABLED`. Fixture mode requires explicit fixture flag plus fixed loopback app/database/provider URL/token and refuses deployments/live secrets; extend protected local preparation without writing secrets to `.env.test.json`.

Authenticate worker bearer before storage/provider access; reject unexpected/oversized request payload, tenant/job/time overrides and unsupported method. Return aggregates only. Internal deadline 45 seconds, route ceiling 60 seconds, page 100 and at most four sequential ten-second provider calls. Storage RPCs get five-second abort/function/lock limits with real PostgREST stall checks. Reserve result-save time/shutdown slack, stop starting work when budget is insufficient, and leave remaining work durable. Sweep expired submitting attempts even when no queued/outbox work exists.

1. Reconcile dirty practices/accounts and classify normal/missing/catch-up/blocked work without shifting valid targets to now.
2. Claim due email jobs for 30 seconds; only expired pre-submit claims can be reclaimed.
3. Begin-submit rechecks AC4 under locks, consumes the channel guard and commits immutable attempt/payload/deadline. Only an observed successful first transition authorizes POST; a lost reply permits read-only resolution, never POST.
4. Send one recipient using fixed from/reply-to, subject, text and HTML; tag with opaque attempt UUID and use `Idempotency-Key: reminder-email/{attemptId}`. A valid response ID is accepted, not delivered. Never schedule in the provider, batch recipients or follow untrusted redirects.
5. Save matched outcome by persisted attempt token. Lost reply/result, malformed response or timeout becomes uncertain; sweep interrupted submissions by deadline. A trusted late result resolves only that attempt, never clears the guard. Every definitive failure also retains the guard for E4-S4.

Email callback verifies raw bounded UTF-8 bytes (64 KiB maximum) with official Svix verifier, signature headers, timestamp/replay tolerance and configured webhook secret before JSON processing/storage. Dedupe event IDs in provider namespace. Verify message ID and one destination/from against the bound attempt. A webhook arriving before result persistence can use signed attempt tags; if needed, GET the provider email with the configured API key in ten seconds and verify its opaque tag, sender and exact destination. Bind only that consumed submitting/uncertain attempt; never bind by destination alone. Retryable binding/storage failure returns 503 without partial mutation.

Keep accepted/sent/delayed separate from delivered/bounced/failed/suppressed/complained. Delivered means receiving mail-server acceptance, not read/inbox placement. Late delivered/progress cannot erase bounce/complaint/suppression; conflicting terminal evidence stays an anomaly. Hard bounce/complaint atomically suppress the email endpoint and pending email jobs, including shared addresses across practices. Provider failures without a trusted hard-bounce/complaint reason do not invent global suppression. Unknown event types do not mutate eligibility. Callbacks stay operational with sending off; never log payload/address/body or auto-resend.

### Interface and compatibility

Add read-only `/practice/reminders` with cursor-bounded record/date-purpose/local target, email readiness/status/reason and refresh/record/settings links, readable by all active roles. Add personal email preference action/read and form; others see the existing authorized recipient identity, not private attempt/body/provider IDs. Reflect stale heartbeat (>15 minutes), due lag and catch-up gaps.

New channel projection reports email and optional SMS independently. Keep `src/lib/recipients/schema.ts`, old recipient RPCs and SMS literal-false contracts intact; UI uses the new projection instead of declaring email blocked by `sms-setup-pending`. Settings says email is primary and text is optional. SMS enrollment stays available with existing semantics; no v1 consent upgrade, phone setup prerequisite or change to STOP/withdrawal. Register detail/global copy must distinguish email scheduling from inactive optional texts; public SMS information retains accurate SMS wording.

### Scheduler and activation

Use Supabase Cron → `pg_net.http_post` once per minute to one fixed authenticated worker URL, Vault URL/token references and explicit 55-second HTTP timeout. No paid Vercel cron assumption, live cron in migrations or secrets in source. Local fixtures call the same worker directly.

Activation verifies actual runtime/extension privileges, cron/net request confidentiality, sender domain verification/SPF/DKIM/DMARC, API key scope, working reply/support address, signed event subscriptions, provider namespace stability, disabled analytics, quotas and a designated test email. Verify received email, status and suppression on authorized fixtures/test destination before claiming live acceptance. Email activation does not wait for Twilio. Record operator health/disable tooling; external alert-channel integration remains E8.

Record whether reminder API and Auth SMTP share a Resend team: provider suppressions cover that whole team, including other sending domains. If delivery isolation is required, verify separate teams/providers rather than assuming a separate key/subdomain isolates Auth mail. Otherwise document shared suppression and operator recovery risk; never automatically remove provider suppression to restore sign-in delivery.

### Optional SMS after configuration

SMS is a separate optional additive enhancement, not an E4-S2 email completion dependency. Preserve E4-S1 code/history and its activation handoff. Before any text send: configure registered Twilio account/Verify/Messaging service/sender, canonical signed STOP/status callbacks, support and reviewed terms; obtain fresh explicit delivery consent because v1 copy says delivery inactive; independently enable `SMS_REMINDERS_ENABLED` and opt the recipient into additional texts.

Future SMS work extends writable channels/job keys and payload/config/eligibility by channel, with separate consumed guards and per-channel outcomes. It adds the Twilio Messaging adapter/status verifier and SMS-only lifecycle invalidation. Phone edits/withdrawal/STOP cancel SMS only; email bounce/disable cancel renewal email jobs only, while shared-provider Auth delivery risk remains documented. A known opt-out rejection without a SID needs distinct attempt-bound provenance, not a fabricated inbound STOP event. Enabling SMS after the ordinary target cannot backfill texts in E4-S2; classify that as future catch-up. No automatic text fallback after email failure and no text activation solely because configuration exists. Independently test all these cases before enabling it.

## Phase 1: Email scheduling, identity and compatibility

### Files and changes

- Add migration/tables/selector/email preference/read APIs and narrow Auth trigger.
- Add `supabase/tests/practice_reminder_jobs.test.sql`, `tests/integration/practice-reminder-jobs.test.ts`, `tools/reminder-jobs-upgrade.mjs` and fixture helpers.
- Update `tools/schema-catalog.mjs` to inventory the named app Auth trigger; regenerate database types/schema contract.
- Update both `tools/sms-enrollment-upgrade.mjs` and `tools/register-maintenance-upgrade.mjs` to capture original cycle columns and separately check new null completion markers.

### Automated verification

AC1–AC3/AC8: all 21 historical tables populated/preserved, old receipt/response compatibility, new email defaults/feature epoch, no migration jobs/attempts or modified SMS ledgers, full transactional rollback and fresh-replay catalog equality including Auth trigger. Test grants/tenant FKs, role matrices, private deterministic time, latest incomplete cycle, unknown dates, late feature setup and shared policy uniqueness. Exact SQL targets cover UTC, Los Angeles/New York, Kathmandu, Lord Howe/Apia, leap-century/year bounds and skipped targets.

Run guarded `npm run db:reset`, `npm run test:db`, new integration suite, new/inherited upgrade rehearsals, generated-type check and `npm run typecheck`, with database resets/rehearsals sequential.

### Manual verification

Review default transactional email wording, historical preservation and Auth-trigger privileges/lock footprint; no hosted writes.

## Phase 2: Atomic lifecycle and email identity

### Files and changes

Extend the named mutation boundaries/new preference RPC and real SQL race/fault fixtures. Add account-trigger and endpoint suppression controls; keep SMS operations unchanged.

### Automated verification

AC4–AC5: date/timezone/archive/completion/selection/access, Auth address/confirmation/delete, pending unconfirmed change versus final changed address, personal disable/reenable/no-op and shared-email bounce/complaint. Witness lock waits or skip outcomes in both orders, dirty-generation races, failure rollback and stale tokens. Show SMS STOP/phone/consent changes never suppress email, and personal email disable never changes SMS or Auth mail operations/settings. Provider hard-bounce/complaint suppression may affect shared-team Auth delivery; fixture assertions cover app-state isolation only. Every consumed outcome remains guarded across revisions/reassignment and replacement membership IDs. Unrelated Auth metadata/sign-in writes are no-ops, and personal disable survives address changes/revoke/rejoin. Auth account bookkeeping must not block otherwise permitted deletion.

Run new and inherited register/recipient/access/SMS integration suites and all SQL checks. Exit: no old address/authority can pass begin-submit after a committed change.

### Manual verification

Review network-boundary semantics and concrete lock/FK order. Auth trigger failures must roll back; do not hide the risk of breaking sign-in writes.

## Phase 3: Email worker and signed provider events

### Files and changes

Add reminders modules/routes, named privilege exports, `.env.example`, guarded `tools/email-provider-fixture.mjs`, `tests/helpers/email-fixtures.ts` and production-local fixture ownership/preparation. Add exact Svix dependency and update manifests/inventory evidence. Extend capability allowlist/negative controls.

### Automated verification

AC4/AC6/AC7/AC10: empty SMS configuration with successful fixture email; disabled/missing email config zero sends; auth/body rejection; concurrent claims; expired pre-submit reclaim; lost begin reply zero POST; provider/DB response loss; empty-work expiration sweep; late matched result/webhook; budget/lock stalls and no retries. Count actual provider POSTs. Verify subject/text/escaped HTML/link/tag/key, one destination and exact frozen payloads.

Raw-body signature tests cover tampering, missing/expired headers, replay, invalid UTF-8/oversized stream, unknown event types, callback before result/after uncertainty, foreign namespace/ID/tag/sender/address, duplicate/out-of-order/conflicting status, hard bounce/complaint shared-endpoint cancellation, 503 persistence failure and callback operation with sends off. Fixtures emulate documented Resend payloads, never send external mail or rely on Auth Mailpit OTP capture as reminder proof.

Run targeted unit/integration tests, `npm run test:controls`, typecheck/lint/build. Exit: durable honest email outcomes and one consumed submission permission.

### Manual verification

Inspect sanitized fixtures, SDK signature dependency, time limits/import boundary and provider payload privacy.

## Phase 4: Email readiness, preferences and scheduling UI

### Files and changes

Add reminder page/panel/personal preference actions; update practice/recipient/detail messaging for email-first readiness, with optional SMS shown separately. Add scoped route/component and `tests/e2e/practice-reminders.spec.ts` tests. Retain old RPC/schema shapes and historical consent evidence.

### Automated verification

AC8–AC10: verified email assigned with no phone/Twilio, unverified/missing/disabled/suppressed email, preference authority/stale version/foreign Origin, queued/accepted/delivered/bounced/complained/uncertain, late/missing dates, pagination/refresh/health age, viewer reads/personal disable and revoked/foreign access. Email link requires sign-in/live authority; account change does not leak old private destinations. Existing OTP and SMS enrollment/withdrawal/STOP browser flows pass unchanged. Check Axe/focus/375px/1440px and no private payload in logs/artifacts.

Run scoped unit tests, production-local build/browser suite. Exit: users understand email status and optional SMS without overstating delivery.

### Manual verification

Inspect minimal HTML/plain-text fixtures and sanitized mobile/desktop status/preference copy. Distinguish automated, agent-inspected and user-confirmed acceptance.

## Phase 5: Regression and email activation handoff

### Files and changes

Extend explicit SQL/control/property/mutation inventories and capability/supply-chain reports; preserve existing positional indices, mutant intent, rollback/restoration and 100% thresholds. Add upgrade layer to `tools/layers.json`/`tools/gauntlet.mjs` (34 if sole new layer). Update `tools/toolchain.json`/dependency inventory for Svix. Add operator scheduler/health setup and handoff. After implementation, update current README workflow and next-story status to email first, preserving historical SMS release records. Record source-bound evidence under research/handoffs.

### Automated verification

Use bundled Node 24.21.0. Required final commands: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:controls`; `npm run db:reset`, `npm run test:db`, `npm run test:integration`; `node tools/reminder-jobs-upgrade.mjs`, `node tools/sms-enrollment-upgrade.mjs`, `node tools/register-maintenance-upgrade.mjs`, `node tools/check-generated-types.mjs`; `npm run mutation`, `npm run mutation:properties`; `npm run build`, `npm run test:e2e`; `node tools/check-capabilities.mjs`, `node tools/supply-chain.mjs` and `npm run gauntlet` on a clean committed implementation checkpoint. Reset/fault/mutation work stays sequential. Planning creates no commit. Explicitly format/check thoughts with ignore override. Review final diff and record actual commands/results, not historical run counts.

### Manual verification

Review email-only activation/disable checklist, Auth rollback compatibility, Vault template, verified sender requirements and safe callback retention. Actual live acceptance remains separately recorded.

## Risks and rollback considerations

- **Provider setup:** existing sign-in SMTP/test sender is insufficient evidence for general reminder delivery. Email has its own activation gates; SMS configuration is not an email activation requirement. Do not buy services or change DNS during planning.
- **Auth integration:** a broken trigger can disrupt Auth. Keep it minimal/private, test real Auth changes, inventory exact app trigger and verify removal/recreation rollback without editing provider-managed Auth schema columns.
- **Uncertainty/suppression:** provider acceptance cannot be withdrawn after begin-submit. Never clear guards or endpoint tombstones to retry. Resend's 24-hour key is supplemental protection only; failures stay visible until E4-S4.
- **Scope/capacity:** late setup needs E4-S3; completion needs E5; operational alerts/restore acceptance remain launch work. Bounded pilot throughput requires load rehearsal/lag visibility.
- **Rollback:** disable email flag and unschedule the named worker first. Keep event processing, personal disable, retained attempts/email suppression and existing SMS STOP available. Retain additive schema or use a tested rollback that preserves account-version/guard history. Keep Auth sign-in configuration unchanged. SMS flags remain independent; no fallback automatically sends texts.

## Completion criteria

Mandatory phases 1–5 and AC1–AC9 pass with reviewed current-source evidence; AC10's independent default-off behavior is verified locally. Record live email configuration/acceptance separately when authorized. Optional SMS is allowed to remain unconfigured/off and does not affect E4-S2 email completion. New API shapes never overwrite old false SMS contracts. No other story is implicitly complete.

## Implementation progress

- [x] Phase 1: Email scheduling, identity and compatibility.
- [x] Phase 2: Atomic lifecycle and email identity.
- [x] Phase 3: Email worker and signed provider events.
- [x] Phase 4: Email readiness, preferences and scheduling UI.
- [x] Phase 5: Regression and email activation handoff.
- [ ] Separately authorized live email activation and acceptance.
- [ ] User-confirmed manual acceptance.
- [ ] Optional later SMS implementation/configuration/explicit enrollment/activation (not required for email story).

## Visible implementation refinements — 2026-10-08

The payload uses the fixed subject `Credential renewal reminder: 60 days`; the body states that it was scheduled sixty days before the due date, preserving truth when an outage delays submission. This replaces the earlier date-specific subject proposal and avoids suggesting a delayed email is still exactly sixty days before due. Dates remain explicit in both bodies. Preference input versions are bounded by PostgreSQL integer range; posted booleans/versions must be canonical, with duplicate/uploaded values rejected. Transient/unknown bounce classification maps to a failed delivery without global suppression. Provider response bodies are bounded at 64 KiB as well as request/callback bodies.

The first full regression exposed fixture interference: new one-incomplete-cycle uniqueness masked an existing foreign-key witness, corrected by marking only the foreign completed fixture; reminder setup now isolates its practice queue priority without clearing other outbox work. Two inherited browser fixtures that discover the latest membership failed while an integration fixture run was active and passed in an isolated rerun; database/browser/fault campaigns must remain sequential. None of these corrections weakens behavioral assertions or verification thresholds.

Additional verification refinement: terminal/consumed or blocked status rows omit a future sending-window label because E4-S2 does not retry them. Only queued/claimed rows show their rescheduled window. Preference feedback yields to newer refreshed server versions. Both changes enforce the existing truthful-status/current-authority contract and have observed assertion-failure witnesses. Browser/Node coverage from earlier builds must be cleared before final collection so map identities cannot borrow stale artifacts.

## Local automated phase checkpoint

- [x] Phase 1: additive schema, calendar/identity defaults, grants, populated 21-dataset email upgrade/rollback, inherited SMS/maintenance preservation and generated types.
- [x] Phase 2: atomic lifecycle/consumed guards, Auth changes, preferences, two-order suppression races, rollback and tenant authority witnesses.
- [x] Phase 3: guarded provider/worker/signed callbacks, one-POST uncertainty behavior, real PostgREST deadline, capability controls and production build.
- [x] Phase 4: authorized schedule/preferences, stale server refresh, no misleading terminal send window, real browser/accessible responsive fixtures.
- [ ] Phase 5: final source-bound 34-layer gauntlet and evidence (local checkpoint authorization still needed).
- [ ] Manual/user-confirmed acceptance and separately authorized hosted email activation.

These checkboxes refer to local automated witnesses, not hosted acceptance. All 386 unit tests, 163 integration tests, 182 SQL assertions, 54 browser cases, 116 SQL faults, 109 database controls and 25 checker/13 UI sensitivity controls have passed their recorded runs. Results that preceded later UI/test edits remain intermediate; final gauntlet evidence must identify a clean committed source state.

## Verification continuation — 2026-10-09

The latest unit inventory is 387 cases, superseding the 386-case checkpoint above after the generated duplicate-form witness was added. The standalone access fault campaign rejected two browser timeouts rather than counting them as assertion failures; its `finally` restored the exact database function and schema fingerprint. A retry lacked a fresh full browser inventory, and the following full-suite launch exceeded the existing 60-second server startup limit. No assertions, inventories or timeouts were relaxed. A separately started diagnostic server subsequently returned HTTP 200 for `/login` and was stopped cleanly before another sequential full-browser/access-fault/shuffled-order run. These are intermediate execution issues, not a passing final gauntlet. Local checkpoint approval remains pending; no commit, push or live activation has occurred.

The later full run passed 53/54 with an inherited resend interval failure; its isolated corrected-selector rerun passed, and a new full suite passed all 54 cases with unchanged limits. That sequential campaign then passed all ten access attacks, the strict-input property fault and nine administrator-browser assertion failures with exact restoration, all 54 shuffled browser cases and the combined 1,670/1,670 executable-line coverage gate. The pre-checkpoint ledger records commands, failures and latest counts. Phase 5 remains open solely for the complete clean-source gauntlet and its source-bound evidence; user-confirmed/manual and hosted acceptance remain separately unchecked.

## Final local verification and release preparation — 2026-10-09

The user's explicit “push to prod” supplied checkpoint/release authorization. The fresh unchanged 34-layer gauntlet passed on commit `5d0dbd14863a76a7683fad87ac534490f6444cd3`, SHA-256 `5322943041bbccf2710159d95af1134351c64da95c0f1a936975f0d2cdcc547a`, run `0952905c-e4e7-4a43-9376-4c929bd35512`. This completes local phase 5 and supersedes the historical pending-checkpoint statements above. Counts, actual commands and limits are in `thoughts/shared/research/2026-10-09-e4-s2-implementation-evidence.md`; no preimplementation spec approval or independent implementation verifier is claimed.

The exact archive produced a READY Vercel candidate. All existing production hostnames remain on the prior deployment; hosted migration and promotion are held because automatic approval review rejected the proposed production-data backup export and the user has not supplied a backup decision. Candidate HTTP checks are blocked by Vercel sign-in protection. Release identities, evidence and remaining steps are in `thoughts/shared/handoffs/2026-10-09-e4-s2-production-release.md`. Live email configuration, manual acceptance and optional texts remain separately unchecked.
