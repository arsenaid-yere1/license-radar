# E1-S1 Project Folder Verification — 2026-10-03

The implementation is saved in **/Users/macbookpro/Coding/license-radar**, on **main**. The complete fresh gauntlet passed **26/26 layers** after the recovery fix below. This report supersedes the earlier worktree results for the current source; earlier evidence remains historical.

## Authorization and saved source

The original executable specification was approved with the user's exact message **“approved”**. Contract: [approved specification](../plans/2026-10-03-e1-s1-old-coder-spec.md), checkpoint 784bf772c104fd528684776d1b6e130b97c39531. The latest instruction, **“verify implementation and save code under project folder”**, authorizes landing in the project folder and takes precedence over the original isolated-worktree setup. No story behavior or acceptance assertion was relaxed.

- Main was fast-forwarded from 784bf77 to worktree/report commit 32b46bc0edf3af4a3c77e91363aab3de14a6ee45. No tracked project edits were overwritten; .DS_Store was preserved.
- Final tested source commit: **4aa535059eb48b1057a903338eb121aedb9b16b9** (recovery fix and regressions).
- SHA-256 of 90 tracked non-thoughts inputs: **8179fcbbcc5f199575fffe09bc7fd9150ea1e5761957cd74b552377e2e43e4f0**.
- Fresh run: **d30e5072-af65-4c36-bb57-e05101f2ad77**, 2026-10-03T22:00:40.144Z → 2026-10-03T22:07:59.852Z, exit 0.
- No code, test, dependency or tool edits after the final run. The subsequent evidence commit contains documentation only; source hash must remain equal.
- Review included application auth/persistence boundaries, the complete migration and the resulting recovery diff. This was author review, not independent review.

## Recovery regression found and fixed

After a successful edit returned version 2, a following validation or API failure omitted the practice in action state. PracticeForm then used its initial prop version 1, producing a false conflict on the next valid save. This sequence was missed by the earlier green gauntlet.

The two new **S21 S24 keeps the latest saved version after a invalid/unavailable response** tests in tests/unit/practice-form.test.tsx were run before the fix. Both failed with **AssertionError: expected '1' to be '2'** (2 failed, 97 skipped). RED log is retained locally at .tools/version-regression-red.log. Reproduce RED by temporarily removing the preservation assignment in a disposable checkout; do not modify the saved verified source.

The minimal fix in src/components/practice/practice-form.tsx preserves the last successful practice when a subsequent result lacks one. Failed inputs/messages remain intact. A real stale edit still requires reload. All 99 unit tests passed immediately after this source-only fix; assertions were frozen.

The existing production test **S24 interrupted Data API retains inputs and retry succeeds** now verifies, without reload: successful edit → blank validation rejection → successful retry → revoked-write failure → restored-write retry. It asserts hidden versions 2, 2, 3, 3 and 4, plus persisted values after reload. This expands S09/S21/S24 coverage without altering their contract or increasing the browser test count. The full browser and shuffled runs both passed this stronger flow.

## Fresh gauntlet commands and results

Run from the project folder using Node 24.21.0/npm 11.19.0. Actual entry point:

```sh
export PATH="$PWD/.tools/node/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.browser-cache"
caffeinate -i npm run gauntlet
```

Persisted command manifest: tools/layers.json. Logs/results are freshly rebuilt under ignored reports/ and coverage/. No old worktree reports were copied as current evidence.

