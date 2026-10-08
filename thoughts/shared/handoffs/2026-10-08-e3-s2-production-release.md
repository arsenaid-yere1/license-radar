# E3-S2 production release — 2026-10-08

The user's explicit “push to prod” instruction authorized deployment and normal production-branch finalization to the existing hosted pilot. Hosted verification completed by 2026-10-08T17:26:25.591225+00:00.

## Release identity

- Application: https://license-radar.vercel.app; dashboard: https://license-radar.vercel.app/practice/dashboard.
- Vercel project `license-radar`, `prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF`, scope `arsens-projects-630b84fe`. Existing production environment retained.
- Hosted Supabase project `vowgvmpxkctoqjoqfkqp` unchanged. **No migration, seed, reset, role, grant, environment, SMTP, or dependency change.** The baseline diff under `supabase/`, `package.json`, and `package-lock.json` is empty.
- Repository https://github.com/arsenaid-yere1/license-radar.git; production branch `main`. Observed remote baseline `cc1088da1382f50cf1d4301db25d9f19073c9f95`.
- Exact committed archive deployed: `a6471940a26e57729e7318c6cb2f064e8491d5e4`, including tested runtime checkpoint `ca8c5fdcb92683f9a79d74b6155383b7dba27d78` plus thoughts-only evidence.
- Independently reproduced archive/source SHA-256: `28e2f471536c536ae8bd56f8abd438ebfb4bd6b4a7a0bd0b443f799c105ad05c`, 211 tracked non-thought inputs.
- Gauntlet `ba2dfac9-26c0-4b08-95b6-6988d64b9004`: **32/32 passed**, 270 unit, 107 integration, 48 browser tests; shuffled suites passed. Full verification and limits: `thoughts/shared/research/2026-10-08-e3-s2-implementation-evidence.md`.
- Promoted READY deployment `dpl_ACPRtVEqMVtMkH3j8JUpfVoUAm7u`, https://license-radar-g3ligdx01-arsens-projects-630b84fe.vercel.app.
- Previous live deployment for application rollback: `dpl_hmawNAAfEMLUS23DUn5y5grx4g1b`, https://license-radar-6sm5z4utk-arsens-projects-630b84fe.vercel.app. Independently observed before this release.

## Commands and results

Release commands used Node 24.21.0 and cached Vercel CLI 62.4.0. The hosted builder used Vercel CLI 62.7.0. Supabase CLI remained pinned to 2.119.0. CLI help was inspected before deployment, promotion, inspection, alias and key-inventory commands. No new tool was installed.

| Command/check                                                                                                                            | Result                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git ls-remote origin refs/heads/main`, `git status --short`, `sourceState()`                                                            | Expected baseline; clean source; successful gauntlet hash matched                                                                                    |
| `git archive HEAD` and independent file hashing                                                                                          | Committed archive matched verified source                                                                                                            |
| `vercel deploy <archive> --prod --skip-domain --yes --dry --json --project <id> --scope <scope>`                                         | Next.js detected; 257 files, 2710087 bytes; all upload paths committed, SHA-1 and size matched; local environment files, caches and reports excluded |
| `vercel alias ls --json --scope <scope>`                                                                                                 | Previous live deployment recorded; complete 13-alias inventory had no next page                                                                      |
| `vercel deploy <archive> --prod --skip-domain --yes --json --project <id> --scope <scope>` with source commit/hash and gauntlet metadata | READY; Next.js 16.3.8 compilation, types and page generation passed; dashboard emitted as a dynamic route                                            |
| `vercel inspect <staged URL> --json --scope <scope>`                                                                                     | Independent READY production-state confirmation                                                                                                      |
| `vercel promote dpl_ACPRtVEqMVtMkH3j8JUpfVoUAm7u --yes --scope <scope>`                                                                  | Success                                                                                                                                              |
| Independent alias lookup after promotion                                                                                                 | `license-radar.vercel.app` mapped to promoted deployment ID                                                                                          |
| Read-only HTTP/API smoke helper                                                                                                          | Eleven application paths and three anonymous data denials passed; zero data writes                                                                   |
| Existing signed-in Chrome session                                                                                                        | Dashboard, all three entry links, practice-local snapshot date, refresh, missing-end section anchor and unavailable-record dashboard return passed   |

The builder emitted the existing `unrs-resolver` install-script approval warning; build and deployment succeeded. Supabase help initially could not write its telemetry file inside the sandbox; the authorized read-only command succeeded outside it. No login code was requested and no form that mutates production data was submitted.

## Hosted acceptance boundary

- `/login` and `/join` returned HTTP 200.
- Anonymous practice/settings, team, active/archived register, dashboard, dashboard with hostile practice/date/horizon query inputs, calendar, explicit agenda, and dummy detail routes returned HTTP 307 to `/login`, with `private, no-store, max-age=0`.
- Legacy and maintenance register list RPCs, plus anonymous cycle SELECT, returned HTTP 401 / PostgreSQL `42501`. Only an unprivileged publishable key was selected in memory; no key value was printed or retained.
- Existing authenticated Chrome session loaded the dashboard for the existing practice. As-of day was October 8 in `America/Los_Angeles`. All three cards and matching list sections were present with zero counts, explicit empty states and missing-end overlap copy. Settings, calendar and register entry links opened the dashboard. The missing-end card targeted and focused its heading. Refresh reread the page. A nonexistent detail with `from=dashboard` showed neutral “Record unavailable” and a fixed dashboard return link that worked.
- The live active register contained no credentials. Hosted populated urgency/detail rendering, mutations, role-matrix acceptance and user manual acceptance are **not claimed**. Populated local SQL/API/browser witnesses remain documented in the implementation evidence. No production record was created, edited or archived during verification.
- Sanitized operational evidence is retained in ignored `reports/e3-s2-production-*`; release/smoke helpers and committed upload archive are outside tracked source.

## Recovery and repository finalization

For application rollback, promote the previous live deployment above. No database rollback is required for this app-only release. Keep existing saved records and the deployed E2-S3 schema.

README, plan release status and this release record form the final documentation checkpoint. Runtime code, migrations, dependencies and verification tools remain identical to the tested/promoted archive. README participates in the whole-source hash, so this documentation checkpoint is not represented as another full gauntlet run. Normal fast-forward finalization uses `git push origin HEAD:main` and independent `git ls-remote` identity verification, with operational evidence in `reports/e3-s2-production-git-final.log`. The existing Git integration may rebuild identical runtime inputs. Documentation formatting, resulting diff and final Git secret scan are checked before push.

Renewal dashboard, calendar and agenda are live. E4-S1 phone enrollment is next. Text reminders remain inactive.
