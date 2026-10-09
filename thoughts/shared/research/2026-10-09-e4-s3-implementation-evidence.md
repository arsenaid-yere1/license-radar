# E4-S3 implementation evidence — local verification complete

Status: the final fresh source-bound gauntlet passed **35/35 layers**. Matching archive/upload validation also passed. Production remains unchanged while the required private pre-migration backup awaits explicit approval after automatic approval review rejected the export. Failed-run history and hosted preflight are recorded in `thoughts/shared/handoffs/2026-10-09-e4-s3-production-release.md`.

Spec: `thoughts/shared/plans/2026-10-09-e4-s3-old-coder-spec.md`.
Plan: `thoughts/shared/plans/2026-10-09-e4-s3-catch-up-reminders.md`.
Branch: `codex/catch-up-reminders`; base `ac3cc079fde95fc05341752b8a00de8cd0f9cc11`.
Spec approval: **not obtained (autonomous run)** under the user's “create specs and implement it.” Independent implementation verification: **not performed**. Human manual and hosted received-mail acceptance: **pending**.

## Implemented behavior

The additive migration `supabase/migrations/20261009175711_email_reminder_catch_up.sql` preserves nominal targets, adds normal/catch-up kinds and stable dispatch targets, and freezes scheduling snapshots with each consumed attempt. Persisted eligibility after the original target can catch up in the next valid 09:00-inclusive/17:00-exclusive local window; scan time never creates eligibility. Existing locking, bounded pagination and permanent cycle/user/channel permission remain authoritative.

The matching app accepts exactly the two fixed subjects and reads the separately named V2 schedule. V1 keys remain unchanged. Current dates are labeled separately from consumed scheduling; consumed targets/timezone come from the historical attempt/job. Only queued/claimed rows advertise another sending window. Preference and consumed-state copy explains catch-up and the permanent guard.

The operator preview is read-only, timeout-bounded and aggregate-only, including blocked/no-recipient records. The new populated-upgrade tool and mandatory gauntlet layer cover original rows, all twelve email tables, Auth, rollback/catalog replay and an existing ordinary live claim. No dependency was added; the worker/provider retry, budget, credential boundary, optional SMS and hosted configuration were unchanged.

## Executable specification mapping

| SPEC      | Witnesses                                                                                                                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CU01–CU05 | New integration CU01–CU05; CU03 generated exact-window invariants; inherited ER02/ER17/ER24; SQL classification/stable-target/local-window faults                                                                                                                       |
| CU06–CU07 | New CU06/CU07; inherited ER04/ER07/ER22/ER23; cycle/user/channel consumed index and applied guard fault                                                                                                                                                                 |
| CU08      | New confirmation/preference/no-op CU08; inherited ER05/ER06 and transactional preference/Auth bookkeeping                                                                                                                                                               |
| CU09      | New two committed-order CU09 plus snapshot-drift CU09; inherited witnessed blocking ER11–ER14/ER20/ER21/ER26 and atomic invalidation/rollback                                                                                                                           |
| CU10      | New 102-record interruption/resume and expired-lease CU10, V2 100+2 pagination; inherited ER19; worker/deadline/budget tests                                                                                                                                            |
| CU11      | Catch-up lost-response production browser flow; inherited worker lost begin/result/permission faults and ER07/ER08/ER21; one actual loopback POST                                                                                                                       |
| CU12–CU13 | New future/today/past payload CU12, old/new fixed-subject unit and generated properties; inherited privacy/provider/webhook tests and historical payload preservation                                                                                                   |
| CU14      | New V1 exact keys/V2 fields/privacy/foreign/viewer/anonymous/revoked reads, frozen scheduling/timezone; strict parser/property bounds; privilege faults                                                                                                                 |
| CU15      | Reminders route tests for kind/targets/refresh/current dates/consumed copy/suppression-before-attempt; preference copy and no future window for terminal/blocked states                                                                                                 |
| CU16–CU17 | Catch-up browser actual one POST without SMS across disable/reenable/repeated workers; inherited default-off/incomplete-config/unauthorized route and callback/preference tests                                                                                         |
| CU18–CU19 | `tools/reminder-catch-up-upgrade.mjs`: 33 populated historical tables plus Auth, original-column equality, normal backfill, unchanged payloads/guards, deliberate rollback, live lease, V1/V2 shape, fresh catalog; inherited email upgrade, schema and generated types |
| CU20      | New read-only aggregate preview integration, no ledger-count changes/no IDs or addresses; deliberate write rejected in read-only transaction                                                                                                                            |
| CU21      | Production-local browser at 375/1440: Axe and overflow assertions, refresh interaction; sanitized agent screenshot inspection (not human acceptance)                                                                                                                    |

