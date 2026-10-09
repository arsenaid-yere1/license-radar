# E4-S2 production release — 2026-10-09

Status: fully verified release candidate built and held pending the backup decision. The existing production application remains live. No hosted migration, promotion or production-branch push has occurred.

The user's explicit “push to prod” authorizes the release, including the local implementation checkpoint, hosted additive migration and application deployment. Email provider activation remains separate because the existing production environment has only the public Supabase URL and publishable key. Email sending and optional renewal texts remain disabled.

## Release identity

- Implementation checkpoint: `5d0dbd14863a76a7683fad87ac534490f6444cd3` on `codex/email-reminders`; remote production baseline: `d037bff8c9ae4279d04fae92af52d694cadd1057`.
- Source SHA-256: `5322943041bbccf2710159d95af1134351c64da95c0f1a936975f0d2cdcc547a`; 282 tracked non-thought inputs.
- Fresh verification run: `0952905c-e4e7-4a43-9376-4c929bd35512`; **34/34 layers passed**, source unchanged. Detailed commands, counts, downgrade and limits: `thoughts/shared/research/2026-10-09-e4-s2-implementation-evidence.md`. Intermediate prior runs are not substituted for this run.
- Vercel project `license-radar`, `prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF`, scope `arsens-projects-630b84fe`; https://license-radar.vercel.app.
- Independently observed live deployment before preparation: `dpl_G9phJRCnYEaXxLCryaci3snCtoq6`, https://license-radar-nuoiifni5-arsens-projects-630b84fe.vercel.app.
- Supabase project `vowgvmpxkctoqjoqfkqp`, PostgreSQL 17.11. Exactly one pending migration: `supabase/migrations/20261009000855_practice_reminder_jobs.sql`.

## Completed hosted preflight

The read-only repeatable-read snapshot and catalog comparison matched all nine application schema sections against the production baseline. Checksums of all 21 existing historical tables and the core Auth identity projection were captured without exporting records. Eight historical migrations were installed. The migration dry run reported exactly the single email-reminder migration, with no seed or role changes and Vault skipped. No production reset or data write was performed.

The security advisor reported zero ERROR findings and the same three inherited warnings: anonymous/authenticated execution of platform `public.rls_auto_enable`, and disabled leaked-password protection. Existing production environment inventory contained only the encrypted public Supabase URL and publishable key. No fixture, provider, service-secret or live-send settings were added or exposed.

## Backup decision blocking the migration

The activation handoff requires a backup before the hosted migration: `thoughts/shared/handoffs/2026-10-08-e4-s2-email-activation.md`, prerequisite 1. A proposed application-schema/data backup to a private local temporary directory was rejected before execution by automatic approval review: “This exports the production database schema and application data to local files; the user’s release request does not specifically authorize copying potentially sensitive production data to this destination.” No backup files were created and the rejected export was not rerouted through another tool.

An explicit backup decision was requested from the user. Approval has not been received. The read-only hosted Backups page confirms that this Free Plan project has no scheduled backups; no plan upgrade or purchase was performed. Production migration and promotion remain held pending an authorized backup or a direct user decision about this prerequisite.

## Candidate preparation and verification

`git archive` of the tested checkpoint created `/private/tmp/license-radar-e4-s2-release.egqyE5`. Independent SHA-256 reconstruction matched all 282 tracked non-thought inputs. The Vercel dry file inventory matched exact tracked files, sizes and SHA-1 hashes: Next.js, 342 files, 3,801,502 bytes. Local environment files, dependencies, caches and ignored reports were excluded.

`vercel deploy <archive> --prod --skip-domain --yes --json --project <id> --scope <scope>` succeeded, with source commit/hash metadata submitted. The hosted builder used Vercel CLI 62.7.0 and Next.js 16.3.8; compilation, TypeScript and route generation passed. The independent inspect result confirmed **READY** production candidate `dpl_8QNebZ7jSgL4AcmFJroFMZF871WE`, https://license-radar-aze1i3jpv-arsens-projects-630b84fe.vercel.app, with `/practice/reminders`, `/api/reminders/run` and `/api/reminders/email/webhook` present. Existing environment settings were retained and sending remains disabled. The inherited `unrs-resolver` install-script notice appeared; the build succeeded.

Despite `--skip-domain`, Vercel assigned the project's secondary hostname `license-radar-arsens-projects-630b84fe.vercel.app` to the candidate. The main hostname and Git-main hostname stayed on the previous deployment. Independent `vercel alias ls --json` exposed this mapping; `vercel alias set <previous-url> <secondary-hostname> --scope <scope>` restored it. A complete, unpaginated alias inventory then confirmed **all three existing production hostnames** point to `dpl_G9phJRCnYEaXxLCryaci3snCtoq6`. The candidate remains available only through its unique deployment URL. Do not rely on inspect's stale aliases projection alone.

The candidate's anonymous application-route probe stopped at `/login`: HTTP 302 rather than the required 200. A separate read-only header check identified the redirect as `https://vercel.com/sso-api`, confirming Vercel deployment protection. This is not a passed application smoke test; no protection setting was weakened or bypassed. The existing live login still returns HTTP 200. New production database/API and signed-in feature checks remain pending the migration/promotion sequence.

Sanitized evidence remains in ignored `reports/e4-s2-production-*` and `reports/e4-s2-candidate-http.json`. The candidate/probe helpers are temporary files outside tracked source. No live email, OTP or application data write was submitted. All completion edits are confined to `thoughts/` and preserve the tested non-thought source hash.

## Remaining release steps

After resolving the backup prerequisite, refresh the production snapshot, migration dry run, remote branch and alias inventory. Apply exactly the additive migration, and verify historical data, Auth identity, backfilled defaults, all catalog sections and advisor identities. Reinspect the READY candidate, promote it, verify all production aliases, run the complete read-only application/API smoke helper and inspect the existing authenticated browser session. Finalize release status and fast-forward `main` only after those steps succeed. Do not claim this candidate is the shipped production feature while the schema remains at the baseline.

Preserve the additive schema, attempts and suppression history on application rollback. Provider activation and live acceptance remain in `thoughts/shared/handoffs/2026-10-08-e4-s2-email-activation.md`; the missing provider configuration was not invented or enabled during release preparation.
