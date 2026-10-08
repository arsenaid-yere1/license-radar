# E4-S1 implementation evidence

Status: local implementation complete. All 33 required verification layers passed on the corrected source checkpoint. Hosted activation and user acceptance remain unconfirmed.

## Contract and source

- User instruction: “create specs and implement it.” **spec approval: not obtained (autonomous run)**. This authorizes implementation, not independent review of the newly authored specification.
- Tier 3: privileged verification proof, tenant access, concurrency, consent, provider side effects and additive persistence.
- Independent implementation verification: **not performed**. Discovery agents researched existing tooling/tests; they did not independently verify this implementation. Confidence is limited accordingly.
- Specification: `thoughts/shared/plans/2026-10-08-e4-s1-old-coder-spec.md`; plan: `thoughts/shared/plans/2026-10-08-e4-s1-phone-enrollment.md`.
- Baseline: `886133312e5e7a8b89a327a43c5e918253a8bcc3`; specification checkpoint: `0e4dc2f`; initial implementation checkpoint: `e77d7004b9a93975c33653e623a6eb2e396c0c23`; corrected verification checkpoint: `761c9878ab4ce1fe3492a695f5745ed7a4f62749`.
- Verification source hash: `d9f53f04076328016a230d0d1fb3c7819533b743c27f03b25a6d8d5f4cde903f`, 246 tracked non-thoughts inputs. `tools/source-state.mjs` rejects dirty/untracked runtime inputs. Completion documentation under `thoughts/` does not change that hash.
- Isolation: suitable existing branch `codex/e3-s2-renewal-dashboard`, with its ignored pinned tools, dependencies, browser cache and guarded local environment. No fresh worktree or hosted changes.
- Added exact dependencies: `twilio@6.1.2` (official Verify and signature SDK), `server-only@0.0.1` (production server import boundary). Versions and transitives are pinned in `package-lock.json` and recorded in `tools/toolchain.json`. No new test framework.
- Entry point: `PATH="$PWD/.tools/node/bin:$PATH" npm run gauntlet`, with persisted commands in `tools/layers.json`. The runner sets the installed Chromium cache and runs database resets, upgrade/fault campaigns and browser workflows sequentially. It regenerates ignored reports and requires a clean committed source state.
- Environment: Node 24.21.0, TypeScript 6.0.3, Next 16.3.8, React 19.3.0, Vitest 5.0.3, Stryker 10.0.0, fast-check 4.10.2, Playwright 1.63.0, Axe 4.13.0, Supabase CLI 2.119.0, PostgreSQL 17, SQLFluff 4.4.0 and Gitleaks 8.30.1. Existing Python requirements/tool checksums remain pinned.

## Behavior delivered

`supabase/migrations/20261008184507_practice_sms_enrollment.sql` adds seven private RLS-protected tables, restrictive/composite references, owner-authenticated operations and five service-only entry points. The original recipient API still returns `ready: false`. The detailed projection exposes minimal enrollment readiness separately from inactive delivery. `private.mutate_member` invokes enrollment invalidation for revocation/viewer demotion, including unselected staff.

`src/lib/sms/operations.ts:changeEnrollment` derives verified identity and live membership. The server reserves a request in SQL, releases locks, makes one bounded provider call and records only a trusted matching outcome. Leases and exact receipts recover durable state without automatically repeating provider I/O. OTP permission and reminder consent are separate server-owned disclosures; codes never enter application ledgers. Same-phone no-ops retain proof/consent; confirmed replacement clears them immediately. Withdrawal remains available to active viewers and when provider setup is absent.

`src/lib/sms/privileged-repository.ts` is the only application service-key boundary and exports named SMS operations, without a raw client/generic RPC export. `src/lib/sms/config.ts` separates callback validation from the live-send flag and requires exact loopback/explicit guards for fixtures. Live sending requires actual support contact and the explicit reviewed-disclosure flag. The official SDK has automatic retries disabled and a ten-second timeout.

`src/lib/sms/webhook.ts:handleSmsWebhook` validates the fixed canonical URL and all form fields using the official signature implementation, then requires configured account/service/destination, anchored source/message syntax and recognized opt-out type. Size, stream, media and duplicate-field failures precede persistence. STOP stores a sanitized event and terminal endpoint suppression atomically, including unknown-phone tombstones. START/HELP never unblock; ordinary messages receive empty TwiML without retained Body or application confirmation.

