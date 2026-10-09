# E4-S3 catch-up reminder research

Date: 2026-10-09 (America/Los_Angeles).
Inspected baseline: `ac3cc079fde95fc05341752b8a00de8cd0f9cc11`.
Scope: planning only; no application, migration, database, provider or deployment changes.

## Story selection and channel

`thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md`, E4-S3, defines a P0 catch-up alert for newly entered or reassigned items already inside sixty days, accurate due-today/past-due wording, no guessed dates, and reconciliation after scheduler failure.

The original backlog used SMS. The revised E4-S2 plan, `thoughts/shared/plans/2026-10-08-e4-s2-sixty-day-reminders.md`, explicitly establishes email as the primary channel, leaves optional SMS independent, and assigns late eligibility to E4-S3. Current README agrees. `thoughts/shared/handoffs/2026-10-09-e4-s2-production-release.md` records released email groundwork with sending disabled and activation pending. Its pending live acceptance does not require repeating E4-S2 implementation before planning catch-up.

## Application ownership

This repository contains one Next.js/React/TypeScript application, not multiple monorepo applications. `src/app/` owns routes/actions; `src/components/` owns forms; `src/lib/` owns validation, persistence and provider/worker logic. Supabase migrations own relational invariants, tenant authorization, eligibility, reconciliation and submission permission. `tests/` covers unit/API/browser behavior; `supabase/tests/` covers database grants/invariants; `tools/` owns guarded upgrade, mutation, schema and source-bound verification. `thoughts/shared/` retains research, plans and release evidence.

## Verified scheduling boundaries

All SQL symbols below are in `supabase/migrations/20261009000855_practice_reminder_jobs.sql`.

- `private.reminder_target`: explicit effective date minus sixty calendar days at local 09:00; null/range/skipped-local-target failures remain visible.
- `private.reminder_next_window`: permitted interval is 09:00 inclusive through 17:00 exclusive. During the interval, delayed work can run immediately; otherwise it waits until local 09:00.
- `private.email_reminder_context`: selects the latest cycle; computes onset as the greatest cycle update, selection update, account eligibility, preference eligibility and timezone audit change. It checks archive/completion, membership, confirmed current Auth email, preference, endpoint suppression, missing/invalid dates and consumed attempts before rejecting `onset > target` as `catch-up-unavailable`.
- `private.reconcile_email_reminders_at`: persists one logical cycle/revision/membership/lead/channel job. It processes at most one unlocked practice per call, up to one hundred credentials, using a durable outbox cursor/generation; repeated reconciliation updates eligible unconsumed rows instead of inventing another logical key. It does not overwrite live claims or consumed jobs.
- `private.claim_email_reminder_at` and `private.begin_email_reminder_at`: both use `job.nominal_target` for window checks. Begin-submit rechecks current authority and versioned context before committing the attempt. Introducing a catch-up target requires changing both checks, not just removing the context block.
- `private.reminder_message_attempts`: unique `(cycle_id, user_id, channel)` is stricter than the original story's revision/member job key. It survives failures, uncertainty, date revisions and reassignment. A new recipient can receive their own first attempt; returning to a previously attempted recipient cannot grant a second.
- `private.dirty_email_reminders`: domain changes cancel unsent work and reset/increment practice reconciliation state in the same transaction. Auth changes use account dirty state; the Auth trigger avoids practice/domain locks.
- `private.get_email_reminder_schedule`: v1 projection is bounded to one hundred rows, checks live practice authority, and excludes destinations, payloads and provider/claim tokens. A new version can add scheduling semantics without breaking the strict old client.

## Worker, payload and view

`src/lib/reminders/worker.ts::handleReminderRun` authenticates a fixed worker request, expires submitting attempts, drains account changes, reconciles and dispatches with a 45-second budget. It consumes observed permission before one provider POST; lost begin replies cannot authorize a POST. Disabled sending does not dispatch. `src/app/api/reminders/run/route.ts` has a 60-second ceiling.

`private.begin_email_reminder_at` builds and persists the payload in SQL. `src/lib/reminders/messages.ts::emailPayloadSchema` accepts only the literal subject `Credential renewal reminder: 60 days`; catch-up needs an explicitly permitted second subject. `src/lib/reminders/email-provider.ts` sends the frozen payload with the opaque attempt key and no retry; transport changes are unnecessary.

`src/lib/reminders/schema.ts::scheduleSchema` strictly rejects unknown fields. `src/lib/reminders/repository.ts::getReminderSchedule` calls the v1 RPC. `src/app/practice/reminders/page.tsx::ReminderRow` displays the original target and only advertises another window for queued/claimed rows; its reasons table currently labels catch-up unavailable.

## Existing executable witnesses and tooling

- `tests/integration/practice-reminder-jobs.test.ts`: ER03 explicitly expects late eligibility blocked; ER04 exercises one permission; ER07 retains uncertainty; ER13/ER14 cover invalidation/transaction rollback; ER17 recovers delayed ordinary work; ER19 tests pagination; ER23 guards failed attempts across revision and A → B → A; ER26 witnesses endpoint suppression races.
- `supabase/tests/practice_reminder_jobs.test.sql`: nineteen SQL assertions cover private access, public facade grants, consumed uniqueness, target/window arithmetic and tenant references.
- `tests/e2e/practice-reminders.spec.ts`: uses the guarded email fixture to count submissions, process signed events, withdraw preferences and inspect responsive accessible status. Ordinary fixtures deliberately move onset before target; new catch-up fixtures must exercise real late onset.
- `tests/unit/reminder-routes.test.tsx`: RU02 currently expects unavailable catch-up copy; RU06 rejects future-window promises on consumed/blocked statuses.
- `src/lib/reminders/properties.test.ts`: strict frozen payload and bounded private-safe schedule witnesses.
- `tools/reminder-jobs-upgrade.mjs`: upgrades from the SMS migration with twenty-one populated historical tables, transaction rollback, legacy API assertions and replay catalog equality. It does not seed populated email attempts/jobs before the next migration; a separate E4-S2 → E4-S3 rehearsal is necessary.
- `tools/sql-mutants.mjs`: the `email-send-window` fault matches the literal use of `job.nominal_target`; update this fault when window checks use the dispatch target, preserving its ER17 behavioral witness.
- `tools/layers.json` and `tools/gauntlet.mjs`: thirty-four required layers today. A catch-up upgrade layer must appear in both inventories. Schema capture already includes private columns/functions and the named Auth trigger through `tools/schema-catalog.mjs`.

## External documentation and inspection limits

The [Supabase database function documentation](https://supabase.com/docs/guides/database/functions) was retrieved during planning. The proposed v2 RPC follows a distinct name and preserves the repository's private definer/public invoker pattern; no new hosted feature is assumed.

The changelog Markdown fetch failed through the web reader (unsupported content type); a shell fetch failed on DNS. Refresh relevant changelog/function documentation before implementing. This planning limitation does not establish an API or migration incompatibility.

Inspection used file inventory/content reads, focused symbol searches, `git status --short`, `git log -6 --oneline`, `git rev-parse HEAD` and runtime version checks. The initial working tree was clean. Shell-default Node was v26.3.0; the bundled runtime was v24.19.0, while `.nvmrc` requires 24.21.0. Use the recorded 24.21.0 runtime for implementation verification. No database reset/query, production verification or application test run is credited to this research.