Must-not constraints map to those witnesses plus inherited access/SMS/register suites, strict SQL/checker inventories, schema restoration and capability/secrets/supply-chain gates. No automatic retries or uncertainty replay, clock-forging grants, kind-based uniqueness, guessed dates, worker-budget expansion, private projection or live message authorization was introduced.

## Preliminary checks and failures

Recorded runtime: Node 24.21.0, Supabase CLI 2.119.0, pinned dependencies from `package-lock.json`. Local services are guarded `license-radar-e1-s1`, API 55321/DB 55322/Mailpit 55324 and loopback email fixture 55326. Reused ignored local dependencies and fixture configuration on an isolated branch. At that preliminary stage, no tool/dependency installation, checkpoint commit, hosted write or live send had occurred. The release checkpoint and completed source-bound run are recorded below; no hosted write or live send has occurred.

Standalone browser checks set `PLAYWRIGHT_BROWSERS_PATH="$PWD/.browser-cache"` to reuse the repository's recorded browser. The complete gauntlet sets that itself. Standalone commands also prepend `.tools/node-v24.21.0-darwin-arm64/bin` to `PATH`.

- Baseline `npm test`: 387 passed. New initial specification: nine observed database assertion failures and one new-subject assertion failure before implementation.
- Initial UI/API specification produced five assertion failures before schema/UI implementation. Frozen-timezone, preview no-recipient, consumed-history and preference-copy regressions were observed failing before their fixes.
- `node tools/reminder-catch-up-upgrade.mjs`: passed original-column preservation across 33 populated tables plus Auth, all twelve email tables, eight existing attempts, callback history, outbox reset/increment, complete transaction rollback, ordinary live claim and fresh catalog replay. Intermediate fixture failures were corrected: composite return decoding, inspected callback parameter order, archived-job exclusion and interruption setup that preserves the intended claim.
- `npm run test:db`: 188 SQL assertions passed; 112 actually applied FK/index/invariant/grant controls produced exactly the expected failures and rolled back. The initially stale 19-assertion inventory failed closed; it now requires all 25 reminder assertions with three added V2/window grant faults.
- `npm run test:integration -- tests/integration/practice-reminder-jobs.test.ts tests/integration/practice-reminder-catch-up.test.ts`: 40 passed in the earlier targeted run. Full integration then passed 179 tests across 14 files. After adding the stale-unconsumed V2 scenario, the current catch-up suite passed all 17 tests. The inherited late-onset fixture was corrected to deny permission before 09:00:01 and allow it at that exact dispatch instant. Full current-source repeat pending.
- `npm run lint`, `npm run typecheck`, `npm run format:check`: passed after reducing row complexity without changing assertions. Current `npm test`: 393 passed across 61 files in the latest preliminary run.
- After correcting the fault runner's literal, formatting/lint/types and all 44 verification controls passed again. `npm test -- --sequence.seed=20261017` passed all 393 tests across 61 files in randomized order.
- `npm run test:controls`: 44 passed; new mandatory-upgrade omission test first failed before both inventories were extended to 35 layers.
- SQLFluff migration/test/operator lint: passed; preview uses supported `SET LOCAL transaction_read_only = on`, witnessed by a rejected write.
- Current `npm run build` and scoped reminder browser: four passed after the final UI and V2 freshness fixes, with one actual catch-up POST, one actual catch-up lost-response POST, no resend, no SMS enrollment and zero Axe/overflow violations at both widths. Current sanitized screenshots inspected by agent.
- `npm run mutation:properties`: 967 instrumented mutants; 675 killed, one timeout, zero survived, zero no-coverage and 291 compile errors; 100% score at the unchanged threshold. The reminder subset had 62 killed and 20 compile errors. This preliminary property-only run does not replace the full final mutation campaigns.
- Current `npm run mutation`: 3,207 instrumented mutants across the selected 49 source files; 1,864 killed, five timeouts, zero survived, zero no-coverage and 1,338 compile errors. The unchanged 100% score gate passed. Timeouts count toward Stryker's score and are reported separately from assertion kills; compile-error mutants are excluded by the tool.
- `npm run test:coverage`: all 393 unit tests passed; 97.78% statements, 95.33% branches, 96.77% functions and 97.96% lines. Unit-only coverage does not establish the required merged executable-source 100% gate.
- `node tools/check-capabilities.mjs`: passed the unchanged capability boundary. Gitleaks source, history (57 commits) and current built-asset scans found no leaks. The final source-bound run still includes these gates.
- `node tools/supply-chain.mjs`: zero runtime advisories; five development findings matched the existing classifications; 682 license records; 16 Python packages with zero advisories. Dependency/tool inventory was unchanged.
- SQL fault campaign stopped after 117 applied/executed/killed/restored controls: the next stable-target fault used an obsolete variable name and correctly failed before application. Its literal match was corrected to the inspected current `practice.timezone` expression, followed by the complete fresh campaign below. No unevaluated fault was counted as killed.
- The corrected full SQL campaign passed: all 122 actual faults were applied, executed, killed by named assertions and independently restored; the full restored integration suite passed 180 tests across 14 files. Current schema fingerprint and generated-type checks passed.
- The broader browser command initially omitted the existing `PLAYWRIGHT_BROWSERS_PATH` environment setting and failed before executing behaviors because the default-cache executable was absent. Rerunning with the inspected `.browser-cache` used by the gauntlet passed all 56 browser tests across 14 files. No browser was installed, no assertion changed and launch failures are not credited as RED.
- The combined coverage checker rejected a missing source map from an older browser build. Only ignored browser/server coverage output was cleared; the fresh full browser run passed all 56 tests and fresh unit coverage passed all 393 tests. `node tools/check-coverage.mjs` then passed 1,673/1,673 inventoried executable lines across 99 files, with 698 mapped browser records and 168 mapped Node records. Combined branch coverage was 88.16% (2,712/3,076); the enforced 100% gate covers executable lines, not all branches. Stale data received no coverage credit.
- Current `npm run test:db` repeated after the browser/SQL campaigns: all 188 SQL assertions and all 112 applied integrity/permission controls passed and restored their changes. Final diff whitespace review passed.
- Supabase `db advisors --local --type security --level warn --fail-on error`: no issues found. Changelog and function documentation refreshed before implementation; relevant PostgreSQL 17.11 change does not introduce one of the changed application capabilities. Version was not upgraded.

