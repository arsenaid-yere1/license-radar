# E4-S3: Catch-Up Email Reminders Implementation Plan

Date: 2026-10-09 (America/Los_Angeles).
Baseline: `ac3cc079fde95fc05341752b8a00de8cd0f9cc11`.
Status: Implementation and all 35 current-source verification layers complete. Matching archive/upload validation, authorized private backup, additive production migration and matching application promotion passed. Hosted verification passed 60 checks and signed-in read-only inspection; historical data and Auth identity were preserved. Provider/scheduler and received-mail acceptance remain separate.
Research: `thoughts/shared/research/2026-10-09-e4-s3-catch-up-reminders.md`.
Verification: `thoughts/shared/plans/2026-10-09-e4-s3-catch-up-reminders-verification.md`.

## Overview

**Story E4-S3, P0:** As the responsible office manager, I receive a catch-up email for newly entered or reassigned items already inside sixty days, including due-today and past-due items, so late setup does not hide renewal risk.

Continue the email-first decision recorded in the revised E4-S2 plan and current README. Optional SMS delivery remains independent. Implement catch-up through the existing durable email pipeline; do not create a second sender or bypass its consumed-attempt guard.

## Current State

This is one Next.js application with logical route/UI/domain/database/test/tool ownership boundaries described in the research. Supabase owns date arithmetic, live eligibility, transactional invalidation, bounded reconciliation, worker claims and submission permission. The server worker submits frozen Resend payloads; the reminder page exposes an authorized status projection and personal preferences.

E4-S2 is released, with provider/scheduler activation still pending. `private.email_reminder_context` blocks otherwise eligible records when persisted eligibility onset is later than the nominal sixty-day target. ER03 verifies this behavior. Existing delayed ordinary jobs recover through the local sending window, but new late entries and reassignment do not send.

Job uniqueness is cycle/revision/membership/lead/channel; consumed permission uniqueness is cycle/user/channel. Failed and uncertain attempts remain consumed. Both claim and begin-submit currently use the nominal target for scheduling-window checks. SQL freezes the message and the TypeScript validator accepts one fixed sixty-day subject. The v1 schedule response is strictly validated.

## Desired End State

### Resolved scheduling decisions

1. The effective due date remains the action deadline when present, otherwise the end date. Unknown/unsupported dates stay blocked; no guess is introduced.
2. Preserve `nominal_target` as effective due date minus sixty calendar days at 09:00 in the practice timezone. Preserve the existing supported date range and skipped-target rejection.
3. Classify ordinary work when persisted eligibility onset is **at or before** the nominal target. Classify catch-up when onset is **after** that target and all other eligibility checks pass. Scan time never replaces onset. Entries sixty days out before local 09:00 remain ordinary; those established after 09:00 are catch-up.
4. Add a distinct `dispatch_target`: nominal target for ordinary work; the first permitted instant at/after persisted onset for catch-up. At 09:00–16:59:59 local, catch-up is immediately eligible; before 09:00 it waits until 09:00, at/after 17:00 until the next valid local 09:00. Calendar conversion must round-trip. Search at most eight local dates (candidate date plus seven successors), rejecting skipped instants and dates outside years 1–9999; return the existing visible invalid-target block if none works. Use PostgreSQL's existing standard-time resolution for ambiguous conversions and test it. Never submit outside the local window.
5. `next_send_at` is the next permitted instant at/after both dispatch target and the worker's current time. Repeated reconciliation/outages can advance this execution hint without changing the original dispatch target or classifying ordinary delayed work as catch-up.
6. Catch-up covers late creation, date corrections, assignment to a new recipient, first confirmed/current email eligibility, preference reenabling and timezone changes. These use existing persisted onset/version evidence and transactional dirty markers. Metadata edits, exact retries and no-op selections/preferences do not reset onset.
7. Retain **one consumed email attempt per cycle/user**, across all scheduling kinds, revisions, addresses, membership IDs and outcomes. Reassignment from A to B can give B their first attempt; B → A cannot resend to A if already consumed. A date correction before any attempt can replace unsent work; after any attempt, it cannot automatically resend. This deliberately preserves the stricter released E4-S2 contract while meeting the backlog's maximum-one-per-logical-job criterion. Retries/manual updated reminders remain E4-S4 work.
8. Archive/completion, live selection/access, current confirmed Auth email, personal disable and endpoint suppression remain authoritative at begin-submit. SMS state never determines email eligibility. An attempt already committed cannot be retracted by a subsequent edit; no network calls hold database locks.
9. Existing records blocked solely for catch-up become eligible through a one-time dirty-practice enqueue at migration, followed by ordinary bounded reconciliation. Migration creates no new jobs or attempts and performs no external action. No age cutoff is added for valid past-due dates. Existing consumed/suppressed history is retained.
10. Catch-up activation uses the existing default-off email sending gate; there is no second automatic-send flag. Deploy with sending disabled, deploy matching payload validators, inspect prospective backlog with a read-only aggregate context query, then activate through the existing email operational workflow. A disabled worker does not reconcile, so do not rely on disabled worker runs to materialize preview jobs. Planning does not activate it.

