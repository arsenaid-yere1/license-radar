# E2-S2 implementation evidence

Date: 2026-10-06. Status: implementation complete; all 31 source-bound automated layers passed.
Branch: `codex/e2-s2-authoritative-dates`. Baseline: `93f058bdd31f0a9cbbcdebb8b397a90c6708a478`.
Specification: `thoughts/shared/plans/2026-10-06-e2-s2-old-coder-spec.md`.
Plan: `thoughts/shared/plans/2026-10-06-e2-s2-authoritative-dates.md`.

## Review boundary

The user authorized “add specs and implement it.” Separate SPEC approval was **not obtained (autonomous run)**. Earlier independent plan verification is not independent implementation verification. This evidence reflects automated execution and agent inspection; independent fresh-context implementation review and user manual acceptance have not been performed. No production migration/deployment or remote push was requested or performed.

## Red and contract revisions

The specification was checkpointed as `8fde103` before implementation. Existing register domain/action baseline: 3 files, 12 tests passed. The first new database collection had a test syntax error; this was corrected and is not counted as behavioral RED. Subsequently all 9 date API scenarios failed on the missing detailed RPC (`PGRST202`) before the migration existed, recorded in `/tmp/license-radar-dates-red.json`.

After explicit executable contract additions, the domain/action run had 8 failures and 8 passes (`/tmp/license-radar-domain-red.json`): strict date recognition, nullable field normalization, coherent cycle projection, canonical new RPC binding, and new safe success text. The date helper initially returned false/empty/NULL as an intentional spec skeleton. Before UI implementation the form run had 3 failures and 8 passes (`/tmp/license-radar-ui-red.json`): absent type-specific fields, retained/frozen date recovery, and saved-date presentation.

Existing assertions changed only for the agreed contract: credential input canonicalization adds four nullable fields; detailed reads require metadata/current-cycle fields; the application calls the new detailed RPC; success is “Record saved.”; list expectations include unknown cycles while legacy create results remain exactly eight fields. Register snapshots now include all six tables. A pre-existing focus assertion now waits for the effect rather than racing it. New text queries compare complete paragraph text across semantic `time` children. Revocation/browser fixtures supply the required timestamp and reset both local auth send timestamps; these are fixture corrections, not relaxed product assertions.

Implementation failures were repaired in implementation: an invalid SQL local-variable qualification caused a missing-FROM error; locals now have unambiguous names. SQLFluff changes were formatting only. A dropped cycle-number CHECK also causes the later uniqueness witness to fail after a test update persists; the fault inventory explicitly expects both exact failures. The missing initialization-trigger control executes the exact ten metadata assertions (before detailed fixture creation); separate API mutants exercise actual missing-cycle failure.

## Implementation witnesses