`src/app/practice/sms/page.tsx` and `src/components/sms/enrollment-panel.tsx` provide owner-only masked status, explicit requested verification, cleared code fields, separate unchecked consent, withdrawal and reload recovery. Shared settings render selection and readiness from the detailed response together. `/sms-information` is public; no live legal/provider acceptance is claimed. `tools/serve-covered.mjs` owns the loopback provider fixture lifecycle; no fixture route is added to the application.

## Specification mapping

The integration witnesses below are named tests in `tests/integration/practice-sms-enrollment.test.ts`. Unit names refer to the corresponding `tests/unit/sms-*.test.*` files; properties are in `src/lib/sms/properties.test.ts`, with 1,000 generated cases per property and seed 20261008 plus explicit boundaries. Real browser witnesses are in `tests/e2e/practice-sms-enrollment.spec.ts` against the production build, ordinary actions, real local database and guarded HTTP provider fixture.

| Spec scenario | Persisted executable witnesses |
| --- | --- |
| 1 Additive upgrade | `tools/sms-enrollment-upgrade.mjs`: exact snapshots of all 14 populated historical tables, deliberate transaction failure/full catalog rollback, upgraded/fresh catalog match, zero enrollment/consent backfill and legacy compatibility. |
| 2 Empty owner-safe state | Integration “Empty enrollment is owner-safe”; repository parser/output assertions. |
| 3 Active owner authority | Integration owner/foreign/anonymous matrix, viewer preparation denial and same-token revoked denial; “Foreign, anonymous and revoked preparation has no enrollment side effects”; operations/actions strict identity tests and input properties. |
| 4 International ASCII syntax | Schema examples and independent generated phone oracle; explicit anchored/Unicode/extension/ASCII-whitespace cases. |
| 5 Replacement/no-op/version | Integration replacement and same-phone no-op tests, stale version before no-op; operations no-provider-call witness; browser confirmed replacement and cleared persisted proof. |
| 6 Separate OTP permission | Integration exact OTP event/disclosure and zero consent; disclosure exact-copy unit test; operations and browser unchecked choice. |
| 7 Trusted matching proof | Ordinary service RPC denial, SQL mismatched/non-approved outcome matrix; provider adapter/service identity unit tests and real browser mismatch fixture. |
| 8 Separate reminder consent | Integration verified `consent-required`, unchecked denial, explicit consent and exact disclosure; browser verification-to-consent flow and unit panel choices. |
| 9 Selected readiness/private projection | Integration selection/readiness/withdrawal and exact three-key shared state; detailed repository parsing; settings same-snapshot unit regression. |
| 10 Withdrawal/idempotent replay | Integration repeated withdrawal and historical consent replay returning current withdrawn state; viewer withdrawal, operations missing-setup withdrawal, real browser withdrawal/reconsent. |
| 11 Lifecycle invalidation | Integration unselected staff demotion/promotion, retained JWT revocation, eligible role preservation; witnessed demotion/revocation versus approval. |
| 12 One live endpoint challenge | Parallel two-practice allocation with one busy result and one live row; expired predecessor retirement and successor assertions. |
| 13 Original expiry | Integration known-SID resend with exact same challenge and expiry; browser explanatory copy. |
| 14 Reservation budgets | Real cooldown/five-reservation flow; seeded valid retained receipt ceilings for actor/day, phone/half-hour, phone/day and tenant/day; observed old-practice claim wait, revoke/join/new-practice actor budget denial. Seeds exercise retained history without provider sends. |
| 15 Bounded checks/expiry/privacy | Concurrent busy check, five reservations/exhaustion, expired-check rejection, six-ASCII-digit properties and sanitized request/result contracts. |
| 16 Immutable exact requests/leases | Parallel claim/expired lease, exact request replay and changed payload/cross-intent conflicts; single-provider-call operations assertions. |
| 17 Unknown acceptance/recovery | Unit lost result and committed-receipt read recovery with exact call counts; production browser accepted-but-lost send/check and mismatched provider response all leave one send reservation and no proof/consent. |
| 18 Stale approval/access | Real separate sessions with observed `pg_stat_activity` lock waits for replacement, viewer demotion and revocation in both orders; lease expires while blocked and rejects approval. |
| 19 Audit/receipt rollback | Forced proof-event and consent-receipt triggers; state/request/event assertions before/after failed transaction; SQL behavioral fault campaign. |
| 20 Signed/global STOP | Official-signature webhook unit/browser route, shared two-practice enrolled phone suppression and unknown tombstone API cases. |
| 21 Callback deduplication | Same SID idempotency, incompatible recognized type conflict, one event/epoch; sanitized schema/arguments exclude Body. |
| 22 Terminal START/HELP | SQL STOP/START state assertions, webhook ordinary/START/HELP unit cases and browser START still blocked. Application returns empty TwiML and makes no confirmation call. |
| 23 Hostile callbacks | Unit altered signature/URL/identity/fields, duplicate fields, anchored lookalikes, malformed bytes/broken streams, exact size bounds and media normalization; no persistence on rejection. |
| 24 Retryable storage faults | Database forced event fault leaves consent/suppression unchanged; webhook unit 503/retry; real route forced storage fault yields empty private 503 and no event, then successful retry. |
| 25 STOP races | Observed endpoint-lock waits in both consent and trusted-approval commit orders; readiness is false after STOP. User paths use practice before endpoint; STOP takes no tenant locks. |
| 26 Missing setup | Config/operations/routes/panel tests hide collection and preserve status/withdrawal; configured callback remains usable with live flag off. |
| 27 Fixture fail-closed | Exact URLs/flags/credential configuration unit negative matrix including hosted/deployment/conflicting-live values; provider fixture remains in `tools/`, with no application bypass route. |
| 28 Browser persistence/privacy | Real send/wrong/right/consent/refresh/sign-out/sign-in/withdraw/replacement flow; code field clears, no OTP returned or persisted by application, diagnostic capture disabled for sensitive workflows. |
| 29 Independent readiness refresh | Recipient panel refresh with unchanged assignment version; owner panel role refresh; safe assignment-success copy and detailed settings snapshot regression. |
| 30 Origin/private responses | Real captured consent action replay with foreign Origin is rejected without changed rows; SMS-page and callback no-store assertions; inherited private-route/auth checks. |
| 31 Accessibility | Browser Axe and no overflow at 375px/1440px, public terms/privacy, focused feedback/labels and existing keyboard cases; explicit SMS Enter/Tab/Space and focused error assertions; sanitized empty-input screenshots are agent-reviewed, not user acceptance or screen-reader certification. |

