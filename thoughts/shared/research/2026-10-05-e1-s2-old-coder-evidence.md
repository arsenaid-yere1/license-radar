# E1-S2 implementation evidence — complete

Approval: user “continue with implementation”, in direct response to the initial SPEC approval request. Approved documentation commit: `defdc87`.

Isolated checkout: `/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar`; branch `codex/e1-s2-staff-access`. Main contains only the approved documentation checkpoint.

Final result: **all 28 required layers passed** on source commit `eea83e9dc4adc8d9303a22e4f2a8c18980032ed2`. Run `348f97aa-842e-4ed0-b6f2-df7f337a0f2b`, 2026-10-05 22:58:23–23:11:29 UTC. Source hash `699b054873879599275ac471b702dda190363c14b503b1d909b45c620507da09`, 131 tracked source inputs. The final source restoration check passed. Independent implementation verification: **not performed**, zero rounds, as declared in the approved SPEC.

The preparation records below are historical observations; their pending labels describe those earlier checkpoints. The final-run sections at the end supersede intermediate counts. Evidence/plan-only commits after the tested source are distinguished from the source commit; they do not alter the source hash.

## Setup and observations

- Existing pinned dependencies rebuilt with `npm ci --no-audit --no-fund`: exit 0, 687 packages. No dependency manifest changes.
- Docker inspection identified the dedicated `license-radar-e1-s1` stack and the unrelated `cliniq` database. The latter is outside task scope.
- Pinned Supabase `db --help` and `migration new --help` succeeded with local sandbox escalation. No schema/reset action has run yet.

## Membership checkpoint (intermediate results, not final evidence)

- CLI-created migration: `20261005211436_practice_membership_authority.sql`. Membership backfill, live RLS, RPC-only profile writes, user serialization, deferred administrator invariant, and transactional access audits implemented.
- RED observations persisted in `tools/red-history.json`: 4 integration failures before migration; 7 adapted unit failures before RPC implementation; 6 access-helper failures against its throwing stub.
- First local migration test exposed an invalid `OLD.practice_id` reference on the practice trigger row. Nested row-kind checks fixed it; 4/4 membership integration tests passed afterward.
- Complete unit suite: 105/105 tests in 12 files; `npm run typecheck` and `npm run lint`: exit 0. Complete API suite before fresh replay: 11/11 in 3 files, including 1,000 real PostgreSQL Unicode cases and 20 generated API sequences. SQL suite: 20/20 plus real foreign-key negative controls.
- First complete integration run failed writing an absent ignored `reports/` directory after its behavior assertions passed; created the directory and reran successfully.
- `node tools/access-upgrade.mjs`: exit 0. Actual S1 reset, 2 fixture profiles at versions 2 and 3, 5 old audit events; deliberate transactional upgrade failure observed and rolled back; actual CLI migration upgrade preserved rows; 2 creator-administrator memberships and initialization events; final fresh replay schema matched upgraded schema. No historical reports copied as evidence.
- `npm run gauntlet` is still pending; these intermediate passes do not satisfy final evidence. New checker controls/sensitivity, SQL lint, browser tests and Phase 2–4 remain pending.

## Invitation, browser, and verification checkpoint (intermediate only)