- `supabase/migrations/20261006225257_credential_dates.sql`: additive metadata/CHECKs, initial cycles/backfill/trigger/RLS, strict SQL parser, detailed projection and atomic detailed create. Original seven-argument create, original projection, receipt replay and finish helper are untouched.
- `src/lib/register/dates.ts:isCredentialDate/formatCredentialDate/trackingDate`: strict calendar text, timezone-independent display, explicit purpose. `schema.ts` normalizes nullable input and requires coherent cycle reads. `repository.ts` binds authoritative detailed values and allowlists database field errors.
- `credential-form.tsx:CredentialFields` and `register-panel.tsx:RecordDates`: type-specific free-text metadata, optional dates, explicit unknowns, independently visible earlier action deadlines, deterministic `time` markup. Existing request-key/frozen-payload recovery remains shared through `CreateForm`.
- `tests/integration/practice-credential-dates.test.ts`: D01–D10/A01/D15 real creation/date/metadata boundaries, concurrency, caller scope, failures at each write, post-lock authority, legacy compatibility, isolation and missing-cycle outage. Existing `practice-register.test.ts` remains a legacy API regression suite.
- `src/lib/register/dates.test.ts`: D03/D02/D04/D06/D11, P03 independent 3,000-case UTC calendar oracle and P04 1,000 ordered/unknown/metadata cases. Existing register properties retain 1,000-case name/ownership witnesses. These cover SPEC P01/P02; scenario labels are cross-referenced by behavior rather than assumed numerically identical.
- `tests/unit/register-{operations,actions,forms}.test.*`: exact argument/error/projection boundaries, forged/duplicate/file fields, type reset/owner preservation, draft/error linkage, frozen retry, success reset, saved/unknown purposes and private-data stripping.
- `tests/e2e/practice-credential-dates.spec.ts`: D16 persistence/timezones/mobile keyboard/Axe, D17 validation/type reset/cycle failure/retry/missing cycle, D18 viewer/stale manager and revoked creates, D19 real foreign-Origin detailed POST. `practice-register.spec.ts:G24` now loses a real post-commit response containing metadata/dates and compares all six tables after exact retry. These cover SPEC D12–D15/A03.
- `tools/credential-dates-upgrade.mjs`: SPEC D16 populated original-column/twelve-table preservation, full catalog rollback, unknown cycle backfill, every historical receipt replay, legacy creates, detailed audit/receipt and fresh replay.
- `tools/gauntlet-controls.test.mjs`: SPEC D17 now imports the real `assertSchema`, passes an identical-schema positive witness, and rejects removal with the exact comparator error. Cycle table/projection/parser/RPC/trigger are included; checker sensitivity disables both catalog and comparator to prove failures. FK controls now compare all nine restored catalog sections.

## Completed narrow checks

Pinned runtime: Node 24.21.0/npm 11.19.0; installed Supabase 2.119.0/PostgreSQL 17.11, existing tools and caches, no new dependencies. Official Supabase changelog/function and PostgreSQL date documentation were reviewed; no unrelated runtime/tool upgrade was introduced.