The specification's negative constraints have separate boundaries:

| Retained constraint | Witness and scope |
| --- | --- |
| Email authentication and historical access/recipient/register/date behavior | Inherited production-browser onboarding/sign-in workflows and `practice-access.test.ts`/`practice-recipients.test.ts`, including retained-JWT revocation, tenant/private-storage denial and last-administrator invariants; all existing integration/browser suites remain required. |
| No active renewal delivery or implicit consent | Owner/shared schemas require `deliveryActive: false`; exact disclosure, preparation/selection, lifecycle and START/receipt witnesses above. Final diff/catalog review introduces enrollment records and provider verification/opt-out operations, with no scheduling/dispatch or Auth-phone mutation. Absence of unrelated functionality is a reviewed scope claim, not a universal runtime proof. |
| No ordinary proof/storage authority or client credentials | SMS SQL grants/RLS/service-entry tests, composite references, static import/export negative controls, `server-only`, production asset and history scans. No general privileged client is exported. |
| No OTP/body retention or shared phone detail | Strict non-OTP request/event/result schemas, sanitized callback argument assertions, exact owner/shared projection assertions, cleared code input and private browser diagnostics. These cover named paths, not arbitrary future logging or all possible browser extensions. |
| No live calls or hosted fixture bypass | Exact fixture guard matrix and separate loopback harness; live SDK calls are mocked only at the transport boundary in adapter tests. The complete browser run uses the guarded local HTTP fixture. No provisioning/deployment command was run. |
| All inherited gates retained | Both layer inventories require the original 32 plus the SMS upgrade layer; checker controls test missing layers and disabled defences. Mutation thresholds remain 100%; coverage rejects any missing executable line. |
| No unobserved acceptance claim | Independent verifier and user/manual/live/operator approval are explicitly unperformed; no automated local pass substitutes for them. |

## Final verification

Fresh run `72d373aa-c257-4f52-a4d9-866ec6ad7484` started `2026-10-08T20:36:20.460Z` and finished `2026-10-08T21:09:56.289Z` with `status: passed`, all 33 required layers, zero skipped layers and every exit code 0. `reports/gauntlet.json` records each duration and the source identity above; the runner checked the same source hash after every layer completed. The commands below all belong to that single final run, invoked through `PATH="$PWD/.tools/node/bin:$PATH" npm run gauntlet`.

