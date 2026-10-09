# E4-S2: Email-first 60-day reminders — planning research

Date: 2026-10-08 (America/Los_Angeles).
Baseline: `d037bff8c9ae4279d04fae92af52d694cadd1057`.
Scope: static research/planning only; no implementation, deployment or messages.

## Story revision and repository

The next unfinished story is E4-S2. The user revised it to email reminders, with text optional after configuration. The companion plan makes ordinary email scheduling/submission the mandatory baseline; SMS configuration/enrollment/dispatch is an independent optional enhancement. This supersedes the original text-only backlog and the earlier SMS-first draft. E4-S3 catch-up and E4-S4 recovery remain follow-on work. No historical release claim is rewritten.

This repository has one Next.js/React/TypeScript app, not multiple monorepo applications. Routes/UI/domains/database/check tools belong respectively to `src/app`, `src/components`, `src/lib`, `supabase`, `tests`/`tools`.

Historical context comes from the original `2026-10-03-license-renewal-radar-system-design.md`, E4-S1 plan/research/release and `thoughts/shared/handoffs/2026-10-08-e4-s1-live-activation.md`. E4-S1 app/schema deployment does not imply configured live texts. README contains earlier stale status paragraphs; latest release evidence governs deployed features.

## Email authority and existing transport

- `src/lib/auth/operations.ts:requestCode/verifyCode` calls Supabase Auth sign-in OTP APIs only. It contains no reminder sender or account-address change UI.
- `supabase/config.toml` enables confirmed email accounts and local Mailpit at port 55324. `supabase/templates/email-otp.html` is an authentication template. `tests/helpers/local-mail.ts` reads captured sign-in messages/codes; it does not establish reminder-provider behavior.
- README's hosted setup records Resend SMTP for Auth and an account-only test sender. Existing transport is relevant to choosing Resend, but does not establish a verified sending domain, application API credentials or current live reminder readiness. Supabase Auth sends authentication/security messages, not arbitrary application renewal notifications.
- Membership holds `user_id` rather than a stored email. Recipient/team SQL reads selected email from `auth.users`. Existing practice creation/invitation acceptance requires `email_confirmed_at`; existing recipient eligibility itself focuses on active editor role. Email dispatch must explicitly recheck live current address and confirmation.
- Auth identity is not JWT/cached roster/invitation/user metadata authority. An Auth address can change outside this app. No existing application-owned Auth change trigger or version/onset ledger was found.
- `src/lib/recipients/schema.ts` fixes readiness to false and `sms-setup-pending`; repository parsers enforce it. `src/components/recipients/recipient-panel.tsx` uses that state plus SMS readiness. A new email/channel projection avoids breaking old RPC/schema contracts or letting SMS readiness gate email.
- Selected email is already shown to active practice staff. Candidate roster remains editable-role-only. New reads should expose status without privately retained historical addresses, attempt bodies/provider IDs or raw callbacks.

## Scheduling and supported lifecycle boundaries

- `20261006225257_credential_dates.sql` defines cycles/date revision/date-only fields and initial-cycle trigger. There is no completion marker or successor writer; add a nullable exclusion marker and latest-cycle selector without claiming E5 is implemented.
- `20261007004303_register_maintenance.sql:private.apply_credential_change` updates revision only for date changes; archive retains history. Changes/audit/receipt are transactional under practice authority.
- `src/lib/register/dates.ts:trackingDate` selects action deadline before end date; `src/lib/calendar/dates.ts:practiceToday` uses practice timezone. SQL scheduling must mirror these rules.
- `20261005211436_practice_membership_authority.sql:private.update_practice` provides timezone/profile transaction authority.
- `20261006003555_practice_reminder_recipient.sql:private.change_reminder_recipient` records selection and clears it after selected-member invalidation. Default email responsibility can use this existing selected member; no phone prerequisite is appropriate.
- All ordinary domain work uses practice-first locks. Auth changes already hold an Auth row. The proposed Auth trigger must write only private account state, with no practice/domain/job locks or indirect FKs. Worker order is practice → Auth row → account state → endpoint → jobs. Dirty discovery is unlocked until that order is established.
- Initial email eligibility begins at feature introduction, not an invented historical notification epoch. Subsequent real address/confirmation/re-enable changes establish new onset; sign-in/session/metadata and pending-new-email writes do not. Personal disable persists across address changes and revoke/rejoin.

## SMS remains optional

`20261008184507_practice_sms_enrollment.sql` retains seven private ledgers for proof, consent, suppression and provider events. `src/lib/sms/config.ts` gates Verify/configuration and preserves callbacks when sending is disabled. `private.apply_sms_provider_opt_out` locks the global phone endpoint and records actual STOP/START/HELP evidence; START never restores app consent.