- CLI-generated invitation migration: `20261005212526_practice_invitations.sql`. Strict canonical email, private digest-only invitations, 168-hour issuance, authenticated wrappers, locked explicit acceptance, revocation epochs, role/version mutations, minimal roster, and transactional access events implemented. Public types regenerated from the full replay.
- Added helpers within approved owned modules: `src/lib/team/messages.ts`, `src/components/team/result-message.tsx`, `invitation-link.tsx`, `src/components/auth/invitation-context.ts`, `sign-out-form.tsx`, and `tests/helpers/private-browser.ts`. No new dependency.
- Rebuilt Python 3.12.14 environment using pinned SQLFluff constraints; reused the checksum-recorded Node/Gitleaks runtime through an ignored `.tools` symlink. Installed pinned Chromium locally. Prepared private ignored environment files without printing keys.
- Latest intermediate checks: 146 unit tests/18 files, 48 integration tests/5 files, 52 SQL assertions, 15 real missing FK/index/invariant/grant negative controls, 26 checker controls; 16 initial removed-defense controls observed failing and restored. Types/lint/build passed. These numbers are historical checkpoint results and will be replaced by the final fresh run's numbers.
- All 18 production browser cases passed, including inherited OTP cooldown/refresh/recovery, team roles, invitation validation/reissue/cancel, new/existing/wrong-account join, explicit acceptance, mobile keyboard/axe, and hostile Origin/markup/privacy attacks. Agent visually inspected the masked mobile team screenshot: single-column layout, wrapped email, readable controls. User visual sign-off is not claimed.
- Browser trace/video/automatic screenshot are disabled only for token-bearing specs. The pinned Playwright `PLAYWRIGHT_NO_COPY_PROMPT` suppresses automatic ARIA snapshots that would retain readonly token fields. Deliberate screenshots mask link inputs. Artifact controls inspect retained text and generated token occurrences; exhaustive binary forensics are outside this check.
- Initial browser recovery timing raced sign-out; adding an explicit login redirect assertion fixed it without removing prior assertions. An intermediate full browser attempt overlapped an upgrade reset in error, producing connection/fixture failures; stopped only its identified processes, discarded that run, completed restoration, then reran all 18 successfully.
- Full S1-to-S2 upgrade/rollback rehearsal passed with preserved 2 profiles at versions 2/3, 5 historical profile events, exact backfill, and matching upgrade/replay schema. Schema contract now includes all owned membership/invitation/access tables, grants, functions, indexes, constraints and triggers.
- Exact expiry equality is tested with only the database clock boundary substituted inside a rolled-back transaction; real eligibility and writes remain in use. The distinct post-lock expiry test uses the actual advancing PostgreSQL wall clock.
- AST mutation initially failed before execution because the reused `.tools` symlink matched directory-only sandbox exclusions; added the symlink path to the ignored runtime inputs. Thresholds remain 100. SQL mutation initially rejected Vitest's legitimate “promise resolved instead of rejecting” assertion as infrastructure; added a narrowly tested assertion classifier rather than accepting arbitrary errors.
- Final 28-layer gauntlet, complete mapping, fresh mutation counts and final source binding remain pending. Independent final implementation verification remains **not performed**, zero rounds.

## Final preparation checkpoint (still not the final run)