| Layer | Persisted command | Actual result |
| --- | --- | --- |
| checker-controls | `npm run test:controls` | 42/42 controls passed. |
| checker-sensitivity | `node tools/checker-sensitivity.mjs` | 25 disabled-defence controls and 10 UI faults produced expected failures; restored checks passed. |
| types | `npm run typecheck` | Exit 0, no type errors. |
| lint | `npm run lint` | Exit 0, no lint errors/warnings. |
| format | `npm run format:check` | Exit 0. |
| sql-lint | `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests` | Exit 0. |
| access-upgrade | `node tools/access-upgrade.mjs` | Exit 0. |
| recipient-upgrade | `node tools/recipient-upgrade.mjs` | Exit 0. |
| register-upgrade | `node tools/register-upgrade.mjs` | Exit 0. |
| credential-dates-upgrade | `node tools/credential-dates-upgrade.mjs` | Exit 0. |
| register-maintenance-upgrade | `node tools/register-maintenance-upgrade.mjs` | Exit 0. |
| sms-enrollment-upgrade | `node tools/sms-enrollment-upgrade.mjs` | All 14 populated historical tables retained; complete rollback catalog and fresh replay matched; zero enrollment/consent backfill. |
| replay | `npm run db:reset` | Exit 0; complete local migration replay. |
| schema | `node tools/schema-fingerprint.mjs` | Exit 0; recorded full catalog matched. |
| database | `npm run test:db` | 163 assertions in 8 SQL files; 100 applied constraint/index/invariant/grant faults failed as expected and rolled back. |
| integration | `npm run test:integration` | 139/139 tests in 12/12 files passed. |
| unit-coverage | `npm run test:coverage` | 325/325 tests in 49/49 files; standalone unit lines 1,321/1,355, statements 1,480/1,521, branches 1,277/1,350 and functions 383/397. |
| mutation | `npm run mutation` | 100%; 2,489 generated: 1,409 assertion kills, 2 timeouts, 1,078 compiler-invalid; zero survivors/uncovered mutants. |
| mutation-properties | `npm run mutation:properties` | 100%; 885 generated across 11 files: 613 assertion kills, 1 timeout, 271 compiler-invalid; zero survivors/uncovered mutants. |
| sql-mutants | `node tools/sql-mutants.mjs` | 107/107 actually applied SQL/API faults detected and independently restored; restored full 139-test integration suite passed. |
| schema-restored | `node tools/schema-fingerprint.mjs` | Exit 0; catalog matched after mutation restoration. |
| generated-types | `node tools/check-generated-types.mjs` | Exit 0; committed types matched fresh CLI output. |
| build | `npm run build` | Exit 0; production build completed. |
| browser | `npm run test:e2e` | 52/52 production-browser tests passed. |
| access-adversarial | `node tools/access-adversarial.mjs` | Exact inventories: 8 API + 2 browser attacks passed; strict-input property and 9 browser cases detected deliberate faults, then passed after restoration. |
| coverage | `node tools/check-coverage.mjs` | 1,355/1,355 executable lines, 85/85 application files; merged branches 2,338/2,616 (89.37%). 1,006 browser and 720 Node source-map contributions; stale/missing maps are failures. |
| suite-health-unit | `npm run test -- --sequence.seed=20261017` | Shuffled 325/325 tests, 49/49 files passed. |
| suite-health-integration | `npm run test:integration -- --sequence.seed=20261017` | Shuffled 139/139 tests, 12/12 files passed. |
| suite-health-browser | `node tools/shuffle-browser.mjs` | All 52 discovered tests passed in recorded shuffled order (seed 20261017), each in fresh contexts. |
| capabilities | `node tools/check-capabilities.mjs` | Exit 0; constrained server boundary and import/export checks passed. Static-analysis limits remain below. |
| supply-chain | `node tools/supply-chain.mjs` | 0 runtime advisories; 5 classified development findings under the retained policy; 678 licenses reviewed; 16 Python packages, 0 advisories; exact direct pins matched. |
| secrets-history | `.tools/gitleaks git . --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/secrets-history.json` | 0 findings, exit 0. |
| secrets-assets | `.tools/gitleaks dir .next/static --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/secrets-assets.json` | 0 findings, exit 0. |

Machine reports are ignored/regenerable artifacts: `reports/gauntlet.json`, `reports/mutation*.json`, `reports/sql-mutants.json`, `reports/coverage-summary.json`, `reports/browser-order.json`, `reports/supply-chain.json` and per-layer logs. Compiler-invalid mutants are excluded from runnable scoring; Stryker counts timeouts as detected, separately from assertion kills. The combined executable-line gate is 100%; exhaustive branch/function coverage is not claimed.