- `npm run db:reset`: additive migration replay passed on the guarded local fixture stack.
- `npm run test:integration -- tests/integration/practice-credential-dates.test.ts tests/integration/practice-register.test.ts`: 23 tests passed.
- `npm run test:db`: 116 SQL assertions, 56 applied missing-protection faults caught and rolled back. The new TAP file has exactly 22 assertions.
- `node tools/credential-dates-upgrade.mjs`: passed. Two practices; 14 historical credentials, 4 clinicians, 4 coverage links, 18 creation receipts and audits; all 12 populated historical tables preserved. Exactly 14 unknown cycles; all historical receipts replayed exactly; rollback/fresh replay catalog matched.
- `node tools/check-generated-types.mjs`: generated public types matched.
- `node tools/schema-fingerprint.mjs record`: reviewed new table across seven filtered public sections and new functions/trigger/grants; recorded all nine sections.
- `npm run test:controls`: 35 positive/negative checker tests passed.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`: passed; 27 unit files/215 tests at this checkpoint.
- `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests`: passed.
- `npm run build`: production-local build passed.

## Final source-bound run

Candidate source checkpoint: `411ab8dc0cf4fbe7ecea2e378a4449e2361a2838`; source hash `00cde850b87a2264c774ab1ca7c3c174090e467737ed73546a2e8d8ac58664ab`, 174 tracked non-thought source inputs. `6ac01d5` holds implementation/specs, followed by the authorization-first correction. The actual `sourceState()` function verified a clean tree; no gate was bypassed.

Pre-final narrow mutation runs reached 100%, reproduced by the final fresh run below. Earlier runs failed at 97.34% (missing complete month/message assertions plus equivalent lexical/month guards) and 99.69% (the two equivalent month checks). The specs now assert all twelve month displays and exact field messages. The date parser uses an absolute-end lookahead instead of redundant length/anchor checks; invalid month numbers yield an undefined month limit and fail the day comparison. The 100% thresholds/configured scopes remain unchanged.

The initial SQL fault run did not count missing audit data as a kill because the test dereferenced an absent row and raised a TypeError. It now compares the full audit row set, requiring a behavioral AssertionError. The repeated narrow run killed/restored **70** actual SQL faults and then passed all **86** integration tests. Final review added a 71st fault removing the detailed entry's checked authorization call and an invalid-payload authority witness; the final run applied, executed, killed and independently restored all **71**, then passed the full **86** integration tests again. Metadata normalization now follows the live lock/authority check. All fixture schema bodies were restored and re-recorded after replay.

The first online dependency-check request was rejected by automatic approval review for unapproved package-metadata egress. The user was asked for authorization; no user answer was assumed. Before retrying, local inspection proved that the OSV packet contains only 16 public PyPI tool names/versions already pinned in `tools/toolchain.json` / `tools/python-constraints.txt`; every one of the 776 non-root lockfile packages resolves from the public npm registry; installed npm `audit-report.js:shouldAudit` explicitly excludes the private root project. The same action was resubmitted with that concrete low-risk evidence, and automatic review approved it. No workaround endpoint or indirect execution was used. The online check then passed: zero runtime advisories, five previously classified development findings, 649 license records, and zero Python advisories. No source, practice records, credentials, or private package names entered the payload.

A temporary runner at `/tmp/license-radar-local-checks.mjs` had started the 30 unaffected layer commands while the dependency check was blocked. It preserved the 31-entry repository inventories and explicitly marked the online layer pending. After approval, this temporary run was stopped during isolated property mutation, before any SQL fault layer. The first guarded stop found that the source-only stage had advanced; the second guard handled that stage and stopped the identified runner/children. No database fault was interrupted. This partial run is **not** claimed as a full verification result.

The actual unchanged full command `npm run gauntlet` passed all **31** required layers against the clean candidate source. Run ID: `d474a1b4-2df3-4aef-83e7-49192e87ce3c`. Started: `2026-10-06T23:26:28.476Z`; finished: `2026-10-06T23:45:19.298Z`. Source commit/hash are recorded above. `reports/gauntlet.json` and the per-layer logs are the authoritative result. Every layer exited 0, both exact inventories matched, and the final source hash matched after all fault restoration. No source/dependency gate was weakened. The final fresh counts appear below; earlier narrow checks are retained only as implementation history.

## Remaining boundaries

Existing credentials receive no invented dates; filling them/editing/archiving is E2-S3. Calendar, successor cycles, phone/SMS jobs, catch-up and scheduling remain future stories. All destructive fixture resets/faults were restricted to the exact loopback project with fixture-only accounts. Hosted E2-S1 pilot state remains unchanged.

## Complete specification mapping

Scenario numbers in the browser/domain test titles predate the final SPEC numbering; this table names the actual witnesses instead of treating matching numbers as proof.

| SPEC behavior | Executable witness |
| --- | --- |
| D01 type/owner creation | `practice-credential-dates.test.ts` “D01 D02 all types and owners”; exact final audit snapshot and one-cycle comparisons. |
| D02 unknown/action-only | Same API test; `dates.test.ts` “D02 D04”; browser “D16 all type-specific dates”; form “D13 every date purpose”. |
| D03 strict real dates | API “D03 D04”; domain “D03 exact Gregorian” / “D03 deterministic display”; SQL date CHECK assertions; browser D16 years 1/9999 and timezone witnesses. |
| D04 ordering | API/domain D03/D04; browser “D17 date validation”; applied SQL ordering fault. |
| D05 metadata/ownership | API “D05 metadata bounds”; domain “D02 D04” and exact messages; inherited register ownership/property tests. |
| D06 exact retry/conflict | API “D06 shared policy concurrent retry”; exact canonical argument unit assertions; browser inherited G24 post-commit response loss and six-table equality. |
| D07 atomic failures | API “D07 every detailed creation write failure”; browser D17 cycle-update failure/restored retry; applied audit/receipt/cycle SQL faults. |
| D08 live authority/lock | API “D08 valid detailed request waits”; browser “D18 viewer reads”; applied post-lock authority, lock, and checked-entry faults. |
| D09 legacy compatibility | API “D09 legacy create and replay”; full inherited `practice-register.test.ts`; populated upgrade receipt replay and old eight-field results. |
| D10 schema protections | API “A01 D10 cycles”; 22 new SQL assertions; applied missing FK, grant, CHECK, uniqueness and trigger controls. |
| D11 domain/action boundary | Register operations G16/G17 and D06/D14; actions G18/D14; domain “D06 projections”; malformed/forged/duplicate/file assertions. |
| D12 form recovery | Forms “D11 type switches” / “D12 uncertain detailed save”; browser D17 validation/type reset/owner preservation; exact frozen/reset payload assertions. |
| D13 uncertain detailed save | Browser `practice-register.spec.ts` G24 loses the actual committed detailed response, retries, and compares all six row sets; date form D12 freezes every detailed value. |
| D14 persistence/access/display | Browser D16 reload/sign-in/timezone/mobile/Axe/keyboard and D18 viewer; forms “D13 every date purpose”. |
| D15 read fault | API “D15 missing cycle”; browser D17 actual missing-cycle outage/restoration; unit malformed-cycle availability checks and inherited list outage. |
| D16 populated upgrade | `tools/credential-dates-upgrade.mjs`: full 12-table baseline, catalog rollback, original-column/history preservation, exact legacy replay, one unknown cycle, fresh replay equality. |
| D17 checker soundness | 35 checker controls; real identical-schema comparator witness; checker-sensitivity disables comparator and removes cycle catalog inclusion; restored nine-section fingerprints. |
| P01 independent calendar | `dates.test.ts` P03: 3,000 generated UTC-oracle cases, invalid adjacent boundaries and canonical preservation; property-only mutation. |
| P02 independent effective date/metadata | `dates.test.ts` P04: 1,000 generated cases including unknown/known/order and text bounds; property-only mutation. |
| A01 tenant/role attacks | API A01/D10, revoked/demoted queued D08, browser D18, SQL direct DML/helper grants, inherited `access-adversarial` layer. |
| A02 hostile form/API | Strict input schema/operations/actions tests, API malformed date/Unicode/coverage/authority cases; forms “A02 markup names are text”; field-message allowlist. |
| A03 origin/network | Browser D19 real foreign-Origin detailed POST has no writes; inherited G24 actual post-commit lost response with exact retry. |

| SPEC invariant | Evidence and limits |
| --- | --- |
| N01 unchanged original API/history | Complete migration/diff inspection; legacy API and populated upgrade exact payload/result/audit/receipt comparisons. |
| N02 no guesses/fan-out | NULL metadata/date backfill and one-cycle cardinality checks; API/UI unknown/shared-policy tests. |
| N03 future workflows absent | Migration/routes/domain/UI diff inspection plus capability inventory. This is an agent scope inspection, not a proof that every possible future feature is absent. |
| N04 no posted/stale authority/direct writes | Strict forged-field tests, post-lock role checks, tenant RLS/grant/constraint and applied fault witnesses. |
| N05 no partial/duplicate creation | API six-table rollback/retry/concurrency snapshots; real browser uncertain response equality. |
| N06 inherited behavior retained | Every inherited layer stays enumerated; all practice/access/recipient/register upgrades and unit/SQL/API/browser suites execute. |
| N07 dependencies/secrets/storage/capabilities | No dependency manifest/lockfile additions; final supply-chain, capabilities, history/assets secret scans, and source diff. Capability checks cover the repository's declared syntactic rules; they do not establish semantic absence of all capabilities. |
| N08 local work only | Exact fixture project/loopback/account guards; local branch/checkpoints. No hosted migration/deployment, remote push, or merge command was executed. |
| N09 trustworthy gates/evidence | Both 31-layer inventories, clean source/hash identity, actual applied fault/control counts, independent property mutation and restored schema; final result below must come from the actual complete gauntlet. |

The failure-model rows are covered respectively by D03/P01/D14, D02/D16, D04/P02, D01/D06, D07, D06/D09/D13/D16, D08/D10/A01, D16, and D17. No generic coverage/mutation result is substituted for the concrete race, rollback, compatibility, tenant, or calendar witnesses.

## Final fresh gauntlet results

Reproduce from this checkout with the pinned runtime (`export PATH="$PWD/.tools/node/bin:$PATH"`), the guarded local fixture stack and existing tool prerequisites, then `npm run gauntlet`. All commands below are persisted in `tools/layers.json` and run by `tools/gauntlet.mjs`; none was skipped. Reports are regenerated under ignored `reports/` and `coverage/`.

| Layer | Command | Actual fresh result (exit 0) |
| --- | --- | --- |
| checker-controls | `npm run test:controls` | 35 checker controls passed. |
| checker-sensitivity | `node tools/checker-sensitivity.mjs` | 23 applied checker faults caught/restored; 5 UI faults caught/restored. |
| types | `npm run typecheck` | Type checking passed. |
| lint | `npm run lint` | Passed with zero warnings. |
| format | `npm run format:check` | Repository formatting passed. |
| sql-lint | `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests` | All migrations and SQL tests passed. |
| access-upgrade | `node tools/access-upgrade.mjs` | Populated access upgrade/rollback and replay passed. |
| recipient-upgrade | `node tools/recipient-upgrade.mjs` | Populated recipient upgrade/rollback and replay passed. |
| register-upgrade | `node tools/register-upgrade.mjs` | Populated register upgrade/rollback and replay passed. |
| credential-dates-upgrade | `node tools/credential-dates-upgrade.mjs` | 12 historical tables preserved; 14 exact unknown cycles; legacy replay/rollback/fresh schema passed. |
| replay | `npm run db:reset` | Complete local migration reset/replay passed. |
| schema | `node tools/schema-fingerprint.mjs` | All 9 catalog sections matched. |
| database | `npm run test:db` | 116 assertions; 56 applied missing-protection faults caught and rolled back. |
| integration | `npm run test:integration` | 8 files, 86 tests passed. |
| unit-coverage | `npm run test:coverage` | 27 files, 217 tests passed; raw unit lines 692/722 (95.84%). |
| mutation | `npm run mutation` | 26 files; 1,262 mutants: 628 killed, 634 compile errors; score 100%. |
| mutation-properties | `npm run mutation:properties` | 6 files; 354 mutants: 246 killed, 108 compile errors; score 100%. |
| sql-mutants | `node tools/sql-mutants.mjs` | 71 actual faults applied/executed/killed/restored; restored full integration 86/86 passed. |
| schema-restored | `node tools/schema-fingerprint.mjs` | All 9 catalog sections matched after SQL faults. |
| generated-types | `node tools/check-generated-types.mjs` | Generated public types matched the restored schema. |
| build | `npm run build` | Production-local Next.js build passed. |
| browser | `npm run test:e2e` | 32 passed; zero skipped, unexpected or flaky results. |
| access-adversarial | `node tools/access-adversarial.mjs` | 8 API + 2 browser attacks passed; 2 real sensitivity faults caught/restored; all 9 selected browser cases passed again. |
| coverage | `node tools/check-coverage.mjs` | 722/722 executable lines, 55 files; 693 browser and 465 Node mappings. Branches 1,220/1,394 (87.51%). |
| suite-health-unit | `npm run test -- --sequence.seed=20261017` | 217 tests passed with seed 20261017. |
| suite-health-integration | `npm run test:integration -- --sequence.seed=20261017` | 86 tests passed with seed 20261017. |
| suite-health-browser | `node tools/shuffle-browser.mjs` | All 32 discovered cases passed in shuffled order/fresh contexts; seed 20261017. |
| capabilities | `node tools/check-capabilities.mjs` | Declared syntactic capability/authorization inspection passed; no semantic completeness claim. |
| supply-chain | `node tools/supply-chain.mjs` | 0 runtime advisories; 5 classified development findings; 649 licenses; 16 Python packages, 0 advisories. |
| secrets-history | `.tools/gitleaks git . --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/secrets-history.json` | 0 findings in Git history. |
| secrets-assets | `.tools/gitleaks dir .next/static --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/secrets-assets.json` | 0 findings in built browser assets. |

Both mutation runs have zero survivors, no-coverage mutants or timeouts. Compile-error mutants are reported separately from behavioral kills. The inherited gate requires complete executable-line coverage, not complete branch coverage; the 87.51% merged branch result is disclosed, not presented as 100%. Coverage and mutation establish the configured constraints, not exhaustive correctness.

## Agent inspection and manual acceptance

Agent inspection reviewed the baseline-to-final diff, the complete additive migration and authorization ordering, strict parsers, legacy payload/result boundaries, atomic write/audit/receipt order, and scoped form/list changes. `git diff --check` passed. Desktop (1440px) and mobile (375px) screenshots from the fresh browser run were viewed: optional fields, unknown end dates, every tracking purpose, early/late years and inactive-reminder text were visible; tracking text wraps naturally on mobile. Screenshots are `reports/credential-dates-desktop.png` and `reports/credential-dates-mobile.png`. Keyboard/Axe/overflow, persistence, real validation/failures, viewer and uncertain-response states are separately automated browser witnesses. This is agent inspection, not user-confirmed manual acceptance.

Plan acceptance mapping: AC1 → D01/D05; AC2 → D11/type-specific label assertions; AC3 → D03/P01; AC4 → D04/P02/display tests; AC5 → D02; AC6 → P02/D14/numeric text formatting; AC7 → D01/D06; AC8 → D06/D07/D13; AC9 → D08/D10/A01; AC10 → D12/D13/D14; AC11 → D09/D16; AC12 → D14/D15. The browser timezone witnesses change browser zones; practice timezone independence also follows from the date-only stored values and formatter accepting no timezone parameter. No separate manual practice-timezone-change acceptance was performed.

All four implementation phases have completed automated verification. Separate SPEC approval: **not obtained (autonomous run)**. Independent fresh-context implementation review: **not performed**. User manual acceptance: **pending**. No required executable layer was skipped. No dependency/tool upgrade, hosted migration/deployment, remote push or merge was performed. Final documentation updates are confined to `thoughts/`, which the repository source identity explicitly excludes; they do not change the 174 tested source inputs.

Documentation finalization: `npm run format:check` and `git diff --check` passed; `.tools/gitleaks dir thoughts --redact --no-banner --ignore-gitleaks-allow --report-format json --report-path reports/final-documentation-secrets.json` found zero leaks. The repository formatter intentionally excludes `thoughts/`; the Markdown diff was inspected separately. The actual `sourceState()` comparison confirmed the unchanged tested hash after documentation updates.

## Subsequent production release

The later explicit **“push to prod”** request authorized a separate release of the exact tested archive. It is live, with historical-data preservation, the new unknown cycle, schema/advisor checks and hosted anonymous smoke evidence in `thoughts/shared/handoffs/2026-10-06-e2-s2-production-release.md`. Final release documentation also updates README hosted status; README participates in the whole-source hash, so that documentation checkpoint has a different whole-source hash. Runtime code, dependencies, migrations and verification scripts remain identical to the tested/promoted archive. The 31-layer results above identify that exact source, not a new runtime test run after the README correction. User manual acceptance and independent implementation verification remain unconfirmed.
