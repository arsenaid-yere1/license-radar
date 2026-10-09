# E4-S3 catch-up activation addendum

Status: all 35 source-bound release checks and matching archive/upload validation passed. Hosted deployment is authorized by the user's explicit “push to prod” but awaits required private-backup approval after automatic approval review rejected the export. Production remains unchanged. Provider/scheduler setup and real-recipient acceptance sends remain separate from this application/schema release.

Use with `thoughts/shared/handoffs/2026-10-08-e4-s2-email-activation.md`. E4-S3 uses the same authenticated worker, sender, callback, default-off sending gate and permanent cycle/user/channel consumed permission. There is no automatic retry or second sending gate. SMS proof/consent/STOP history remains independent.

## Matched rollout

1. Obtain an authorized release after the complete current-source gauntlet passes. Preserve current data and review the exact migration and matching app version.
2. Keep `EMAIL_REMINDERS_ENABLED` off and stop/pause the existing worker schedule before applying `supabase/migrations/20261009175711_email_reminder_catch_up.sql`. This migration adds private scheduling fields/snapshots and dirty-enqueues existing practices. It creates no jobs/attempts, rewrites no frozen payload, invents no consent and makes no provider request.
3. Deploy the app with the two fixed-subject validator and separately named V2 schedule projection. Verify unchanged V1 read shape, V2 authority, historical payload parsing, personal withdrawal and signed callbacks while sends stay off.
4. Replace the provider-namespace placeholder in `supabase/operators/email-reminders-catch-up-preview.sql` with the existing stable configured namespace. Run as an authorized operator. The timeout-bounded read-only transaction returns only eligibility/kind/reason counts and oldest original/dispatch/next-window times. Unassigned records are blocked. It does not rely on queued jobs: disabled worker runs do not reconcile.
5. Inspect total backlog, oldest targets and provider capacity. Valid past-due records have no age cutoff. Use an authorized account view for intended-recipient review; do not export addresses/payloads into reports. The existing 100-record cursor and four sequential submits per worker run bound processing; monitor lag and worker health.
6. Complete the existing verified sender, signed callback and fixed authenticated schedule setup. Enable sending only under explicit release/activation authorization and verify received mail at an authorized test destination before claiming hosted/inbox acceptance.

## Timing and history

Eligibility onset comes from persisted date revision, recipient selection, current confirmed Auth email, personal preference and timezone audit evidence. The ordinary target remains effective due date minus sixty calendar days at local 09:00. Onset after that target receives a catch-up dispatch target at the first valid local instant at/after onset, within 09:00 inclusive/17:00 exclusive. Scan time can move the execution hint but never the original dispatch target.

A consumed attempt remains consumed through revisions, address changes, failure, uncertainty and returning to an earlier recipient. A newly assigned recipient may receive their first attempt. Plain/HTML urgency and scheduling kind/targets are frozen at permission consumption. Current record dates are separately labeled; old scheduling is displayed using its original job timezone.

## Rollback

Turn sending off and stop the worker before reverting the app. Retain additive fields, all attempts, consumed uniqueness, preferences, suppressions, signed callback handling and SMS STOP/withdrawal. An old application can read unchanged V1 but cannot validate catch-up payloads; keep sending off until a matching app or a separately reviewed compatibility patch is deployed. Never clear or rebuild the consumed ledger to roll back. Transaction-failure rollback and fresh catalog replay are covered locally by `tools/reminder-catch-up-upgrade.mjs`; those do not constitute a hosted operational restore.

## Acceptance boundaries

Local fixture submissions, callback simulations, browser/Axe checks and agent screenshot inspection are separately recorded in the implementation evidence. Human manual acceptance, hosted deployment, scheduler registration and real received-mail acceptance remain pending. Delivery recovery remains E4-S4; renewal completion remains E5 work.