Agent manual verification: reviewed the resulting implementation diff and the fresh empty-input screenshots at 375px and 1440px, including readable copy/controls and visible focus. Keyboard/Enter/Tab/Space, Axe and overflow assertions were automated, rather than inferred from the pictures. Human acceptance, screen-reader certification and real phone/provider acceptance were not performed. Completion edits are confined to `thoughts/` and preserve the tested non-thoughts source hash.

## Failures and corrections

- Initial SQL witnesses failed before the migration. Ambiguous PL/pgSQL names and timestamp-pair constraint failures were corrected before proceeding.
- Some application tests followed implementation; strict test-first development is not claimed. Persisted mutation/sensitivity campaigns exercise assertion strength. Later same-phone, post-lock lease and snapshot-alignment regressions were observed RED, then repaired without changing their behavioral assertions.
- Preliminary mutation runs found whitespace/offset/malformed-state, disclosure/copy/configuration, callback-boundary and recovery-call gaps. Assertions were strengthened and redundant callback account/service/destination checks consolidated into exact schema literals/allowlist validation. No mutation/coverage threshold or inherited layer was weakened.
- An initial standalone browser invocation omitted the repository Chromium cache. It failed before running workflows; the corrected invocation uses the installed cache. The final gauntlet configures that cache itself.
- The first complete run (`dc69c798-a36c-4ae6-afd7-ecc7b9a1cbad`, initial source hash `b9459f51944971bfce3f24a5e3a2f7d7ffec0cf3f1f6766f77964a8459bfb778`) stopped at mutation: 99.86%, two survivors, 1,405 assertion kills, six timeouts and 1,079 compiler-invalid mutants out of 2,492 generated. A signed duplicate-field rejection test now distinguishes malformed-input 400 from later signature rejection. The second survivor was an equivalent redundant parse-success guard; the caller already rejected its undefined failure result. That guard was removed. An observed-RED signed prototype-like key revealed dropped form data; null-prototype parsing now retains all names. The focused callback campaign then passed 100% (51 kills, one timeout, 38 compiler-invalid, zero survivors), and the four production-browser SMS workflows passed with the added keyboard assertions. Neither these focused passes nor the failed complete run replace a complete fresh final run.
- New setup-UI fixture assumptions were corrected to the actual contract: collection controls are absent when unavailable, and an existing owner phone still permits withdrawal. No failing behavioral requirement was removed.

## Limits and retained constraints

Diff review covers the additive migration, shared membership invalidation and recipient projection, the isolated service-client/provider boundaries, owner enrollment UI and callback recovery, plus retained test/checker inventories. Complexity review is manual module/transaction-boundary inspection; no numeric complexity threshold was introduced. SQL claim/record transitions remain atomic within their database functions. No separate scale or latency benchmark was run: the contract bounds provider timeout, reservations and lock orders, but promises no throughput SLA.

No renewal scheduling/dispatch, SMS login, Auth-phone mutation, behalf consent or automatic restoration was introduced. Email sign-in and all historical recipient/register/date APIs remain covered by inherited gates. Assignment, promotion, receipt replay and START cannot create consent. Raw E.164 data stays in protected private storage; application encryption/retention guarantees beyond existing infrastructure are not claimed. Private application ledgers do not retain OTPs; the test-only fixture holds generated codes in memory for its harness.

The capability checker follows statically declared imports/re-exports and specific secret/export spellings; it is not a complete dynamic-code information-flow proof. Production `server-only`, direct SQL grants, asset/history scanning and adversarial tests are separate layers. Negative controls prove specific failure paths, not universal checker correctness. Mutation excludes compiler-invalid mutants and distinguishes timeouts from assertion kills. Source coverage is an executable-line gate, not exhaustive branches or CSS execution.

Fixture guards recognize the explicitly named deployment flags and require exact local targets; they are not a universal classifier of every hosting environment. Database race witnesses cover the named lock orders and local real sessions, without a scale/latency SLA. The HTTP provider fixture and SDK-boundary tests do not prove real carrier delivery, Twilio provisioning, handset behavior, legal approval or exact-once external SMS delivery. No real provider call, hosted write, push or deployment occurred.

User-confirmed manual acceptance and live activation remain unchecked. `thoughts/shared/handoffs/2026-10-08-e4-s1-live-activation.md` records actual local setup, operator prerequisites, callback-preserving rollback and future E4-S2 scheduling/E4-S3 dispatch requirements. Keep STOP processing and retained suppression history when disabling live sends or rolling back the UI.
