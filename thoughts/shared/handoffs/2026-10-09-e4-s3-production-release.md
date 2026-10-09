# E4-S3 production release — preparation in progress

The user's explicit “push to prod” authorizes the implementation checkpoint, complete release verification, normal repository push and matching hosted additive migration/application deployment. Provider/scheduler setup and real-recipient acceptance sends remain separate. Production currently has only the encrypted public Supabase URL and publishable key; email and optional renewal texts are disabled by their existing configuration gates.

## Tested source and targets

- Implementation checkpoint: `59f6e180c2dd1107c3f38cc9185bd2ab00463e2c`, branch `codex/catch-up-reminders`.
- Remote `main` baseline independently checked: `ac3cc079fde95fc05341752b8a00de8cd0f9cc11`.
- Second verification attempt `6291faf9-4ac0-44f7-a348-9e27f011585e` failed after 18 passing layers; see the test synchronization correction below. It used source SHA-256 `213a4962c5bdde700474a5942b148cd34ee159e219c9c82620a50836bf054e38`, 287 tracked non-thought inputs. A fresh complete run remains required; preliminary checks do not replace it.
- Vercel project `license-radar`, `prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF`, scope `arsens-projects-630b84fe`; https://license-radar.vercel.app.
- Independent live-before deployment: `dpl_7JQtoGaxtkin1cUdwkjn63KthZ1a`, https://license-radar-31j1dh6wq-arsens-projects-630b84fe.vercel.app. Unpaginated alias inventory confirms all three existing production hostnames point to that deployment.
- Supabase project `vowgvmpxkctoqjoqfkqp`; reviewed migration `supabase/migrations/20261009175711_email_reminder_catch_up.sql`.

## Completed hosted preflight

The repeatable-read, read-only catalog snapshot matches all nine application catalog sections against the production baseline. It covers all 33 historical domain/SMS/email tables and a checksum of core Auth identity without exporting record values. Original-column checksums are used for jobs/attempts so new additive scheduling fields can be separately asserted after migration. Outbox generation/cursor changes have an exact precomputed expectation; other original rows must remain unchanged.

Nine historical migrations are installed. `supabase db push --project-ref <ref> --dry-run --skip-vault --output-format json` reported exactly the one reviewed catch-up migration, with empty seed and role lists. No hosted reset, seed, role file, Vault update, application deployment or repository push has occurred yet.

The hosted security advisor reports zero ERROR findings and the same three inherited warning identities: anonymous/authenticated execution of platform `public.rls_auto_enable`, and disabled leaked-password protection. Existing environment names are exactly `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; no fixture/provider/service-secret settings were added or printed.

The existing production smoke passed 59 checks: 13 application routes, 42 installed anonymous RPC denials, an anonymous cycle-table denial and three disabled worker/callback boundaries. Only the unprivileged publishable client key was used, never a service key. Smoke preparation found that an old temporary configuration file was absent; encrypted environment metadata and the initially loaded public script bundles did not contain a usable key. The approved CLI read retrieved the current public settings into a private temporary environment file, validated only the expected public URL/key and removed that raw file. No production record export or real message was involved. New V2 smoke remains required after migration; the baseline test deliberately includes only functions currently installed.

## Interrupted verification attempt

The first complete gauntlet attempt, `5ee0a78a-efed-402e-94b3-8083da63e33d`, passed 21 layers and failed the unmodified SQL mutation baseline before applying that fault. The invitation case recorded a 1,053,057 ms duration despite a 30,000 ms timeout, and the next case's local OTP had expired. Both exact baseline cases passed on immediate repeat (612 ms total) without source, assertion or timeout changes. Kernel sleep/wake timestamps independently showed recent system sleep. Idle sleep interruption is the supported explanation, not an application assertion defect; the unsuccessful run is not credited as complete. Its metadata, baseline and logs were preserved privately. The fresh complete run uses `/usr/bin/caffeinate -i npm run gauntlet`, inhibiting idle system sleep only for that process's lifetime; every layer and threshold is retained.

The second complete attempt passed 18 layers and failed unit coverage: `Phone replacement invalidates prior proof` observed “Saved” before React's refresh effect completed, so its immediate `expect(refresh).toHaveBeenCalled()` failed. Both the test and component were byte-identical to production baseline; the exact seven-test file passed immediately on repeat. The test now clears its refresh spy and awaits the same assertion using the existing `waitFor` default, retaining all assertions and timeouts. Deliberately removing the refresh effect made that assertion fail; the component was restored exactly. The full randomized unit suite passed 393 tests and the corrected seven-test file passed after restoration. Production SMS implementation is unchanged. A fresh source checkpoint and all 35 layers remain required.

## Backup authorization — pending

The existing activation workflow requires a backup before migration: `thoughts/shared/handoffs/2026-10-08-e4-s2-email-activation.md`, prerequisite 1. The proposed public/private application schema/data export uses `/private/tmp/license-radar-e4-s3-backup.*`, mode 0700 for the directory and 0600 for files, with contents withheld. Managed Auth/platform data is excluded; no hosted restore rehearsal is claimed.

Automatic approval review rejected the export before execution: “This copies the full hosted public/private production schema and data to a local temporary directory; the release request does not specifically authorize exporting that sensitive payload to that destination, despite restrictive file permissions.” No backup directory or backup file was created, and the rejected export was not rerouted. Explicit private-backup/completion approval was requested; the full local gauntlet and unaffected release preparation continue while that required answer is pending.

A read-only inspection of the production project's Supabase Database → Backups page confirmed “Free Plan does not include project backups.” No managed backup can satisfy the prerequisite on this project's current plan. No billing upgrade, restore or download was requested or performed. Official backup documentation: https://supabase.com/docs/guides/platform/backups.

## Remaining release steps

1. Finish all 35 current-source verification layers without changing their thresholds or inventories. Preserve the exact source hash/run result.
2. Complete the explicitly authorized private backup; refresh hosted preflight immediately before applying the reviewed migration.
3. Archive the exact tested checkpoint and independently match its source hash and Vercel dry upload inventory. Keep local environment files, dependencies, test caches and ignored outputs out of the upload.
4. Apply only the additive migration with Vault/seeds/roles excluded, with sending still disabled. Verify all original rows, core Auth identity, normal snapshots and the intentional outbox enqueue; repeat security advisors and confirm zero pending migrations.
5. Deploy the matching production candidate using `--skip-domain`; independently inspect READY state and alias mappings. The previous release observed secondary-hostname assignment despite that flag, so verify and restore any premature hostname assignment rather than trusting the flag or inspect's aliases projection alone.
6. Promote the verified matching candidate, confirm production hostname mappings, and run anonymous application/API denials plus disabled worker/callback boundary checks. Inspect the existing signed-in session without submitting preferences, records or live messages.
7. Record actual evidence and pending hosted/inbox/user acceptance separately. Commit documentation, use a normal `git push origin HEAD:main`, then independently verify remote commit and the final live deployment. Documentation-only changes are not described as a second full gauntlet; compare runtime/migration inputs with the tested archive.

Keep additive fields, immutable attempts, consumed guards, signed callbacks, preferences, suppression history and SMS STOP/withdrawal on rollback. Further activation follows `thoughts/shared/handoffs/2026-10-09-e4-s3-catch-up-activation.md` and the existing email setup workflow.