Existing disclosure is `e4-s1-v1` with inactive text-delivery copy; legacy schemas require `deliveryActive: false`. Email implementation does not change those contracts or mint fresh SMS consent. Optional future text delivery must add current explicit consent, full registered provider/callback configuration, its own flag/job channel/guards and SMS-only invalidation. Phone withdrawal/STOP must not block email; email disable/bounce must not change SMS consent or Auth settings. A shared Resend team may still suppress Auth delivery after a hard bounce/complaint; application-state isolation cannot guarantee provider delivery isolation. Provider rejection without a real Message SID cannot be recorded as fabricated inbound STOP evidence.

## Privilege and verification boundaries

- `src/lib/sms/privileged-repository.ts` is the only secret-key client and exposes named operations. `tools/sms-capabilities.mjs:assertSmsCapabilities` and `tools/check-capabilities.mjs` enforce it. Email adds named service methods and reviewed network/signature capabilities, not a second generic client.
- `tools/local-environment.mjs:prepare` keeps server secrets in ignored mode-0600 `.env.local`, not `.env.test.json`. `tools/serve-covered.mjs` owns fixture lifetime. Add a separate guarded local Resend fixture alongside retained SMS/OTP fixtures; no external provider calls in automatic verification.
- `tests/integration/practice-recipients.test.ts` and `practice-sms-enrollment.test.ts` supply tenant, receipt, rollback and observed two-order SQL race patterns. New tests must witness actual Auth/preference/endpoint changes versus begin-submit, not just mocked promises.
- `tools/sms-enrollment-upgrade.mjs` starts before enrollment and applies all later migrations; `tools/register-maintenance-upgrade.mjs` does likewise. Their cycle `SELECT *` comparisons need pre-change column snapshots plus null completion-marker assertions. New rehearsal starts at `20261008184507` and preserves all 21 populated historical application tables/SMS evidence.
- `tools/schema-catalog.mjs` captures nine application catalog sections but excludes Auth triggers. Extend only its named application-owned Auth-trigger inventory, retaining provider-managed schema independence and upgrade rollback equality.
- SQL/control/mutation/layer inventories are explicit; preserve positions, mutation intent/restoration and 100% thresholds. Existing 33 layers become 34 if the new upgrade layer is the sole addition. Adding Svix also requires exact dependency/toolchain/supply-chain evidence.
- Repository Node is bundled 24.21.0; ambient Node 26 is outside the contract. `.prettierignore` excludes thoughts, requiring an explicit ignore override for these documents.

## Official documentation and design choices

Architecture choices are proposals, not observations of deployed configuration.

1. Resend supports a dedicated send API and retrieving sent email metadata/tags. Use bounded REST requests and opaque attempt tags; do not send reminder emails through Auth OTP APIs. [Send email](https://resend.com/docs/api-reference/emails/send-email), [retrieve email](https://resend.com/docs/api-reference/emails/retrieve-email), [Supabase Auth SMTP scope](https://supabase.com/docs/guides/auth/auth-smtp).
2. Resend idempotency keys expire after 24 hours. Persist a stable attempt key and retain database guards indefinitely for this story; no automatic retry after ambiguity. [Idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
3. Resend webhook signatures require original raw content and signature headers; its docs recommend official SDK/Svix verification. The plan chooses pinned Svix with bounded raw payloads. [Signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests).
4. Delivered denotes receiving mail-server delivery, not reading or completing renewal. Bounce/complaint/suppression must remain visible, with local endpoint suppression. [Event types](https://resend.com/docs/webhooks/event-types).
5. General delivery requires a verified owned sender domain; existing test SMTP sender is not evidence of that. Configure transactional sender/reply-to and disable tracking during separately authorized activation. [Verified domains](https://resend.com/docs/dashboard/domains/introduction).
6. PostgreSQL calendar arithmetic/timezone conversion and Supabase scoped REST function timeouts support the proposed worker; verify actual timeout enforcement locally. [Date/time operations](https://www.postgresql.org/docs/17/functions-datetime.html), [timeouts](https://supabase.com/docs/guides/database/postgres/timeouts).
7. Supabase Cron with Vault and pg_net supports fixed periodic HTTP work; HTTP begins after commit and needs an explicit timeout. Hosting/runtime capabilities remain activation checks. [Scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [Vercel cron constraints](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

8. Resend suppressions cover the entire team, including other domains. Record whether Auth SMTP shares the reminder team; separate API keys/subdomains do not establish delivery isolation. [Suppression scope](https://resend.com/changelog/suppression-list-support).

## Evidence limits

Static source/docs research and independent review establish plan feasibility. Prior E4-S1 automated results remain historical. No runtime implementation, SQL reset, live account/configuration inspection or provider call was performed for this revision. Documentation checks and remaining activation gates are recorded in the companion verification document.