| Layer | Persisted command | Actual result | Exit |
| --- | --- | --- | --- |
| checker-controls | `npm run test:controls` | 12 passed, 0 failed/skipped | 0 |
| checker-sensitivity | `node tools/checker-sensitivity.mjs` | 5 removed-defense controls produced assertion failures; all restored | 0 |
| types | `npm run typecheck` | 0 TypeScript errors | 0 |
| lint | `npm run lint` | 0 ESLint errors/warnings; configured application complexity limit 10 | 0 |
| format | `npm run format:check` | All checked files match Prettier | 0 |
| sql-lint | `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests` | Migration and SQL tests passed SQLFluff | 0 |
| replay | `npm run db:reset` | Dedicated local migration reset/replay passed | 0 |
| schema | `node tools/schema-fingerprint.mjs` | Catalog matches persisted schema contract | 0 |
| database | `npm run test:db` | 20 SQL assertions; 2 foreign-key removal controls detected and rolled back | 0 |
| integration | `npm run test:integration` | 7 tests passed in 2 files | 0 |
| unit-coverage | `npm run test:coverage` | 99 tests passed in 11 files; six properties × 1,000 examples | 0 |
| mutation | `npm run mutation` | 139 executable mutants killed; 171 invalid CompileError; 0 survivors/timeouts/no coverage | 0 |
| mutation-properties | `npm run mutation:properties` | 27 killed by schema properties; 9 invalid CompileError; 0 survivors | 0 |
| sql-mutants | `node tools/sql-mutants.mjs` | 5 applied/executed faults killed and restored; full 7-test integration suite green afterward | 0 |
| schema-restored | `node tools/schema-fingerprint.mjs` | Restored catalog matches contract | 0 |
| generated-types | `node tools/check-generated-types.mjs` | CLI-generated database types match committed source | 0 |
| build | `npm run build` | Next.js production webpack build passed | 0 |
| browser | `npm run test:e2e` | 10 passed; 0 skipped/unexpected/flaky | 0 |
| coverage | `node tools/check-coverage.mjs` | 915/915 mapped owned lines, 20 files; branches 170/192 (88.54%) | 0 |
| suite-health-unit | `npm run test -- --sequence.seed=20261017` | 99 passed; seed 20261017 | 0 |
| suite-health-integration | `npm run test:integration -- --sequence.seed=20261017` | 7 passed; seed 20261017 | 0 |
| suite-health-browser | `node tools/shuffle-browser.mjs` | 10 passed in recorded shuffled order; seed 20261017 | 0 |
| capabilities | `node tools/check-capabilities.mjs` | Textual capability inventory passed; detection limits retained | 0 |
| supply-chain | `node tools/supply-chain.mjs` | 0 runtime npm advisories; 5 accepted dev meta-findings; 649 license entries; 16 Python packages with 0 OSV advisories | 0 |
| secrets-history | `.tools/gitleaks git . --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/secrets-history.json` | 8 commits, approximately 766,513 bytes; 0 leaks | 0 |
| secrets-assets | `.tools/gitleaks dir .next/static --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/secrets-assets.json` | Approximately 4,499,264 static asset/map bytes; 0 leaks | 0 |

The production suite's aggregate JSON is reports/browser-results-full.json. Shuffled tests have separate reports/shuffled-browser-0.json through -9.json; browser-results.json is the final single-test repeat, not the full-suite aggregate. Coverage-summary.json records 46 browser and 36 Node remapped entries; there are no missed mapped owned lines.

Actual API properties: 20 sequences, 27 successful updates, 30 idempotent retries, seed 20261005. SQL name properties: 1,000 generated inputs; unit properties: 6,000 per suite run. Final resend observation: premature age 0.157953 seconds, permitted age 61.333458 seconds, configured cooldown 60 seconds. The test observes real provider database time rather than replacing the cooldown with a fixture shortcut.

## Contract mapping for the current rerun

The unchanged mapping below identifies the tests executed again against the current source. Original acceptance boundaries remain in force. S09/S21/S24 additionally have the consecutive recovery regressions described above. All listed pass statuses refer to this fresh run, not copied run metrics.


Status refers to the named scope actually exercised. Qualifications in the last column are part of the claim; they must not be discarded.