### Acceptance criteria

| ID   | Required behavior and evidence                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CU01 | 61/60/59/0/negative-day cases select ordinary/catch-up correctly, including exact 09:00 onset equality and action-deadline precedence. Missing/range/skipped dates remain visible blocks.                                                                                                   |
| CU02 | Catch-up dispatch target is stable from onset; sends respect 09:00 inclusive/17:00 exclusive across DST, leap/year boundaries and fractional-offset zones. Delayed normal work retains its kind and nominal target.                                                                         |
| CU03 | Repeated/concurrent reconciliation and claims produce one logical job and at most one observed permission/provider POST per cycle/user/email, including normal/catch-up transitions and A → B → A.                                                                                          |
| CU04 | Date/timezone/assignment, Auth address/confirmation, preferences, archive/completion/access and shared-endpoint suppression revoke stale leases. Both race orders and transaction rollback retain current authority.                                                                        |
| CU05 | Failed reconciliation/cursor interruption, lock contention, worker-budget exhaustion and expired pre-submit claims recover on later runs without skipped records or a second consumed permission. Interrupted submitting attempts stay uncertain.                                           |
| CU06 | Catch-up subject/body state late setup accurately; due-soon, due-today and past-due copy uses database time in the practice zone at begin-submit. Date purpose, date and authenticated links are explicit; frozen payloads exclude record/practice/clinician names, identifiers and tokens. |
| CU07 | The reminder page distinguishes ordinary/catch-up, original sixty-day target, catch-up target and next permitted execution. Blocked/consumed outcomes never advertise a future send. Active viewers can read; revoked/foreign/anonymous readers cannot.                                     |
| CU08 | Populated E4-S2 upgrade preserves historical domain/Auth/SMS/email state, attempt payloads/IDs/outcomes, consumed guards and suppression. Migration rollback restores rows/catalog; fresh replay matches the new catalog. Old v1 schedule clients retain their exact response shape.        |
| CU09 | Sending disabled or incomplete configuration yields zero provider POSTs; callback/preference withdrawal behavior remains available. All inherited verification gates remain mandatory. Local fixture results and hosted/received-mail acceptance are reported separately.                   |

## Key Discoveries

- All scheduling authority is in `supabase/migrations/20261009000855_practice_reminder_jobs.sql`; changing just `catch-up-unavailable` is insufficient because claim/begin both rely on the nominal target.
- `private.reminder_message_attempts` already supplies the cross-revision/user guard. Adding schedule kind to either uniqueness key would permit another send and is prohibited.
- `private.reconcile_email_reminders_at` protects consumed/live-claimed rows, paginates one hundred records and acknowledges only its observed generation. Catch-up must preserve these rules.
- Payload SQL and `src/lib/reminders/messages.ts` must change together. Historical frozen payloads must remain valid under the existing literal subject.
- `src/lib/reminders/schema.ts` rejects extra response fields. Use a separately named v2 read RPC rather than widening v1 in place.
- The existing email upgrade begins before E4-S2 and cannot witness preservation of populated E4-S2 attempts; add a separate rehearsal.
- `tools/sql-mutants.mjs` contains a literal nominal-target window fault; adapt it to the new authoritative field while retaining ER17 and adding catch-up witnesses.