## Completed final run

The single reproducible entry point is `npm run gauntlet`, with `.tools/node-v24.21.0-darwin-arm64/bin` prepended to `PATH`. The successful run used `/usr/bin/caffeinate -i npm run gauntlet` to prevent idle system sleep only for the verification process's lifetime. All thirty-five layers and existing 100% mutation/executable-line thresholds were retained. No layer was skipped; the end-of-run source hash matched the committed starting source.

All final counts below come from that one fresh run after the test synchronization edit, not from preliminary campaigns:

- Unit/coverage and shuffled unit: **393 tests across 61 files** passed in each campaign. Unit coverage: statements 1,852/1,894 (97.78%), branches 1,574/1,651 (95.33%), functions 450/465 (96.77%), lines 1,639/1,673 (97.96%).
- Full integration, restored post-fault integration and shuffled integration: **180 tests across 14 files** passed in each campaign.
- Full browser: **56 tests** passed; the discovered shuffled browser inventory also executed and passed all **56**, using fresh contexts.
- Database: **188 assertions** across nine exact baseline inventories; **112 applied integrity/permission faults** were executed, rejected by their expected assertions and restored.
- Checker controls: **44 passed**; **25 sensitivity faults** made the expected controls fail. All inherited populated upgrades and the new catch-up upgrade passed. The latter preserved **33 populated historical tables plus Auth**, original job/attempt fields and payloads, and verified rollback, normal backfill, outbox changes, legacy live claim and V1/V2 clients.
- Full TypeScript mutation: **3,207 instrumented mutants across 49 files** — 1,864 assertion kills, five timeouts, zero survivors, zero no-coverage, 1,338 compile errors; **100%** tool score. Property-only: **967 across 13 files** — 675 assertion kills, one timeout, zero survivors, zero no-coverage, 291 compile errors; **100%** score. Timeouts count toward the tool's score; compile errors are excluded, and neither is described as an assertion kill.
- SQL/API mutation: **122/122 applied, executed, killed by named assertions and independently restored**. Restored full integration and separate catalog fingerprint passed.
- Access adversarial: **ten exact named API/browser scenarios passed**; the strict-input property and all nine selected browser witnesses failed the deliberate faults, with source/schema restoration verified and their restored suites passing.
- Merged coverage gate: **1,673/1,673 inventoried executable lines across 99 files**, 1,026 mapped browser records and 840 mapped Node records. Branch coverage **2,743/3,105 (88.34%)**. The enforced 100% gate covers executable lines, not every branch.
- Types, lint, formatting, SQLFluff, schema replay/restoration, generated types, production build and capability boundaries passed. Supply chain: zero runtime advisories; five development findings matched existing classifications; 682 license records; 16 Python packages with zero advisories. No dependency or tool installation was introduced.
- Gitleaks: **59 commits** and current built assets scanned, **zero leaks**. These counts identify the verified checkpoint, before later documentation-only finalization.