- Full AST mutation: 725 generated, 331 killed, 394 compile errors, no survivor/no-coverage/timeout; 100% of executable mutants. Property-only AST: 86 generated, 53 killed, 33 compile errors, no survivor/no-coverage/timeout; 100%. No exclusion or threshold reduction. Stryker lists 155 test IDs while normal Vitest reports 158 parameterized cases; these are distinct tool inventories.
- SQL/API fault harness expanded: 34 applied/executed/killed/restored faults passed, followed by the full restored 51-test integration suite. Two additional invalid-version/fresh-digest faults and one new input-boundary test remain to be executed in the final gauntlet. Property sequences now check state/event/admin invariants after every committed step.
- Full unit suite: 158/158; 27 checker controls and 18 removed-defense sensitivity checks passed. Supply chain: 0 runtime advisories, 5 classified development findings, 649 license entries, 16 installed Python packages and 0 reported Python advisories. First attempted `npm run supply-chain` did not exist and exited 1; corrected to the persisted `node tools/supply-chain.mjs` command, exit 0.
- Added stale administrator browser form case: real second administrator is demoted, original form preserves unsaved input and reports denial, shared profile stays unchanged, and team route redirects using current manager role. All three team browser cases passed.
- A unit focus assertion raced React's passive effect under parallel runtime load; retained the exact focus assertion inside `waitFor`. The artifact checker rejected a dummy fragment construction copied as test source into Stryker reports. Rebuilt that fixture with the URL API, preserving its runtime fragment and assertions without relaxing the artifact checker. A failed browser report repeated the checker source in its diagnostic, so that stale report was removed before the fresh browser rerun; the final gauntlet deletes all old reports by design.
- Added `tools/access-red-sensitivity.mjs` as a helper of the approved adversarial harness: it applies/restores strict-input and legitimate-admin faults, requires actual named assertion failures, and reruns the restored cases. Its new gate has a known-bad control and removed-defense sensitivity case. Execution remains pending here.
- A checker-sensitivity preflight briefly ran alongside a browser preflight that imports a shared checker file; this cannot serve as final source-bound assurance. The final gauntlet runs them sequentially, and the sensitivity harness independently reruns a stable browser baseline before faulting it.
- Rebuilt environment uses Python 3.12.14 and pip 26.2.1 (updated from the new virtual environment's initial pip 25.0.1 to the recorded toolchain version). No new direct Node or Python requirement added.

- The complete adversarial preflight passed its exact eight API and two browser attacks. Its strict-input property failed one real source fault; all nine new browser tests failed the deliberate administrator-denial fault. Exact inventories/assertion errors verified; source and schema restored, and the property plus all nine browser cases passed again. The final new database mutation-input test passed as a narrow one-case run (34 intentionally nonselected cases are not counted as executions). Types/format passed. Final clean-source gauntlet remains pending.

- The first gauntlet invocation rejected the default shell Node 26.3.0 before any layer. The final environment explicitly prepends the reused pinned Node 24.21.0/npm 11.19.0 runtime to PATH. Several late intermediate preflights therefore ran on Node 26; they are not the claimed pinned-runtime final evidence.
- Pinned-runtime attempt `ec4bcddb-cca4-499f-ab7a-81930f6992cb` on source `0fee480` passed 12 layers, then was deliberately stopped during TypeScript mutation to strengthen the public creator-revocation regression. Only identified task-owned Stryker/worker PIDs were terminated; no SQL fault was active. That interrupted attempt is not a completed gauntlet. The new `S38 public creator revocation removes existing JWT authority and preserves provenance and another practice` case passed on Node 24; its creator-fallback sensitivity is included in the persisted SQL runner. Existing fixture-prepared creator assertions remain intact.


## Final fresh run

The single entry point is npm run gauntlet. This checkout reused the verified local runtime with:

    PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH" npm run gauntlet

The entry point deleted stale reports/coverage, allocated the run ID above, required clean source, ran every manifest layer sequentially, and verified the restored source hash before reporting success. No source edit followed this successful run. Logs, detailed category inventories, catalog snapshots, redacted attack records and mutation results are in ignored reports/; rerun the entry point to regenerate them.

Actual runtime: Node 24.21.0, npm 11.19.0, Python 3.12.14/pip 26.2.1, SQLFluff 4.4.0; Chromium 153.0.8010.12 (Playwright 1.63.0, revision 1243). Repository pins remain Supabase CLI 2.119.0, PostgreSQL image 17.11.0.002, Vitest 5.0.3, Stryker 10.0.0 and fast-check 4.10.2. Runtime/Gitleaks archive checksums and local container image digests remain in tools/toolchain.json. No direct dependency changed. The constrained SQLFluff environment has 16 packages; historical toolchain inventory also included iniconfig, packaging and pytest, which are absent here. No required pipeline stage uses those three packages. The actual installed inventory and OSV response are preserved in reports/supply-chain.json.

| Layer | Persisted command | Exit | Seconds | Observed result |
| --- | --- | --- | --- | --- |
| checker-controls | npm run test:controls | 0 | 0.139 | 27 controls passed |
| checker-sensitivity | node tools/checker-sensitivity.mjs | 0 | 1.254 | 18 removed-defense controls failed as required; restored |
| types | npm run typecheck | 0 | 0.760 | No TypeScript errors |
| lint | npm run lint | 0 | 1.546 | No errors/warnings; configured application complexity limit 10 |
| format | npm run format:check | 0 | 0.569 | All committed files formatted |
| sql-lint | .venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests | 0 | 1.360 | Migrations and pgTAP SQL passed |
| access-upgrade | node tools/access-upgrade.mjs | 0 | 28.013 | 2 profiles at versions 2/3; 5 historical events preserved; rollback observed; 2 initialized administrators; replay matched |
| replay | npm run db:reset | 0 | 12.978 | Guarded local complete migration reset passed |
| schema | node tools/schema-fingerprint.mjs | 0 | 0.091 | All 9 nonempty catalog sections matched |
| database | npm run test:db | 0 | 2.314 | 52 assertions; 15 real missing FK/index/invariant/grant controls killed and rolled back |
| integration | npm run test:integration | 0 | 40.135 | 53 cases in 5 files passed |
| unit-coverage | npm run test:coverage | 0 | 1.368 | 158 cases in 18 files passed |
| mutation | npm run mutation | 0 | 137.146 | 725 generated: 331 killed, 394 compile errors; 100% executable score |
| mutation-properties | npm run mutation:properties | 0 | 26.678 | 86 generated: 53 killed, 33 compile errors; 100% executable score |
| sql-mutants | node tools/sql-mutants.mjs | 0 | 122.136 | 32 fault definitions, 36 actual executions including property repeats; every applied/executed/killed/restored; full restored 53-case suite passed |
| schema-restored | node tools/schema-fingerprint.mjs | 0 | 0.074 | Independent catalog fingerprint matched |
| generated-types | node tools/check-generated-types.mjs | 0 | 1.107 | Full public types matched fresh local generation |
| build | npm run build | 0 | 5.704 | Production Next.js webpack build passed |
| browser | npm run test:e2e | 0 | 93.012 | 19 production cases passed without retries/skips |
| access-adversarial | node tools/access-adversarial.mjs | 0 | 145.241 | 8 API + 2 browser attacks; strict-input property and all 9 new browser cases failed actual faults, then passed after restore |
| coverage | node tools/check-coverage.mjs | 0 | 2.867 | 1,987/1,987 mapped owned statement-start lines, 38 files; 377/442 branches (85.29%); 397 browser and 355 Node map contributions |
| suite-health-unit | npm run test -- --sequence.seed=20261017 | 0 | 1.514 | 158 cases passed, sequence seed 20261017 |
| suite-health-integration | npm run test:integration -- --sequence.seed=20261017 | 0 | 44.122 | 53 cases passed, sequence seed 20261017 |
| suite-health-browser | node tools/shuffle-browser.mjs | 0 | 113.192 | All 19 discovered cases passed in deterministic shuffled order, each fresh; seed 20261017 |
| capabilities | node tools/check-capabilities.mjs | 0 | 0.024 | Declared authenticated RPC, crypto, clipboard and tab storage spellings reviewed; no forbidden application capability detected |
| supply-chain | node tools/supply-chain.mjs | 0 | 2.153 | 0 runtime advisories; 5 classified development findings; 649 license entries; 16 Python packages, 0 OSV findings |
| secrets-history | .tools/gitleaks git . --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/secrets-history.json | 0 | 0.296 | 0 findings in tested Git history |
| secrets-assets | .tools/gitleaks dir .next/static --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/secrets-assets.json | 0 | 0.312 | 0 findings in production static assets |

Both AST reports contain zero survivor, no-coverage, runtime-error or timeout categories. Compile errors are type-invalid mutants, not executed kills. No equivalent exclusions, static-mutant omission or threshold reduction was used. Behavior-preserving refactors removed redundant serialization/unknown-message/optional-access paths; genuine assertion gaps added exact projection/message/destination, whitespace and token-boundary checks.

SQL fault replacement must change the actual PostgreSQL definition/catalog; each fault has a nonempty selected baseline and exact executed case inventory. Kills require actual assertion failures, not arbitrary infrastructure exceptions. Every restoration runs an independent catalog fingerprint in finally; the restored integration suite also passed. Four secondary property-only executions test epoch, role replay and both access-audit triggers; the separate canonical-email fault is killed by the email property.

## Scenario and invariant mapping

All rows below **passed** in the final run. Names identify actual test titles or labeled upgrade assertions; parameterized variants ran as reported rather than being counted as an unexecuted template. Legacy E1-S1 IDs are explicitly distinguished from the E1-S2 SPEC's numbering.

Concrete witness files:

- Upgrade: [access-upgrade.mjs](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tools/access-upgrade.mjs).
- Access API: [practice-access.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/integration/practice-access.test.ts).
- Invitation API: [practice-invitations.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/integration/practice-invitations.test.ts).
- Access properties: [practice-access-properties.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/integration/practice-access-properties.test.ts).
- Legacy profile API/properties: [practice-profile.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/integration/practice-profile.test.ts), [practice-properties.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/integration/practice-properties.test.ts).
- Join/team/attack browser: [practice-join.spec.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/e2e/practice-join.spec.ts), [practice-team.spec.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/e2e/practice-team.spec.ts), [practice-access-adversarial.spec.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/e2e/practice-access-adversarial.spec.ts).
- Legacy recovery/isolation/onboarding browser: [practice-failures.spec.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/e2e/practice-failures.spec.ts), [practice-isolation.spec.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/e2e/practice-isolation.spec.ts), [practice-onboarding.spec.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/e2e/practice-onboarding.spec.ts).
- Team/action/form/route units: [schema.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/src/lib/team/schema.test.ts), [properties.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/src/lib/team/properties.test.ts), [team-actions.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/unit/team-actions.test.ts), [join-actions.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/unit/join-actions.test.ts), [team-forms.test.tsx](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/unit/team-forms.test.tsx), [join-form.test.tsx](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/unit/join-form.test.tsx), [server-actions.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/unit/server-actions.test.ts), [routes.test.tsx](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/unit/routes.test.tsx), [practice-access.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/unit/practice-access.test.ts), [session.test.ts](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tests/unit/session.test.ts).
- Catalog/storage: [practice_profiles.test.sql](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/supabase/tests/practice_profiles.test.sql), [practice_access.test.sql](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/supabase/tests/practice_access.test.sql), [practice_invitations.test.sql](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/supabase/tests/practice_invitations.test.sql), [schema-fingerprint.mjs](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tools/schema-fingerprint.mjs).
- Checker controls: [gauntlet-controls.test.mjs](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tools/gauntlet-controls.test.mjs), [access-controls.test.mjs](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tools/access-controls.test.mjs), [checker-sensitivity.mjs](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/tools/checker-sensitivity.mjs).
- Owned migrations: [20261005211436_practice_membership_authority.sql](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/supabase/migrations/20261005211436_practice_membership_authority.sql), [20261005212526_practice_invitations.sql](/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar/supabase/migrations/20261005212526_practice_invitations.sql).

### S01–S48

| SPEC case | Named executable witness |
| --- | --- |
| S01 | Upgrade: S01 profiles and historical audits preserved; exact creator-admin/backfill event checks |
| S02 | Upgrade: S02 data rollback and S02 schema rollback after deliberate transaction failure |
| S03 | Upgrade: S03 fresh replay and upgrade schema agree; schema and generated-types layers |
| S04 | Access API: S04 concurrent RPC creation produces one practice, membership and each audit (20 requests plus retry) |
| S05 | Access API: S05 S33 N05 direct writes denied and manager reads shared profile only; team membership creation precedes idempotent create |
| S06 | Access API: S06 S38 creator provenance never restores access with the existing JWT; S38 public creator revocation removes existing JWT authority and preserves provenance and another practice |
| S07 | Invitation API: S07 S11 invalid timezone is rejected through authenticated create and update RPCs; complete legacy profile API/unit/browser suites and P04 |
| S08 | Invitation API: S08 S10 S17 creates canonical digest-only invitation with exactly seven elapsed days; team schema: S08 P02 cryptographic token is 32 bytes and hashes independently |
| S09 | Invitation API: S09 malformed invitation inputs cannot write; S09 S14 database mutation input checks reject invalid versions roles and nonfresh digests without writes; strict-input/action units |
| S10 | Access properties: P01 1000 seeded email variants agree with actual SQL canonicalization; team schema: S08 S10 ASCII normalization preserves dots and plus tags |
| S11 | Invitation API: S11 concurrent duplicate invitation preserves first role and audits once; team browser: S09 S11 S13 S15 S48 invitation validation, duplicate and reissue recovery |
| S12 | Invitation API: S12 cancel retry is no-op and old capability unavailable |
| S13 | Invitation API: S13 S14 S15 reissue recovers lost response, rotates token and rejects stale change; S13 expired pending invitation reissue preserves identity and starts a fresh seven-day period |
| S14 | Invitation API: A03 S14 acceptance racing cancel/reissue has one serialized outcome and no stale capability; version/digest input case and stale cancel case |
| S15 | Team browser: S09 S11 S13 S15 S48 invitation validation, duplicate and reissue recovery; reload has roster metadata without raw link and explicit reissue |
| S16 | Invitation API: S16 inviter later revocation does not cancel a valid invitation |
| S17 | Access API: A05 minimal roster and invitation errors expose no tokens or Auth metadata; A01 S33 role/private-data matrix; minimal projection units |
| S18 | Join browser: S18 S44 S47 new account retains same-tab context through OTP and explicitly joins as manager; join units: S18 preview and accept are separate explicit server actions |
| S19 | Invitation API: S19 S20 S21 confirmed matching account alone receives preview and explicitly joins; join browser: S19 S45 wrong account denied then sign-out clears context and reopened link joins existing account |
| S20 | Invitation API: S20 unconfirmed matching email cannot preview or accept with issued JWT; S19 S20 S21 matching/wrong identity case |
| S21 | Team schema: S21 malformed or noncanonical token gives no capability; lifecycle denial API cases and units: S21 all invalid invitation responses are neutral and contain no private details |
| S22 | Invitation API: S22 expired capability denies without state changes; S22 controlled database clock accepts immediately before expiry and denies equality and after |
| S23 | Invitation API: S23 invitation that expires while queued cannot join after lock release |
| S24 | Invitation API: S24 twenty accepts create one membership and one invitation acceptance event |
| S25 | Invitation API: A03 S25 accepted retry cannot reset current role and S30 cannot reactivate; P03 accepted retry after role change leaves current row and events intact |
| S26 | Invitation API: S26 pending invitation cannot overwrite active same-practice role |
| S27 | Invitation API: S27 S28 two practice accept race has one winner and neutral unchanged loser; P03 other-practice denials preserve pending version/row/events |
| S28 | Same two-practice race: one active membership, pending losing invitation, no losing membership/event |
| S29 | Invitation API: S29 create versus accept race leaves only profiles with administrators; partial unique/admin constraints and P03 |
| S30 | Invitation API: A03 S25 accepted retry cannot reset current role and S30 cannot reactivate |
| S31 | Invitation API: A03 S31 invitation issued exactly at revocation is unavailable; A03 S31 S32 S40 only explicit post-revocation reissue reactivates durable membership |
| S32 | Same two-cycle durable ID/version/reissue case and P03; schema contract verifies reactivation update retains revoked_at |
| S33 | Access API: A01 S33 all roles and guessed foreign IDs deny unauthorized team writes and private data; role units/routes, direct grants and browser controls |
| S34 | Invitation API: S34 actual role update has actor and before/after audit, stale version cannot write; team browser role controls |
| S35 | Invitation API: S34 S35 role versioning and final administrator guard (pending administrator does not count); team browser: S34 S35 S38 administrator role controls prevent final-admin loss and revoke existing session |
| S36 | Invitation API: S36 simultaneous cross revocations retain an administrator and reject stale actor authority |
| S37 | Access API: S37 deferred invariant rejects last administrator loss and orphan creation; both deferred triggers catalog check |
| S38 | Access API: S38 public creator revocation removes existing JWT authority and preserves provenance and another practice; same-JWT role matrix, prepared creator regression and team browser revocation |
| S39 | Invitation API: S39 queued profile update rechecks authority after a committed demotion; team browser: S39 stale administrator settings retain edits after demotion and team route uses live role |
| S40 | Invitation API: A03 S31 S32 S40 only explicit post-revocation reissue reactivates durable membership |
| S41 | Invitation API: S41 access audit failure rolls back initial-membership/create/reissue/cancel/accept/role/revoke and retry commits once (7 executed cases) |
| S42 | Invitation API: S42 profile audit failure preserves profiles initial memberships and access events; legacy profile audit rollback case |
| S43 | Access/team/join/action units for auth/transport/malformed replies; legacy browser S24 interrupted Data API retains inputs and retry succeeds and S26 expires between open/save requires fresh authentication |
| S44 | Join browser: S18 S44 S47 same-tab OTP/reload; S44 another tab requires reopening the invitation; unit fragment capture and successful context clearing |
| S45 | Join browser: S19 S45 wrong account denied then sign-out clears context and reopened link joins existing account |
| S46 | Join browser: S46 S48 GET does not consume and mobile keyboard join has private headers and accessibility; attack browser A04 and exact allowlisted-destination units |
| S47 | Join/team browsers and route units for actual manager/viewer/admin controls; complete legacy settings-save/conflict/recovery browser cases |
| S48 | Join/team mobile keyboard/axe/no-overflow cases; field focus/pending disable/confirmation units; A05 artifacts; token-spec diagnostic policy and masked images |

### Properties and attacks

| SPEC ID | Witness and actual execution |
| --- | --- |
| P01 | Access properties P01 1000 seeded email variants agree with actual SQL canonicalization; seed 20261005, 490 valid/510 invalid; real canonical-email mutation killed |
| P02 | Team properties P02 1000 strict generated role/version objects accept legitimate values and reject forged authority; P01 P02 1000 generated canonical emails and opaque tokens retain exact identities; seed 20261005; strict-input source fault killed, generated token round trips and independent digest checks |
| P03 | Access properties P03 20 seeded real two-practice lifecycle sequences preserve state, versions and exact event counts; seed 20261005, 20 examples/304 operations; assertions after each committed step and denied/replayed steps; four secondary SQL property-only faults killed |
| P04 | Legacy profile properties P01 1000 seeded Unicode names agree with actual PostgreSQL writes (seed 20261003) and P03 20 generated actual API sequences preserve identity and monotonic version (seed 20261005; 27 updates/30 create retries); authenticated RPC/storage boundary preserved |
| A01 | Access API A01 S33 all roles and guessed foreign IDs deny unauthorized team writes and private data |
| A02 | Access API A02 forged metadata and RPC actor fields never elevate verified staff; exact hostile destination/action units and inherited forged-cookie browser |
| A03 | Five executed Invitation API attacks: cancel race, reissue race, exact revocation equality, accepted-role/revoked replay and two-cycle explicit reissue/rejoin |
| A04 | Attack browser A04 markup invitation preview is text and foreign-Origin action cannot write; exact destination unit and GET/markup browser cases |
| A05 | Access API A05 minimal roster and invitation errors expose no tokens or Auth metadata; attack browser A05 fragment token stays out of request URLs referrers and retained text artifacts |

The persisted adversarial harness rejects empty, missing, duplicate, skipped, retried or stale inventories. Its separate RED sensitivity stage verified one failed strict-object property and all nine failed named browser assertions with actual faults, then restored source/schema and reran the same cases green. Those fault runs do not replace the positive attack inventory.

### Must NOT invariants

| ID | Passed witness |
| --- | --- |
| N01 | S33/S38/A01/A02; isolation/live-role/creator-fallback/post-lock SQL faults; actual public creator revoke using the same JWT |
| N02 | S01–S06/S28/S29/S35–S37/P03; partial active-user uniqueness, 9 restrict FKs, immutable practice relationship, both deferred administrator triggers; live races/storage negative controls |
| N03 | S25/S26/S30–S32/A03/P03; epoch, accepted-role replay and expiry faults |
| N04 | Digest-only schema; minimal projections/private-schema denial; A05 browser/API; masked token fields and retained-text control |
| N05 | All direct ordinary DML/grants/trigger EXECUTE denial tests; original profile/audit contract; real FK/grant controls and direct-DML faults |
| N06 | S07/S47/P04 and inherited profile API/unit/browser/SQL assertions; only approved direct-DML/creator uniqueness boundary adaptations |
| N07 | Fixed local ports/project/fixture guards and known-bad controls; upgrade rollback; independent schema/source restore checks; unrelated cliniq stack untouched |
| N08 | Reviewed implementation/capability/schema/dependency diff; copied-link workflow and existing local OTP; no hosted deployment, invitation sender, SMS/register/switcher/deletion implementation or external messages |
| N09 | No direct dependency change; application uses authenticated client, configured public values, crypto/clipboard/tab storage; capability/supply-chain/history/static-asset gates |
| N10 | Exact approval/revision record, preserved prior assertions, strengthened timing/fixture helpers, exact layer/case/fault inventories; final clean-source run and restored hash |
| N11 | Attached managed worktree/branch; source checkpoints 461e507, 0fee480, eea83e9; main remains clean at documentation checkpoint defdc87; no remote push/merge |

### Plan acceptance criteria

| Plan AC | Passed SPEC witnesses |
| --- | --- |
| AC1 | S01–S04, S41/S42 and upgrade/backfill/rollback |
| AC2 | S08–S17, strict input/schema/token properties |
| AC3 | S18–S20, S44/S45, real new/existing-account OTP and explicit accept |
| AC4 | S12–S14, S20–S23/S27, expiry equality/post-lock clock and neutral denials |
| AC5 | S24–S26/S30, 20-way acceptance, current-role retry/no duplication |
| AC6 | S09/S17/S33/S38, A01/A02, UI/actions/API/grants/live role matrix |
| AC7 | S25/S30–S32/S38/S39, epoch and same-JWT creator/member revocation |
| AC8 | S34–S37/S40, optimistic versions/deferred invariant/cross-revoke race |
| AC9 | S04–S06/S27–S29/P03, shared actor serialization and uniqueness |
| AC10 | S41–S43, atomic audit failures, once-only retries, preserved form inputs |
| AC11 | S44–S48, labels/controls/keyboard/mobile/axe/context/artifacts |
| AC12 | S07/S47/P04, complete inherited profile/auth/validation/version/recovery suites |

## SQL statement, predicate, constraint and grant coverage

This is a concrete mapping, not a claimed dynamic SQL line/branch percentage. No changed migration is unlisted. SQLFluff plus real PostgreSQL execution covers dialect/definition validity; catalog fingerprints verify exact definitions and grants, and named behavior/fault tests cover the paths below.

| Changed SQL family/symbol | Positive, denial and restoration evidence |
| --- | --- |
| Membership table/state/role/version/revocation checks and indexes | S01/S03/S04/S33/S37/P03; active-user storage test; exact columns/constraint/index catalog; uniqueness and missing-index controls |
| Access events/FKs/indexes/RLS/revokes | Backfill S01, S41/P03 exact counts/before-after fields; 9 restrict FKs, missing-FK/index controls; private table/trigger denial |
| Backfill/drop creator uniqueness/new member authority | Upgrade S01/S02/S03; S06/S38 public revoke/new creation; creator-fallback/isolation faults; historical profile migration unchanged |
| current_practice_id, memberships_self, practices_select | Administrator/manager/viewer/revoked/nonmember/anonymous matrix, same-JWT reads, own-role projection; isolation/creator-fallback faults |
| require_administrator, create_practice, update_practice | S04/S05/S06/S07/S33/S38/S39; confirmed actor, 20-way retry, explicit expected version and post-lock role; live-role/user-lock/practice-lock/profile-version faults |
| ensure_administrator and both deferred triggers | S35/S36/S37, storage rollback and no-orphan race; last-admin domain/storage faults and missing-trigger controls |
| audit_membership insert/role/revoke/reactivation branches | S01/S34/S41/P03/S32; correct actor/old/new fields, exact event counts, seven rollback/retry cases; membership-audit fault and property-only repeat |
| canonical_invitation_email and invitation table/constraints/FKs/indexes | P01 app/SQL parity, S08/S09/S11, SQL grants/raw-column checks, exact catalog; canonicalization/duplicate/digest/version input tests and missing-FK/index controls |
| invitation_projection and list_practice_team | S17/A01/A05; minimal authorized roster, wrong role/foreign IDs/private denial; both private projection faults |
| create_practice_invitation and mutate_invitation | S08–S16: positive create, duplicate, cancel retry, pending/expired reissue, stale/race/invalid versions/digests, later inviter revoke; reissue-period/version/fresh-digest and invitation-audit faults |
| invitation_for_actor and preview_practice_invitation | S19–S23/S25/S30–S32; confirmed matching identity, invalid digest, unknown/canceled/expired/accepted/pre-revocation states, equality; matching/confirmed/expiry/equality/transaction-start/epoch/incorrect-inviter-eligibility faults |
| accept_practice_invitation | S18/S19/S24–S32/P03; user then practice serialization, one-active-practice check, pending insert/retained-ID reactivation, current-role no-op and neutral foreign-practice result; role replay/epoch/audit/property faults |
| mutate_member and role/revoke adapters | S09/S33–S40; valid and invalid version/role, revoked retry, stale conflict, final-admin denial, same-role no-op in properties, real revoke/demotion and queued actor loss; member-version/live-authority/admin/audit faults |
| audit_invitation insert/reissue/cancel/accept branches | S08/S11–S16/S24/S41/P03 exact events and actor attribution; access-event failure rollback and invitation-audit/property faults |
| Every public invoker/private definer wrapper, empty search_path and EXECUTE/revoke | Exact function/ACL catalog, pgTAP public-invoker/internal-helper/anonymous/trigger denial, real authenticated API positives/denials; grant/projection/direct-DML controls |

## Review and limits

Reviewed the complete branch diff against defdc87, including earlier Phase 1 changes and final additions; git diff --check passed. Existing assertions were preserved except the SPEC-authorized direct-DML/creator-uniqueness boundary changes. Recovery fixture changed from revoking an already-denied profile grant to a real before-update failure trigger. Unit focus waits for the same required focus outcome; URL fixture construction keeps the same fragment behavior and strict artifact checker.

Automation performed keyboard/axe/no-overflow/private-header checks. Separately, the agent visually inspected final 375px team and joined-manager images: content fits, long fixture emails wrap, controls remain readable, the invitation input is masked, and the joined manager sees the read-only shared profile. User visual sign-off is not claimed. Independent finished-implementation verification is not performed, zero rounds; the earlier planning review cannot count as that protocol.

The scope is the pinned local macOS/Chromium/PostgreSQL fixture stack, not hosted email/deployment, regulations, full provider-specific email/Unicode semantics, browser-process restart, retention/deletion or a capacity/SLA claim. Artifact inspection detects the tested generated tokens and concrete fragment links in retained text; masked rasters and disabled traces are verified through configuration/visual checks, not exhaustive binary forensics. Capability scanning is a spelling inventory, not a complete transitive proof. Checker controls prove their named failure paths, not universal checker correctness. All application executable-line claims are the existing mapped statement-start gate; 85.29% branch coverage is reported separately, not called 100%.

The resulting attached checkout is /Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar on codex/e1-s2-staff-access. The source commit is eea83e9dc4adc8d9303a22e4f2a8c18980032ed2. Documentation-only updates after that source commit preserve its hash and are checked separately for formatting/diff consistency. No application work remains for the approved E1-S2 scope.