## What We Are Not Doing

Optional SMS dispatch/activation or consent changes; automatic retries, uncertain-send resubmission, provider unsuppression, manual sends or expanded delivery history (E4-S4); renewal workflow/successor creation (E5); extra intervals/backup recipients; imports/calendar feeds; external operator alerts/restore acceptance; provider/DNS/account purchases or configuration; hosted migrations/deployments or real recipient messages during planning.

## Implementation Approach

### Additive database evolution

Use the Supabase CLI's inspected migration command to create a new `email_reminder_catch_up` migration; do not edit historical migrations or invent a timestamp filename. Refresh relevant Supabase changelog/function docs before implementation.

Add `schedule_kind` constrained to `normal`/`catch-up` and nullable `dispatch_target` to private jobs. Historical rows default to normal and copy their stored nominal target into dispatch target; retain original job IDs, states, claims, nominal/next times and invalidation history. A constraint requires a usable target for queued/claimed jobs without forcing blocked missing-date rows to invent one.

Add immutable scheduling snapshots to attempts: `schedule_kind`, `nominal_target` and `dispatch_target`. Backfill existing attempts from their linked jobs as normal, without rewriting payloads or outcomes. Begin-submit copies these fields for new attempts. Do not change either logical-job or consumed-attempt uniqueness, endpoint epochs, Auth trigger or direct storage grants.

Introduce a private deterministic helper for the next valid local sending instant and use it consistently for catch-up construction and normal/catch-up window enforcement. Keep production wrappers authoritative over time; no ordinary/service caller gains arbitrary-clock permission. Extend `email_reminder_context` with proposed kind/dispatch target while preserving the existing higher-priority blocking reasons and already-attempted check.

Update reconciliation to persist context scheduling fields and emit a sanitized `catch-up-scheduled` job event only when a job first enters catch-up for a changed eligibility snapshot. Repeated scans must not add duplicate events. Preserve practice → Auth → account → endpoint → job/attempt locking and cursor/generation acknowledgement. One migration transaction upserts every existing practice into the reconcile outbox, incrementing existing generations and resetting cursors; it never consumes permission, rewrites domain timestamps or materializes a backlog of jobs.

Update claim and begin-submit to use dispatch target for window enforcement and to compare kind/target plus all existing identity/version snapshots. The consumed guard stays decisive. An expired ordinary pre-submit claim can be reclaimed; migration must not turn an existing live claim into a duplicate or cancel a submitting attempt. Test the populated migration under the documented sending-off rollout and retain a live-claim compatibility witness.

### Payload and versioned read API

Keep the normal subject `Credential renewal reminder: 60 days`; add only `Credential renewal catch-up reminder`. The SQL catch-up introduction says record details or reminder setup became eligible after the ordinary target; do not guess which edit caused it. Both kinds include explicit due-date purpose/date and a truthful urgency sentence computed at permission consumption: due on the entered date, due today, or past due. Normal delayed work retains its sixty-day scheduling explanation. Freeze the computed text/HTML with the attempt; later callbacks/reconciliation never regenerate it.

The message validator permits exactly those two fixed subjects; existing destination/tag/key/body constraints remain. The provider and worker use the same transport, permission and no-retry protocol.

Add private/public `get_email_reminder_schedule_v2(uuid,text,uuid)` using the existing public invoker/private definer, empty search path, live membership check and named authenticated grant. Preserve v1 shape and grants unchanged. V2 adds row `scheduleKind` (`normal`, `catch-up` or null before classification) and `dispatchTarget` (nullable); `target` remains the nominal sixty-day target. For a consumed attempt, use its frozen scheduling snapshot rather than newly recomputed times. Current record dates are explicitly current dates, and consumed copy states that changes do not send another email automatically. Do not expose payload/destination/provider IDs.