Local fixture evidence does not establish hosted rollout, inbox delivery, legal validity of practice-entered dates, operational restore or user acceptance. Catch-up can expose old/past-due backlog; provider/scheduler activation remains separate under the existing handoff. The user's release authorization does not retroactively establish human SPEC review or independent implementation verification.

## Release-verification correction

The second source-bound attempt passed 18 layers, then unit coverage failed the inherited `Phone replacement invalidates prior proof` assertion because “Saved” rendered before the refresh effect ran. The test and SMS component matched production baseline exactly. The test now clears its refresh spy and awaits its unchanged refresh assertion with `waitFor`'s existing timeout. Removing the refresh effect caused the test to fail; the component was restored exactly. The randomized full unit suite passed 393 tests and the corrected file passed seven tests after restoration. The successful final fresh run below includes this test-only checkpoint; neither failed run is credited as complete.

## Current source-bound run

Run `fb48ab01-d76a-4a49-91f6-5f4a491cbaff`, started `2026-10-09T21:45:18.044Z`, finished `2026-10-09T22:22:39.385Z`. Source checkpoint `9a3f37c676bf20e45f438e67b1dc45725a25b1ca`; SHA-256 `aa48a51bbb044f50c5739022d08e37b8ed4294934cf716504414a47f0c13e997`, 287 tracked non-thought inputs. Status: **passed — 35/35 required layers**, source unchanged.

