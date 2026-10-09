# Verification Summary

Date: 2026-10-08 (America/Los_Angeles).
Baseline: `d037bff8c9ae4279d04fae92af52d694cadd1057`.
Plan: `thoughts/shared/plans/2026-10-08-e4-s2-sixty-day-reminders.md`.
Research: `thoughts/shared/research/2026-10-08-e4-s2-sixty-day-reminders.md`.
Scope: revised E4-S2 email baseline, optional later SMS; planning only.
Overall readiness: **Ready** for phased local implementation. Live activation remains separately pending.

The earlier SMS-first review does not approve this revised design by itself. Primary and independent review inspected the email authority/transport, Auth changes, privacy, existing recipient/SMS compatibility and tooling. The independent reviewer reread the complete revised plan and targeted corrections and approved it with no material planning blockers. This review establishes feasibility, not successful execution of an unimplemented worker.

## Findings

Resolved requirements incorporated into the revised plan:

| Severity | Location                     | Issue and resolution                                                                                                                                                                                                                                                                                                      |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Major    | Story/acceptance/phases      | Email must work without Twilio, a phone or text consent. Mandatory phases implement email; SMS dispatch/new consent is optional later work with independent activation. Existing Verify/STOP is preserved.                                                                                                                |
| Major    | Recipient authority          | Membership stores a user ID, not email. Dispatch derives selected member → current `auth.users.email` and requires confirmation under an Auth row lock. JWT/roster/invitation/metadata cannot authorize a destination.                                                                                                    |
| Major    | Transport/configuration      | Existing Resend SMTP only proves historical Auth transport/test-sender use. New Resend application REST/API key, verified sender, reply/support address and signed webhook require independent configuration. Auth OTP APIs remain unchanged.                                                                             |
| Major    | Auth invalidation/lock order | No current app email-change tracking exists. Narrow Auth trigger writes account state only, without practice/domain/job locks or restrictive bookkeeping FKs. Worker discovery stays unlocked until practice → Auth row → account state/endpoint → jobs. Trigger is included explicitly in schema catalog/rollback tests. |
| Major    | Eligibility/preference       | Record/date/timezone/assignment/email/feature/re-enable onset distinguishes late setup from delayed normal work. Metadata/session/pending email writes are no-ops. Personal disable persists across address changes/rejoins; endpoint suppression is distinct.                                                            |
| Major    | Submission recovery          | Durable consumed guard uses stable cycle/user/channel across membership replacement. Provider's 24-hour key does not authorize later replay. Lost begin-submit response never permits POST, and expired submitting sweep runs without other work.                                                                         |
| Major    | Upgrade preservation         | New completion marker requires pre-change cycle-column snapshots in both inherited upgrade rehearsals. The new rehearsal preserves all 21 historical tables and SMS records, plus rollback/fresh replay and named Auth trigger catalog.                                                                                   |
| Major    | Shared provider suppression  | Resend suppressions cover the entire team, including Auth SMTP if shared. The plan now guarantees application-state isolation only, records shared-team risk and verifies separate teams/transports if delivery isolation is required; no automatic provider suppression removal.                                         |
| Minor    | Channel/status semantics     | New channel projection preserves old literal-false recipient/SMS schemas. Email acceptance, mail-server delivery, bounce/complaint/suppression and renewal completion differ. Channel-specific preference/failure never triggers text fallback.                                                                           |

## Missing Work

All implementation phases remain unchecked. No application/migration/test changes were made. Sender/API/webhook/scheduler/runtime verification and actual email receipt are separately authorized activation work. SMS configuration/current consent/adapter/status work is an optional follow-on and cannot block email story completion. E4-S3/E4-S4/E5/E8 remain explicit boundaries.

## Risks

- A broken Auth trigger can disrupt sign-in/account writes. Keep it narrow, test actual Auth changes/rollback and inventory only the application-owned trigger.
- Begin-submit cannot retract a provider request after a subsequent edit/withdrawal. Uncertain and failed requests remain guarded and visible until explicit future recovery.
- Hard bounce/complaint suppression must serialize with begin-submit without acquiring practice/Auth locks from an endpoint callback.
- Local fixtures do not prove sender-domain verification, hosting capacity, scheduler confidentiality or inbox placement. Existing test sender cannot support general staff delivery without configuration.

## Suggested Changes

Preserve inherited control positions, mutation intent and restoration logic while extending coverage. Test raw signed webhook bytes, binding before result/after uncertainty, shared-address suppression, Auth-row races, persistent personal disable and email with every SMS variable absent. Verify actual scoped PostgREST timeout enforcement rather than treating transport abort as rollback. Review current README workflow after implementation while preserving historical SMS release evidence.

## Documentation Verification

- `PATH="$PWD/.tools/node/bin:$PATH" npm run format:check`: passed using bundled Node 24.21.0; thoughts are excluded by default.
- Explicit formatting/checking of all three revised thoughts with `--ignore-path /dev/null`: passed.
- `git diff --check`: passed. `git diff --no-index --check /dev/null <document>` for each of the three new documents produced no whitespace diagnostics (exit 1 reflects different file content).
- Only these three planning documents are changed; runtime source, migrations, tests and release records are untouched.

No runtime lint/type/SQL/API/browser/build/mutation/gauntlet run was performed for this documentation-only request. Required implementation commands and acceptance evidence are stated in the plan; prior E4-S1 outcomes remain historical.

## Final Recommendation

Approve phased local email implementation. No material planning blockers remain. Live email and optional SMS activation require their own configuration/acceptance evidence; this request creates no commit, deployment, scheduler or message.