Update the application repository and strict schema to v2. Keep pagination/health/preferences and the existing route, with an explicit refresh link to reread current state. Only queued/claimed rows advertise a next sending time. Pending rows say scheduling review pending; archived/completed/disabled/suppressed/consumed rows never imply an automatic retry. Avoid interpreting acceptance as delivery or completion.

## Phase 1: Scheduling invariants and populated upgrade

### Files and changes

- New CLI-named migration under `supabase/migrations/`: additive scheduling fields, private helper, context/reconcile/claim/begin changes, scheduling events and one-time outbox enqueue.
- Extend `supabase/tests/practice_reminder_jobs.test.sql`; add `tests/integration/practice-reminder-catch-up.test.ts` with private deterministic time helpers local to its fixture.
- Update ER03 in `tests/integration/practice-reminder-jobs.test.ts` to retain missing-date blocks and expect valid late work queued for catch-up. Keep ER17 ordinary-outage assertions.
- Add `tools/reminder-catch-up-upgrade.mjs`, following the guarded twenty-one-table preservation/replay pattern in `tools/reminder-jobs-upgrade.mjs`, with baseline migration `20261009000855` and all twelve email tables additionally inventoried.
- Refresh the catalog-derived schema contract using `tools/schema-fingerprint.mjs record`; retain catalog inclusion via `tools/schema-catalog.mjs`.

### Automated verification

CU01–CU05/CU08: prove boundary arithmetic, stable onset/target, shared-policy uniqueness, no duplicate scheduling events, multi-page recovery and permanent consumed uniqueness. Populate blocked catch-up, normal queued/live claimed, submitting/accepted/failed/uncertain/canceled/suppressed jobs; email preferences/receipts/events, endpoints, attempts/delivery events, outbox cursor/generation and worker/account scan state before upgrading. Snapshot original-column values, separately assert new defaults/snapshots and the intentional outbox change. No new jobs/attempts/payload rewrites or SMS/Auth changes during migration. Inject failure and prove exact transaction/catalog rollback; compare upgraded catalog with fresh replay.

Run sequentially on the guarded fixture database: `npm run db:reset`, `npm run test:db`, `npm run test:integration -- tests/integration/practice-reminder-catch-up.test.ts tests/integration/practice-reminder-jobs.test.ts`, then `node tools/reminder-catch-up-upgrade.mjs` and the inherited email upgrade rehearsal. No hosted reset is permitted.

### Manual verification

Inspect the calculated normal/catch-up targets and populated preservation report. Review the lock order and migration's explicit scheduling-only data changes. This is local inspection, not received-email acceptance.

Exit: deterministic catch-up permission and recovery work, and historical submission/suppression evidence is preserved.

## Phase 2: Honest frozen payloads and submission races

### Files and changes

- Extend the new migration's `private.begin_email_reminder_at` payload construction and scheduling snapshots.
- Update `src/lib/reminders/messages.ts` fixed-subject validation and `src/lib/reminders/properties.test.ts` exact allowed-subject/privacy witnesses.
- Extend the catch-up integration suite and existing reminders unit tests for observed permission, frozen subjects/body and response-loss cases. Preserve `src/lib/reminders/worker.ts` and `src/lib/reminders/email-provider.ts` behavior; no extra provider operation is needed.
- Reuse `tests/helpers/email-fixtures.ts` for actual loopback submission counts and signed-event fixtures.

### Automated verification

CU03–CU06/CU09: count zero/one actual provider POST, not just job rows. Cover normal → catch-up and catch-up → normal corrections before/after permission; A → B each first attempt, then A again blocked; every consumed outcome remains guarded after address changes/rejoin/new revisions. Witness both committed orders of archive/date/timezone/selection/preference/Auth change and suppression versus begin-submit. Ensure stale leases cannot freeze/send prior recipient or date.

