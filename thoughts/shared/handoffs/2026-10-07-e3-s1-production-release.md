# E3-S1 production release — 2026-10-07

The user's explicit “deploy to prod” instruction authorized deployment and normal production-branch finalization to the existing hosted pilot. Hosted verification completed by 2026-10-07T18:05:09Z.

## Release identity

- Application: https://license-radar.vercel.app; calendar: https://license-radar.vercel.app/practice/calendar.
- Vercel project `license-radar`, `prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF`, scope `arsens-projects-630b84fe`. Existing production environment retained.
- Hosted Supabase project `vowgvmpxkctoqjoqfkqp` unchanged. **No migration, seed, reset, role, grant, environment, SMTP, or dependency change.** `git diff` from the production baseline confirmed no changes under `supabase/`, `package.json`, or `package-lock.json`.
- Repository https://github.com/arsenaid-yere1/license-radar.git; production branch `main`. Observed remote baseline `1d80100e4088df16488fbc85d1ebddd8bae85e1f`.
- Exact committed archive deployed: `d9408a4cf10efa1ceb39cdf90de6e5c82196b399`, including tested runtime commit `594c41b756b00014ef995fba5eaa4499fd49af9e` plus thoughts-only evidence.
- Independently reproduced archive/source SHA-256: `1a677dcdc6d270c2343534151e08ddb2bdcbdb74ff07f0c1f0efb6b7c9b0160d`, 202 tracked non-thought inputs.
- Gauntlet `fe67d913-e5ba-43b1-896d-e1193466251d`: **32/32 passed**, 256 unit, 103 integration, 44 browser tests. Full verification and limits: `thoughts/shared/research/2026-10-07-e3-s1-implementation-evidence.md`.
- Promoted READY deployment `dpl_BpKb2YzMaRAAFRWXtz7rwFhTJVKy`, https://license-radar-4hthibjwp-arsens-projects-630b84fe.vercel.app.
- Previous live deployment for application rollback: `dpl_ANBkVmkxWTBfxLkPC3uvpAdqrtbc`, https://license-radar-tf520qh8b-arsens-projects-630b84fe.vercel.app. This was independently observed before this release.

## Commands and results

Release commands used the existing Node 24.21.0 PATH and cached Vercel CLI 62.4.0. Supabase CLI remained pinned to 2.119.0. CLI help was inspected before using deployment, promotion, inspection, and key-inventory commands. No new tool was installed.

| Command/check                                                                                                                            | Result                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git ls-remote origin refs/heads/main`, `git status --short`, `sourceState()`                                                            | Expected baseline; clean source; successful gauntlet hash matched                                                                                    |
| `git archive HEAD` and independent file hashing                                                                                          | Committed archive matched verified source                                                                                                            |
| `vercel deploy <archive> --prod --skip-domain --yes --dry --json --project <id> --scope <scope>`                                         | Next.js detected; 240 files, 2540488 bytes; all upload paths committed, SHA-1 and size matched; local environment files, caches and reports excluded |
| `vercel alias ls --json --limit 100 --scope <scope>`                                                                                     | Previous live deployment recorded                                                                                                                    |
| `vercel deploy <archive> --prod --skip-domain --yes --json --project <id> --scope <scope>` with source commit/hash and gauntlet metadata | READY; Next.js 16.3.8 build, types and page generation passed; calendar and detail emitted as dynamic routes                                         |
| `vercel inspect <staged URL> --json --scope <scope>`                                                                                     | Independent READY production-state confirmation                                                                                                      |
| `vercel promote dpl_BpKb2YzMaRAAFRWXtz7rwFhTJVKy --yes --scope <scope>`                                                                  | Success                                                                                                                                              |
| Independent alias lookup after promotion                                                                                                 | `license-radar.vercel.app` mapped to promoted deployment ID                                                                                          |
| Read-only HTTP/API smoke helper                                                                                                          | Nine application paths and three anonymous data denials passed; zero data writes                                                                     |
| Existing signed-in Chrome session                                                                                                        | Practice/register calendar entry links, month/agenda, filters, retained navigation and unavailable detail checks passed                              |

The builder emitted the existing `unrs-resolver` install-script approval warning; the build and deployment completed successfully. Existing hosted settings and authentication were retained. No login code was requested and no form that mutates production data was submitted.

## Hosted acceptance boundary

- `/login` and `/join` returned HTTP 200.
- Anonymous `/practice`, `/practice/team`, both register views, `/practice/calendar`, explicit agenda, and a dummy detail route returned HTTP 307 to `/login`, with `private, no-store, max-age=0`.
- Legacy and maintenance register list RPCs, plus anonymous cycle SELECT, returned HTTP 401 / PostgreSQL `42501`. Only an unprivileged publishable key was selected in memory; no key value was printed or retained.
- Signed-in calendar read the existing practice timezone, showed October 7 as today, and rendered October 2026 month and agenda views. Practice ownership plus malpractice type filters remained selected while navigating to November. Calendar links from settings and the register worked. A nonexistent detail ID showed “Record unavailable” with return links.
- The live active register contained no credentials. Hosted populated event/detail rendering, edits, archive submissions, and user manual acceptance are **not claimed**. Populated local SQL/API/browser witnesses remain documented in the implementation evidence. Existing user data was not created, edited or archived during verification.
- Sanitized operational evidence is retained in ignored `reports/e3-s1-production-*`; release/smoke helpers and committed upload archive are outside tracked source.

## Recovery and repository finalization

For application rollback, promote the previous live deployment above. No database rollback is required for this app-only release. Keep existing saved records and the deployed E2-S3 schema.

README and this release record form the final documentation checkpoint. Runtime code, migrations, dependencies and verification tools remain identical to the tested/promoted archive. README participates in the whole-source hash, so this documentation checkpoint is not represented as another full gauntlet run. A normal fast-forward push to `main` synchronizes the release; the existing Git integration may rebuild identical runtime inputs. Documentation formatting and `git diff --check` passed. Gitleaks checked the final Git checkpoint without detected leaks. Repository finalization uses a normal fast-forward `git push origin HEAD:main`, with independent `git ls-remote` identity verification and operational evidence in `reports/e3-s1-production-git-final.log`.

Calendar and agenda are live. E3-S2 dashboard and E4 scheduling/dispatch remain future work. Text reminders are inactive.