| ID  | Concrete test or verification                                                                                                               | Status | Result and boundary                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | tests/e2e/practice-onboarding.spec.ts :: real OTP; tests/unit/auth-guard.test.ts :: missing identity redirects                              | pass   | Both protected routes redirect signed-out browsers.                                                                                                                                             |
| S02 | tests/e2e/practice-onboarding.spec.ts :: real OTP; tests/unit/auth-actions.test.ts :: requests code without implying verified session       | pass   | Local Mailpit receives a code; request alone grants no session.                                                                                                                                 |
| S03 | tests/e2e/practice-onboarding.spec.ts :: real OTP; tests/unit/server-actions.test.ts :: redirects only after verification                   | pass   | Real verified cookies reach onboarding.                                                                                                                                                         |
| S04 | tests/e2e/practice-failures.spec.ts :: expired and reused OTP; practice-onboarding.spec.ts :: wrong code                                    | pass   | Wrong, reused, and fixture-expired tokens produce safe errors.                                                                                                                                  |
| S05 | tests/e2e/practice-onboarding.spec.ts :: real OTP, invalid code and resend recovery                                                         | pass   | Premature resend at database send age <60 seconds delivers no second message; polling actual provider database time to ≥61 seconds permits resend. Existing 90-second overall timeout retained. |
| S06 | tests/e2e/practice-onboarding.spec.ts :: mobile keyboard … signout and return                                                               | pass   | Signed-out access requires login; new verification returns the saved profile.                                                                                                                   |
| S07 | tests/e2e/practice-isolation.spec.ts :: separate contexts / real expired cookie refresh; tests/unit/session.test.ts                         | pass   | Real cookie refresh retains owner; redirect cookie/cache copying has explicit boundary assertions.                                                                                              |
| S08 | src/lib/practice/schema.test.ts; supabase/tests/practice_profiles.test.sql; tests/e2e/practice-onboarding.spec.ts                           | pass   | Trimmed Cedar Clinic and exact Pacific zone persist.                                                                                                                                            |
| S09 | src/lib/practice/schema.test.ts; tests/unit/practice-form.test.tsx; mobile browser flow                                                     | pass   | Blank inputs rejected; other values and error focus retained.                                                                                                                                   |
| S10 | src/lib/practice/schema.test.ts; supabase/tests/practice_profiles.test.sql; P01 properties                                                  | pass   | 120 astral code points accepted; 121 rejected.                                                                                                                                                  |
| S11 | src/lib/practice/schema.test.ts; timezones.test.ts; tests/integration/practice-profile.test.ts :: catalog agreement and invalid API zone    | pass   | UTC/Eastern/Pacific accepted; unknown direct API zone rejected; offered catalog agrees with PostgreSQL.                                                                                         |
| S12 | schema.test.ts; tests/unit/server-actions.test.ts :: forged identity and malformed version strings; save.test.ts                            | pass   | Strict object rejects identity/role fields; positive safe integer version required; no rejected write.                                                                                          |
| S13 | tests/unit/practice-form.test.tsx :: visible suggested zone / detection failure; timezones.test.ts                                          | pass   | Editable supported suggestion and displayed UTC fallback; no silent persistence.                                                                                                                |
| S14 | src/lib/practice/timezones.test.ts; tests/unit/practice-form.test.tsx; mobile browser flow                                                  | pass   | Fixed Example only date, 09:00 and selected zone; no scheduling code.                                                                                                                           |
| S15 | tests/unit/practice-form.test.tsx :: pending save / associated error; mobile browser flow                                                   | pass   | 375px keyboard navigation, error focus, disabled pending button, no overflow; axe checks.                                                                                                       |
| S16 | tests/e2e/practice-onboarding.spec.ts :: mobile keyboard … return; tests/integration/practice-profile.test.ts :: concurrent create          | pass   | Refresh, restored session in a new context, and fresh context/code return stable ID and saved values. Browser contexts model session reopen; no full browser-process restart test.              |
| S17 | tests/integration/practice-profile.test.ts :: direct Data API ownership and grants; practice-isolation.spec.ts                              | pass   | B owns B, guesses A ID, forges user metadata, and cannot read/update A; privileged fixture confirms A unchanged.                                                                                |
| S18 | tests/integration/practice-profile.test.ts :: direct Data API; supabase/tests/practice_profiles.test.sql                                    | pass   | Anonymous access, protected-column insert/update, and deletion denied.                                                                                                                          |
| S19 | tests/integration/practice-profile.test.ts :: concurrent create; tests/unit/practice-actions.test.ts                                        | pass   | Retried different inputs return existing values; one creation event.                                                                                                                            |
| S20 | tests/integration/practice-profile.test.ts :: real concurrent create                                                                        | pass   | 20 simultaneous verified application creates resolve to one practice ID and one audit event.                                                                                                    |
| S21 | tests/integration/practice-profile.test.ts :: real stale updates; mobile browser flow; SQL tests                                            | pass   | Successful name/zone edit increments version, records authenticated actor and before/after.                                                                                                     |
| S22 | tests/integration/practice-profile.test.ts :: real stale updates; practice-isolation.spec.ts :: two tabs                                    | pass   | Two simultaneous expected-version edits have one winner; losing browser input survives and reload works.                                                                                        |
| S23 | tests/integration/practice-profile.test.ts :: direct Data API; SQL tests                                                                    | pass   | Private audit read/write denied; existing events unchanged; trigger direct EXECUTE denied.                                                                                                      |
| S24 | tests/unit/{auth-actions,auth-guard,practice-actions,save,routes,server-actions}.test.ts; practice-failures.spec.ts :: interrupted Data API | pass   | Unit boundaries inject transport/provider/read/write errors; real browser induces write-grant denial, retains input, then retries. This does not rehearse a whole-network outage.               |
| S25 | tests/integration/practice-profile.test.ts :: audit fault rolls back both creation and update                                               | pass   | Real test-only trigger failure returns unavailable and rolls back both writes.                                                                                                                  |
| S26 | tests/e2e/practice-failures.spec.ts :: expires between open/save; tests/unit/{save,server-actions}.test.ts                                  | pass   | Cookie removal redirects save to login, storage stays unchanged, and fresh OTP allows one versioned retry.                                                                                      |
| S27 | tools/local-environment.mjs reset; schema-fingerprint.mjs; generated-types checker; post-mutation full integration suite                    | pass   | Fresh migration replay, exact catalog contract, and restored create/isolation/update/rollback scenarios.                                                                                        |
| P01 | src/lib/practice/properties.test.ts; tests/integration/practice-properties.test.ts                                                          | pass   | 1,000 generated Unicode names plus 1,000 explicit boundary examples; 1,000 real PostgreSQL name writes.                                                                                         |
| P02 | src/lib/practice/properties.test.ts; schema.test.ts; direct API ownership test                                                              | pass   | Four properties × 1,000 examples around extra fields, unknown zones, malformed types, safe versions, actionable errors; storage rejection tested separately.                                    |
| P03 | tests/integration/practice-properties.test.ts :: generated actual API sequences                                                             | pass   | 20 seeded sequences; counts recorded in reports/api-properties.json.                                                                                                                            |
| A01 | tests/e2e/practice-{isolation,onboarding}.spec.ts; direct API test; stale update test                                                       | pass   | Malformed forged cookies, separate sessions, guessed IDs, metadata/owner/role forgery, markup-as-text, foreign-Origin action replay and competing edits.                                        |
| N01 | Git baseline-prefix comparison                                                                                                              | pass   | Historical documents preserved; only appended implementation progress, plus new evidence.                                                                                                       |
| N02 | tools/check-capabilities.mjs; schema contract; source/dependency review                                                                     | pass   | Two story tables, local Auth/Data API only; no inventory/reminder/portal/payment/deployment action. Text inspection has stated limits.                                                          |
| N03 | Gitleaks history/assets; capability checker; direct API metadata forgery; strict form tests                                                 | pass   | No application admin key or editable-metadata authorization; test-only PostgreSQL fixture access stays local.                                                                                   |
| N04 | S18/S23; supabase/tests/practice_profiles.test.sql :: N04 foreign-key assertions                                                            | pass   | Normal clients cannot delete, transfer ownership, or modify audit storage.                                                                                                                      |
| N05 | tools/gauntlet-controls.test.mjs; local-environment.mjs; local-fixtures.ts                                                                  | pass   | Hosted URL and wrong port controls fail; reset and privileged fixtures bind to dedicated loopback endpoints.                                                                                    |
| N06 | tools/sql-mutants.mjs; schema-restored; source-state.mjs                                                                                    | pass   | Every applied fault killed/restored; final catalog and source hash equal recorded baseline.                                                                                                     |
| N07 | tools/layers.json; gauntlet.mjs fixed manifest; evidence mappings                                                                           | pass   | 26 mandatory layers recorded only after exit zero; all required final layers must pass.                                                                                                         |