Test missed scans before any job exists, missed worker after queueing, crash after claim and before begin, lost begin reply, lost provider/result response and callback-before-result. Recover only unconsumed work; keep consumed uncertainty and existing terminal outcomes. Freeze accurate due-soon/today/past-due wording with differing browser/practice zones and a local-midnight boundary. HTML/text contain the same date purpose, links and urgency, without names/identifiers/tokens. Normal historical payloads and signed callback binding still parse.

Run `npm test -- src/lib/reminders tests/unit/reminder-api-routes.test.ts`, the targeted integration suites and `npm run typecheck`. Once v2 fixtures land, repeat only tests affected by that change.

### Manual verification

Inspect local normal and catch-up plain-text/HTML messages for truthful timing and privacy. Confirm a current date correction does not appear to change a frozen historical email.

Exit: the new kind uses the existing one-permission/one-POST boundary, with truthful message snapshots.

## Phase 3: Compatible status projection and catch-up interface

### Files and changes

- Add v2 schedule RPC/grants in the new migration; retain v1 exact shape and callable contract.
- Update `src/lib/reminders/schema.ts`, `src/lib/reminders/repository.ts` and `src/app/practice/reminders/page.tsx` for kind/dispatch target, current-date labels, explicit refresh and readable scheduling/consumed states.
- Regenerate `src/lib/supabase/database.types.ts` from the local public schema and verify using `tools/check-generated-types.mjs`.
- Extend `tests/unit/reminder-routes.test.tsx`, reminder properties and `tests/e2e/practice-reminders.spec.ts`. New late-entry fixtures use actual late eligibility rather than backdating onset into an ordinary job.

### Automated verification

CU07–CU09: validate exact old/new API shapes, one-hundred-row/cursor behavior, foreign/revoked/anonymous denial, private-field rejection and viewer reads. Verify real browser flows for late record creation, reassignment, preference disable/reenable, unknown dates and a consumed failed/uncertain attempt; repeated worker/refresh preserves one submission. No-phone/no-Twilio setup works. Refresh reflects current eligibility and record dates; sending-off and stale-worker copy stays truthful.

Check keyboard links/focus, Axe and widths 375/1440. Queued/claimed show actual catch-up/next-window targets; blocked/consumed rows do not promise another send. Show original sixty-day target with its own label; never call a catch-up subject a sixty-day notice. Current dates and prior consumed scheduling are clearly distinguished.

Run scoped reminders unit/properties, targeted integration, `node tools/check-generated-types.mjs`, `npm run build`, then `npm run test:e2e -- tests/e2e/practice-reminders.spec.ts`. Database/API/browser fixture campaigns run sequentially.

### Manual verification

Inspect sanitized desktop/mobile screenshots, refresh navigation and late/unknown/consumed status copy. Record agent inspection separately from user-confirmed acceptance.

Exit: the app explains current catch-up scheduling without breaking released read clients or exposing private message data.

## Phase 4: Regression controls and rollout evidence

### Files and changes

- Extend `tools/sql-mutants.mjs` with catch-up classification, stable-target, local-window, consumed-kind bypass, stale-snapshot and cursor-acknowledgement faults. Adapt `email-send-window` to dispatch target, preserving ER17 and adding catch-up coverage; do not weaken expected failure classification/restoration.
- Add `reminder-catch-up-upgrade` to `tools/layers.json` and `tools/gauntlet.mjs` required inventories, yielding thirty-five layers if this is the sole addition. Extend `tools/gauntlet-controls.test.mjs` to reject omission of the new required layer and protections.
- Update current README only after implementation, replacing the unavailable catch-up description and identifying E4-S4 as the next P0 story. Preserve historical release documents.
- Add source-bound implementation evidence and a catch-up release/activation addendum under research/handoffs. Include backlog review and matched app/migration rollout, retaining the existing independent email setup requirements.
- Add `supabase/operators/email-reminders-catch-up-preview.sql`: a read-only, timeout-bounded aggregate over current context using the operator-supplied stable provider namespace and database time. Report eligible normal/catch-up counts, blocked reasons and oldest targets without returning addresses, payloads or identifiers. It neither reconciles nor consumes permission; it works while sending is disabled.

