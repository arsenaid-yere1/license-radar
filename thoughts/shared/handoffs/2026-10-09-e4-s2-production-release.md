# E4-S2 production release — 2026-10-09

Status: the additive email schema and tested application are live. Production verification passed; repository finalization uses a normal fast-forward to `main`. Email sending remains disabled pending provider/callback/scheduler setup.

The user's explicit “push to prod” authorizes the release, including the local implementation checkpoint, hosted additive migration and application deployment. Email provider activation remains separate because the existing production environment has only the public Supabase URL and publishable key. Email sending and optional renewal texts remain disabled.

## Release identity

- Implementation checkpoint: `5d0dbd14863a76a7683fad87ac534490f6444cd3` on `codex/email-reminders`; remote production baseline: `d037bff8c9ae4279d04fae92af52d694cadd1057`.
- Source SHA-256: `5322943041bbccf2710159d95af1134351c64da95c0f1a936975f0d2cdcc547a`; 282 tracked non-thought inputs.
- Fresh verification run: `0952905c-e4e7-4a43-9376-4c929bd35512`; **34/34 layers passed**, source unchanged. Detailed commands, counts, downgrade and limits: `thoughts/shared/research/2026-10-09-e4-s2-implementation-evidence.md`. Intermediate prior runs are not substituted for this run.
- Vercel project `license-radar`, `prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF`, scope `arsens-projects-630b84fe`; https://license-radar.vercel.app.
- Independently observed live deployment before preparation: `dpl_G9phJRCnYEaXxLCryaci3snCtoq6`, https://license-radar-nuoiifni5-arsens-projects-630b84fe.vercel.app.
- Supabase project `vowgvmpxkctoqjoqfkqp`, PostgreSQL 17.11. Applied exactly `supabase/migrations/20261009000855_practice_reminder_jobs.sql`; nine migrations now installed, no pending migrations. No reset, seed, role file or Vault change.
- Promoted READY deployment: `dpl_8QNebZ7jSgL4AcmFJroFMZF871WE`, https://license-radar-aze1i3jpv-arsens-projects-630b84fe.vercel.app; independent alias inventory confirms the main and secondary project hostnames. The Git-main alias advances with repository finalization.

## Completed hosted preflight

The read-only repeatable-read snapshot and catalog comparison matched all nine application schema sections against the production baseline. Checksums of all 21 existing historical tables and the core Auth identity projection were captured without exporting records. Eight historical migrations were installed before release. The migration dry run reported exactly the single email-reminder migration, with no seed or role changes and Vault skipped.

The security advisor reported zero ERROR findings and the same three inherited warnings: anonymous/authenticated execution of platform `public.rls_auto_enable`, and disabled leaked-password protection. Existing production environment inventory contained only the encrypted public Supabase URL and publishable key. No fixture, provider, service-secret or live-send settings were added or exposed.

## Authorized private backup

The activation handoff requires a backup before the hosted migration: `thoughts/shared/handoffs/2026-10-08-e4-s2-email-activation.md`, prerequisite 1. A proposed application-schema/data backup to a private local temporary directory was rejected before execution by automatic approval review: “This exports the production database schema and application data to local files; the user’s release request does not specifically authorize copying potentially sensitive production data to this destination.” No backup files were created and the rejected export was not rerouted through another tool.

The user then answered **“yes”** to the explicit private-backup/completion question. The approved public/private application schema and data exports completed at `2026-10-09T17:06:22.836Z` in `/private/tmp/license-radar-e4-s2-backup.Neebn5`, directory mode 0700, both files mode 0600. No record contents or credentials were printed. The backup excludes managed Auth/platform data; no restore rehearsal is claimed. The Free Plan has no scheduled hosted backup, and no plan upgrade or purchase was performed.

| Backup file  | Bytes   | SHA-256                                                            |
| ------------ | ------- | ------------------------------------------------------------------ |
| `schema.sql` | 207,895 | `647fff23998bb9e68ea6ff9d9af77cab47f225e466996c924b27f4a7ce5fc389` |
| `data.sql`   | 6,634   | `1e0562bae25e237c5fadeb071faf3b0d87ed6bc7d4f2260380ebcda74ab1efa3` |

## Candidate preparation and verification

`git archive` of the tested checkpoint created `/private/tmp/license-radar-e4-s2-release.egqyE5`. Independent SHA-256 reconstruction matched all 282 tracked non-thought inputs. The Vercel dry file inventory matched exact tracked files, sizes and SHA-1 hashes: Next.js, 342 files, 3,801,502 bytes. Local environment files, dependencies, caches and ignored reports were excluded.

`vercel deploy <archive> --prod --skip-domain --yes --json --project <id> --scope <scope>` succeeded, with source commit/hash metadata submitted. The hosted builder used Vercel CLI 62.7.0 and Next.js 16.3.8; compilation, TypeScript and route generation passed. The independent inspect result confirmed **READY** production candidate `dpl_8QNebZ7jSgL4AcmFJroFMZF871WE`, https://license-radar-aze1i3jpv-arsens-projects-630b84fe.vercel.app, with `/practice/reminders`, `/api/reminders/run` and `/api/reminders/email/webhook` present. Existing environment settings were retained and sending remains disabled. The inherited `unrs-resolver` install-script notice appeared; the build succeeded.