N01 was checked with `git diff 784bf77 -- thoughts/`: before report/progress additions it was empty. After additions, baseline document prefixes were checked unchanged; the existing specification itself remains byte-for-byte identical. This is final artifact review, not a secretly added automated gauntlet layer.


## Environment reconstruction and retained history

Dependencies were installed afresh with npm ci in the project folder. Chromium was installed there with npx playwright install chromium. Python 3.12.14 and a new .venv-gauntlet were used with pip 26.2.1 and requirements-dev.txt. This environment's actual installed inventory is 16 packages, all included in the fresh OSV audit; the prior worktree report's 19-package inventory is not reused. Verified Node/Gitleaks binaries were reused at .tools; npm modules, build outputs, credentials, coverage and reports were regenerated. Exact application/tool dependencies and constraints remain committed in package-lock.json, tools/toolchain.json, tools/python-constraints.txt and requirements-dev.txt.

The old task-owned preview (PID 55296, verified old-worktree cwd) was stopped to free port 3000. Dedicated local Supabase license-radar-e1-s1 was reused at ports 55321/55322/55324. Before resets, a count-only database check found 78 accounts, all fixture accounts, and 0 non-fixture accounts. The unrelated cliniq stack was not modified. Fresh local environment files were generated privately and remain ignored. No remote push, hosted project or deployment occurred. Old worktree/history are retained.

