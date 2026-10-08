# E4-S1 activation handoff

The additive migration and app were deployed on 2026-10-08 after the user's “push to prod” request. Read-only hosted schema/data/access checks and signed-in setup-page inspection passed; see `thoughts/shared/handoffs/2026-10-08-e4-s1-production-release.md`. Production retains only its existing two public Supabase settings: live phone verification and provider callbacks are not configured, phone collection is unavailable, and renewal reminders remain inactive. No provider provisioning, real OTP or real STOP was performed. The local guarded fixture at ports 3000/55321/55325 uses fake identifiers and a test support contact; those values are not production settings. User manual acceptance and live-phone acceptance remain unconfirmed.

## Separately authorized activation

1. `supabase/migrations/20261008184507_practice_sms_enrollment.sql` is already applied in production. Preserve historical data and the legacy recipient RPC (`ready: false`). No enrollment/consent backfill is allowed; do not reset or replay the migration.
2. Configure `SUPABASE_SECRET_KEY` only on the server. `src/lib/sms/privileged-repository.ts` is the sole application service-client boundary; it exposes only named SMS operations. Do not use `NEXT_PUBLIC_` for any credential.
3. Supply real Twilio account, API key/secret, Verify and Messaging Service identifiers, callback Auth Token, an actual `SMS_SUPPORT_EMAIL`, exact external HTTPS `SMS_WEBHOOK_URL`, and the finite sender phone allowlist. Review the SDK, registered sender coverage, geographic permissions, six-digit/ten-minute Verify settings and Advanced Opt-Out mapping. Remove all fixture flags/URLs/credentials.
4. Review `/sms-information` and exact `src/lib/sms/disclosures.ts` copy, actual phone/history retention and customer-care process. The application does not declare these legally approved. Set `SMS_TERMS_REVIEWED=e4-s1-v1` only after operator review. Keep `SMS_LIVE_ENABLED` off until setup and rollout are explicitly authorized.
5. Perform read-only private-route, public-information, invalid-signature and anonymous-RPC checks. With a separately designated authorized test phone, witness OTP receipt, wrong/right verification, separate consent, selected readiness, withdrawal and signed STOP. Do not infer hosted acceptance from local fixture results.

## Recovery and rollback

- Disable live sending without removing configured callback credentials, canonical URL or sender allowlist. `src/lib/sms/config.ts:callbackConfig` is independent of the live-send flag.
- Retain the callback-capable app/route during rollback or provide an equivalently validated callback deployment. Reverting to the pre-SMS app alone removes STOP handling.
- Retain private SMS tables, immutable history and suppression tombstones. Do not restore consent, clear suppression, drop tables or reapply historical outcomes as permission.
- Unknown provider acceptance is deliberately incomplete. Reload reads durable requests; an expired lease cannot be reclaimed automatically. Await challenge expiry before a fresh attempt.
- Provider START/HELP never restore local consent; same-number resubscription/reconciliation remains E4-S4.

## Future stories

E4-S2 scheduling is next; E4-S3 dispatch and E4-S4 delivery/recovery follow. Every future dispatch must recheck selected live membership, phone revision, current consent/disclosure, suppression epoch and provider block. Unsent jobs must be invalidated atomically on assignment, access, phone, consent, date or archive changes once jobs exist. E1-S3 rule 9 and E2-S3 cancellation remain open; enrollment creates no guessed jobs or active renewal messages.