| Layer                        | Command                                                                                                                                        | Result            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| checker-controls             | `npm run test:controls`                                                                                                                        | Exit 0; 236 ms    |
| checker-sensitivity          | `node tools/checker-sensitivity.mjs`                                                                                                           | Exit 0; 28309 ms  |
| types                        | `npm run typecheck`                                                                                                                            | Exit 0; 1441 ms   |
| lint                         | `npm run lint`                                                                                                                                 | Exit 0; 2731 ms   |
| format                       | `npm run format:check`                                                                                                                         | Exit 0; 1335 ms   |
| sql-lint                     | `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests supabase/operators`                                                       | Exit 0; 6575 ms   |
| access-upgrade               | `node tools/access-upgrade.mjs`                                                                                                                | Exit 0; 28478 ms  |
| recipient-upgrade            | `node tools/recipient-upgrade.mjs`                                                                                                             | Exit 0; 28452 ms  |
| register-upgrade             | `node tools/register-upgrade.mjs`                                                                                                              | Exit 0; 28102 ms  |
| credential-dates-upgrade     | `node tools/credential-dates-upgrade.mjs`                                                                                                      | Exit 0; 27507 ms  |
| register-maintenance-upgrade | `node tools/register-maintenance-upgrade.mjs`                                                                                                  | Exit 0; 28108 ms  |
| sms-enrollment-upgrade       | `node tools/sms-enrollment-upgrade.mjs`                                                                                                        | Exit 0; 28919 ms  |
| reminder-jobs-upgrade        | `node tools/reminder-jobs-upgrade.mjs`                                                                                                         | Exit 0; 28211 ms  |
| reminder-catch-up-upgrade    | `node tools/reminder-catch-up-upgrade.mjs`                                                                                                     | Exit 0; 28131 ms  |
| replay                       | `npm run db:reset`                                                                                                                             | Exit 0; 13657 ms  |
| schema                       | `node tools/schema-fingerprint.mjs`                                                                                                            | Exit 0; 116 ms    |
| database                     | `npm run test:db`                                                                                                                              | Exit 0; 16636 ms  |
| integration                  | `npm run test:integration`                                                                                                                     | Exit 0; 77357 ms  |
| unit-coverage                | `npm run test:coverage`                                                                                                                        | Exit 0; 4390 ms   |
| mutation                     | `npm run mutation`                                                                                                                             | Exit 0; 586141 ms |
| mutation-properties          | `npm run mutation:properties`                                                                                                                  | Exit 0; 368970 ms |
| sql-mutants                  | `node tools/sql-mutants.mjs`                                                                                                                   | Exit 0; 269995 ms |
| schema-restored              | `node tools/schema-fingerprint.mjs`                                                                                                            | Exit 0; 83 ms     |
| generated-types              | `node tools/check-generated-types.mjs`                                                                                                         | Exit 0; 1115 ms   |
| build                        | `npm run build`                                                                                                                                | Exit 0; 7498 ms   |
| browser                      | `npm run test:e2e`                                                                                                                             | Exit 0; 161121 ms |
| access-adversarial           | `node tools/access-adversarial.mjs`                                                                                                            | Exit 0; 145443 ms |
| coverage                     | `node tools/check-coverage.mjs`                                                                                                                | Exit 0; 5138 ms   |
| suite-health-unit            | `npm run test -- --sequence.seed=20261017`                                                                                                     | Exit 0; 3678 ms   |
| suite-health-integration     | `npm run test:integration -- --sequence.seed=20261017`                                                                                         | Exit 0; 77671 ms  |
| suite-health-browser         | `node tools/shuffle-browser.mjs`                                                                                                               | Exit 0; 232909 ms |
| capabilities                 | `node tools/check-capabilities.mjs`                                                                                                            | Exit 0; 164 ms    |
| supply-chain                 | `node tools/supply-chain.mjs`                                                                                                                  | Exit 0; 1998 ms   |
| secrets-history              | `.tools/gitleaks git . --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/secrets-history.json`           | Exit 0; 375 ms    |
| secrets-assets               | `.tools/gitleaks dir .next/static --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/secrets-assets.json` | Exit 0; 308 ms    |