Historical failures and earlier evidence are preserved in [the original evidence report](2026-10-03-e1-s1-old-coder-evidence.md). The present 26-layer run passed on its first complete attempt after the recovery fix. Preliminary types/lint/format and unit checks also passed; they are not substituted for final run numbers.

## Visual observations and assurance boundaries

Agent inspection of freshly generated reports/practice-desktop.png and practice-mobile.png found readable layouts at 1440px and 375px, contained controls, wrapping email/example text, and markup rendered as literal text. Automated keyboard/axe checks passed separately. No new manual user sign-off was obtained.

Coverage means mapped owned statement-start lines, not every physical line; generated types, CSS, framework, tests and tools have other checks. Branch coverage is 88.54%, not 100%. Full Stryker covers the declared validation/auth/actions/repository logic, not all JSX or SQL. The form fix's sensitivity is demonstrated by the two actual pre-fix RED assertions and real production recovery flows. CompileError mutants are invalid and excluded. Property-only mutation validates the schema properties, not the whole app.

The five accepted development meta-advisories are the same scoped GHSA-vfj7-8cjw-p6xm glob/lint chain documented in tools/supply-chain-policy.json. Runtime advisory count is zero; total npm advisory count is not zero. License review remains scoped to local development, including recorded MPL/optional LGPL packages; no public redistribution/legal clearance is claimed.

Forged-cookie and foreign-Origin browser attacks intentionally emit decode/request-rejection diagnostics; their assertions verify denial. Custom checker negative controls and removed-defense sensitivity demonstrate those particular failure paths, not complete checker correctness. Capability checks detect declared textual spellings only.

Independent fresh-agent review: **not performed**, 0 rounds. Manual user product sign-off: **not obtained**. No required gauntlet layer skipped. Broad transport outage, whole browser-process restart, exhaustive Unicode, performance benchmarking, independent security/legal audits and hosted operation remain outside demonstrated scope. Local OTP mail is captured in Mailpit; external delivery is not configured. Staff memberships, renewals, SMS and browser renewal agents are future stories.