Despite `--skip-domain`, Vercel assigned the project's secondary hostname `license-radar-arsens-projects-630b84fe.vercel.app` to the candidate. The main hostname and Git-main hostname stayed on the previous deployment. Independent `vercel alias ls --json` exposed this mapping; `vercel alias set <previous-url> <secondary-hostname> --scope <scope>` restored it. A complete, unpaginated alias inventory then confirmed **all three existing production hostnames** point to `dpl_G9phJRCnYEaXxLCryaci3snCtoq6`. The candidate remains available only through its unique deployment URL. Do not rely on inspect's stale aliases projection alone.

The candidate's anonymous application-route probe stopped at `/login`: HTTP 302 rather than the required 200. A separate read-only header check identified the redirect as `https://vercel.com/sso-api`, confirming Vercel deployment protection. That candidate probe was not a passed application smoke test; no protection setting was weakened or bypassed. The complete production-hostname smoke subsequently passed after promotion.

Sanitized evidence remains in ignored `reports/e4-s2-production-*` and `reports/e4-s2-candidate-http.json`. The candidate/probe helpers are temporary files outside tracked source. No live email, OTP, preference change or application-data mutation beyond the reviewed migration was submitted.

## Hosted verification and actual commands

Release commands used bundled Node 24.21.0, pinned Supabase CLI 2.119.0 and cached Vercel CLI 62.4.0. Hosted Supabase commands ran sequentially.

| Command/check                                                                                                                 | Result                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase db dump --linked --project-ref <ref> --schema public,private --file <private-file>`; second dump with `--data-only` | Both exit 0; file hashes, sizes and restricted permissions verified.                                                                                                                                                                                      |
| `supabase db push --project-ref <ref> --dry-run --skip-vault --output-format json` before/after                               | Exactly one pending reviewed file before; up to date, zero pending files afterward.                                                                                                                                                                       |
| `supabase db push --project-ref <ref> --skip-vault --yes --output-format json`                                                | Exactly the email migration applied; no seeds, roles or Vault changes.                                                                                                                                                                                    |
| Read-only `supabase db query --linked --project-ref <ref> --file <snapshot.sql> --output-format json` before/after/final      | Nine catalog sections match; all 21 full historical row sets and Auth core identity unchanged; correct one-account, one-member-preference, one-practice-outbox and one-scan-state defaults; zero jobs/attempts/history backfill; completion markers null. |
| `supabase db advisors --linked --project-ref <ref> --type security --fail-on error --output-format json`                      | Zero ERROR; exact same three warning identities as before.                                                                                                                                                                                                |
| `vercel promote dpl_8QNebZ7jSgL4AcmFJroFMZF871WE --yes --scope <scope>`; independent `vercel alias ls --json`                 | Promotion success; primary/project hostnames map to the exact READY candidate.                                                                                                                                                                            |
| Complete read-only production HTTP/API smoke                                                                                  | Fourteen application paths, 27 anonymous data denials and all three disabled boundary responses passed; zero application-data writes.                                                                                                                     |
| Existing signed-in Chrome session at `/practice/reminders`                                                                    | New page loaded, recipient email ready, default-enabled personal preference visible, optional texts inactive, worker unscheduled and empty register. No control submitted.                                                                                |

The first post-promotion alias assertion incorrectly required the Git-main alias to advance before the repository push. Inventory showed the two production hostnames correctly promoted and the Git-main alias correctly retained its old Git deployment. The assertion was corrected to those observed semantics; no application or migration change was made. The earlier protected candidate probe and this verification-tool failure remain disclosed rather than counted as passes.

Anonymous protected routes return 307 to `/login` with private/no-store responses. All 26 legacy/SMS/email RPCs and anonymous cycle read deny with 401 / PostgreSQL `42501`. Invalid unconfigured SMS callback returns empty XML 503; unauthenticated worker returns private empty JSON 401; unconfigured email callback returns private empty JSON 503. No service key was used by the smoke helper; an unprivileged public key stayed in memory and was not printed.

Final checks after the signed-in read preserved historical data/Auth identity and zero email jobs, attempts, events or worker runs. The production register is empty, so populated scheduling, preference writes, new Auth writes and provider callback acceptance remain covered by local tests rather than hosted acceptance. No live email, human manual acceptance or scheduler/provider confidentiality claim is made.

## Repository finalization and recovery

The final README/plan/activation/release edits are documentation only. Runtime code, migration, dependencies and verification tools remain identical to the tested/promoted archive. README participates in the source hash, so this documentation checkpoint is not presented as a second full gauntlet. Formatting, final diff and secret scans are checked; normal finalization uses `git push origin HEAD:main`, followed by independent remote and live deployment verification. Git integration may rebuild identical runtime inputs; final identities are recorded in `reports/e4-s2-production-git-final.log` and `reports/e4-s2-production-live-final.json`.

An unnecessarily broad local directory secret scan was stopped with SIGINT before completion because it included ignored dependencies. It is not credited as a pass; the final tracked Git-history scan is the release check. Documentation formatting and the runtime comparison against the tested checkpoint passed.

Preserve the additive schema, attempts and suppression history on application rollback. Provider activation and live acceptance remain in `thoughts/shared/handoffs/2026-10-08-e4-s2-email-activation.md`; the missing provider configuration was not invented or enabled during release preparation.
