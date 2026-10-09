# E4-S2 email activation handoff

The additive email schema and application are deployed in the hosted pilot. The production migration preserved all 21 historical tables and Auth identity; the existing signed-in session loaded the new reminders/preferences page. Email sending remains disabled pending provider/callback/scheduler setup. Local fixture mode sends only to an in-process loopback recorder. No live reminder email, DNS change or scheduler registration has been performed. Optional SMS delivery remains inactive; phone verification/withdrawal/STOP retain their existing behavior. Release evidence: `thoughts/shared/handoffs/2026-10-09-e4-s2-production-release.md`.

## Reviewable implementation

The additive `supabase/migrations/20261009000855_practice_reminder_jobs.sql` owns scheduling, invalidation, preferences, submission guards and delivery events. `src/lib/reminders/config.ts` validates independent email configuration. The server-only REST adapter uses a fixed Resend origin and one POST per consumed permission. `/practice/reminders` shows sanitized schedule, personal preference and worker health; `/api/reminders/run` requires its independent bearer secret. `/api/reminders/email/webhook` verifies raw Svix signatures and remains usable with sending off.

The commit/evidence report identifies the tested source separately. Local fixtures are not sender verification or proof of inbox placement. Successful provider acceptance, receiving mail-server delivery and renewal completion are separate outcomes.

## Activation prerequisites (separately authorized operator work)

1. Back up and review the hosted schema/data and apply the additive migration with the same preservation/rollback expectations as the local upgrade rehearsal. Keep `EMAIL_REMINDERS_ENABLED=false` throughout setup. Verify the exact app-owned Auth trigger and Auth sign-in behavior; a broken trigger can roll back Auth writes.
2. Verify a sending domain, SPF/DKIM/DMARC and a functioning reply/support address. The historical Auth SMTP test sender does not establish reminder delivery readiness. Use bare addresses in `EMAIL_FROM`/`EMAIL_REPLY_TO`; verify the scoped application API key, quotas and provider analytics settings (open/click tracking disabled).
3. Set `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, stable `EMAIL_PROVIDER_NAMESPACE`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, HTTPS origin `REMINDER_APP_URL` and a separate randomly generated 32–256 character `REMINDER_WORKER_SECRET`. Never use public-prefixed secrets, fixture flags or loopback URLs in hosting. Changing namespaces does not remove existing cycle/user guards; retain endpoint suppression history when moving providers.
4. Subscribe the canonical HTTPS callback to sent, delivered, bounced, complained, suppressed, delayed and failed events. Verify signature/timestamp checks with an authorized test destination and confirm event persistence. Unknown types are ignored. A permanent bounce/complaint/suppression blocks future application email to the endpoint; transient/unknown bounce classification does not invent global suppression.
5. Record whether Auth SMTP shares the Resend team. Provider suppression covers the whole team and can affect sign-in delivery even with different keys/domains. Use separately verified teams/providers if delivery isolation is required. Never automatically remove provider suppression to restore Auth mail.
6. Review Supabase Cron, pg_net and Vault availability/privileges. Restrict access to decrypted Vault secrets and pg_net request/response tables, retention, database/hosting logs and cron history. Bearer authorization may be visible to database administrators in queued requests; Vault references alone do not prove confidentiality. Create the worker URL/token Vault entries securely. Review `supabase/operators/email-reminders-enable.sql` before authorized execution; it registers one fixed once-per-minute worker with a 55-second network timeout, no tenant/time/body overrides.
7. Enable email only after the callback and scheduler are verified. Use an explicitly authorized fixture/test recipient with eligibility before the ordinary target. Record one request, one immutable consumed attempt, received minimal email, authenticated link authority and visible status. Test personal disable and delivery suppression without editing Auth/SMS settings. Aim for submission within 15 minutes of the target during the pilot; check actual load/lag before expanding.

## Health and disable

`supabase/operators/email-reminders-health.sql` reports coarse heartbeat, queued lag, expired submissions and named cron registration. A successful worker check is not evidence all email reached inboxes. Sending is bounded to four sequential calls per run and one 100-record reconciliation page; measure backlog under expected pilot load. A heartbeat older than 15 minutes is visible in the app. External operator alert integration is E8 work.

To stop new email, set `EMAIL_REMINDERS_ENABLED=false`, then review/run `supabase/operators/email-reminders-disable.sql`. Keep signed callbacks and personal disable available. Continue authenticated disabled worker calls for expiration sweeping if needed. Preserve attempts, consumed cycle/user/channel guards, endpoint suppression and Auth account revisions. Do not clear these to retry uncertain/failed mail; recovery is E4-S4. No destructive schema rollback is supplied.

Late records, new assignments, changed/verified addresses or re-enabled preferences after the target display catch-up unavailable; they are E4-S3 work. SMS remains a separately configured, explicitly enrolled additional channel. Configuring SMS or email does not itself authorize sending optional texts or upgrade old consent.

Primary provider references: [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [retrieve API](https://resend.com/docs/api-reference/emails/retrieve-email), [delivered event](https://resend.com/docs/webhooks/emails/delivered), [bounced event](https://resend.com/docs/webhooks/emails/bounced), [Svix verification](https://docs.svix.com/receiving/verifying-payloads/how).

- [x] Hosted application backup/migration reviewed and applied; exact schema/data preservation verified.
- [ ] Sender/domain/API/support/analytics verified.
- [ ] Shared Auth-provider suppression decision recorded.
- [ ] Canonical signed callbacks and restricted operator infrastructure verified.
- [ ] Authorized scheduler registered and email enabled.
- [ ] Live designated email receipt/status/suppression acceptance recorded.
- [ ] User-confirmed mobile/desktop copy and preference acceptance.