### Automated verification

Use recorded Node 24.21.0; the current shell-default runtime is different. Required everyday checks: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:controls`. Run `npm run db:reset`, `npm run test:db`, full `npm run test:integration`, both new/inherited email upgrade rehearsals and generated-type/schema checks. Run the full production-local browser suite and retained mutation/SQL-control campaigns through `npm run gauntlet` on a clean committed implementation checkpoint when checkpointing is authorized. Preserve inherited coverage/mutation thresholds and source hashes; record actual current-source counts rather than copying E4-S2 results.

Extend the new rehearsal to show v1 client parsing after migration and v2 parsing after app rollout. Verify sending-disabled worker runs generate zero external/fixture submissions as appropriate; configured signed callbacks and personal withdrawal remain operable. The full gauntlet includes inherited SMS/access/register regressions and secret/capability/supply-chain checks.

Thoughts are ignored by ordinary Prettier: explicitly run `node_modules/.bin/prettier --check --ignore-path /dev/null` on new research/plan/verification documents. Review the complete diff and classify automated, inspected, user-confirmed and live checks separately.

### Manual verification

Review catch-up backlog size, oldest due time and intended current recipients before enabling sending in an authorized release. Reuse the fixed authenticated worker and existing sender/callback setup; demonstrate received mail to an authorized test destination before claiming live acceptance. No scheduler/provider activation is implied by local fixtures or by this planning request.

Exit: all current-source checks pass and the release/addendum makes the pending live boundaries explicit.

## Risks and rollback considerations

- **Backlog volume:** enabling catch-up can expose many old records, including valid past-due items. Use the existing bounded worker/cursor; inspect backlog and available provider capacity before activation, and report lag rather than silently dropping old records.
- **Schema/application mismatch:** catch-up payloads need matching subject validators. Disable email sending before migration, deploy the new app, verify v1/v2 and frozen legacy payloads, then restore sending only through the activation workflow. A database-first deployment with sending left on is outside this rollout.
- **Authority and uncertainty:** do not relax the consumed guard, suppressions or lock order. An accepted message may arrive after a subsequent edit; show history honestly and preserve all attempt snapshots.
- **Timezone anomalies:** validate local round-trip/window at both target construction and consumption; use a bounded search for skipped days, retain explicit invalid-target status when no supported target exists.
- **Rollback:** turn off email sending and stop the worker schedule before reverting the app. Keep additive fields, frozen attempts, guards, email callback suppression and SMS STOP/withdrawal. An old app can use unchanged v1 reads but must not dispatch catch-up payloads; either leave sending off or apply a rehearsed compatibility patch that blocks unconsumed catch-up and restores normal payload construction. Do not delete jobs/attempts or downgrade the consumed index. Transaction-failure rollback is tested separately from this operational application rollback.
- **Remaining launch work:** live provider/scheduler acceptance, E4-S4 delivery recovery, E5 completion and broader operations remain separate. This plan cannot establish inbox delivery or legal validity of an entered credential date.

## Completion criteria

Phases 1–4 and CU01–CU09 pass on identified current source. Late setup creates one eligible catch-up job, the next permitted local window is respected, ordinary outage recovery retains its meaning, every consumed cycle/user guard remains, current authority is rechecked, and old clients/historical state are preserved. Plans/research/verification are formatted and reviewed. Record local evidence separately from hosted deployment, provider activation, received-mail and user acceptance.

No material product decision remains open for this email scope. Refetch current Supabase documentation and locate the recorded Node version before implementation; live provider credentials are unnecessary for local development.

## Implementation progress

- [x] Phase 1: scheduling invariants and populated upgrade.
- [x] Phase 2: honest frozen payloads and submission races.
- [x] Phase 3: compatible status projection and catch-up interface.
- [x] Phase 4: regression controls and rollout evidence (35/35 local layers; matching schema/application deployed, 60 hosted checks passed).
- [ ] Separately recorded live activation/received-mail acceptance.
- [ ] User-confirmed manual acceptance.
