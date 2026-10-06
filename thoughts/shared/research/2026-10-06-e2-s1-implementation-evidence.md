# E2-S1 implementation evidence — final verification pending

Date: 2026-10-06 (America/Los_Angeles).
SPEC: `thoughts/shared/plans/2026-10-06-e2-s1-old-coder-spec.md`.
Plan: `thoughts/shared/plans/2026-10-06-e2-s1-register-ownership.md`.
Baseline: `fc337c1224d18987896f311d45127059aed41f2a`.
Isolation: local branch `codex/e2-s1-register`, existing checkout with pinned ignored dependencies/runtime and fixture environment files.
Tier: 3. Spec approval: **not obtained (autonomous run)** under “create specs then implement it.” Independent fresh-context verification: **not performed**. User acceptance: **not obtained**. These reduce independent assurance; main-agent review does not replace either.

## Delivered scope

Clinicians remain separate from authorized staff. The three supported renewal types can belong to a clinician or practice; practice malpractice can cover several clinicians through one credential identity. All active members read; administrators/managers create. The immutable caller-scoped request receipt, entity/coverage, and private actor/time audit are transactional. The UI preserves uncertain submissions for exact-key retries, shows date entry pending, and says texts are inactive.

No deployment, hosted migration/reset, remote push/merge, external messages, new dependency, date/cycle/calendar/job/provider send, editing/archive, or duplicate detection is included. Existing E1-S3 production remains unchanged. The next story is E2-S2.

## Initial RED and verification repairs

Before the implementation, two database contracts failed against safe empty RPC placeholders: `G01 empty register is real`, `G02 clinician is not a staff account`. All nine initial domain/property/action tests and all five initial form tests failed against placeholders, each observed as a behavioral assertion or a property/parser failure rather than a missing import. The ignored reports were `reports/register-red-{database,domain,ui}.json`; final gauntlet clears those intermediate reports.

Other database tests were added before the real migration and verified with applied database faults and restrictive-constraint controls. Do not interpret the two initial database RED assertions as an initial RED for every SQL scenario. The final fault inventory is the reproducible sensitivity evidence for those defenses.

- The first form test checked an input's own disabled property. It was corrected to effective `:disabled`, which includes a disabled fieldset, retaining the blocked-interaction assertion.
- Browser feedback locators were scoped to application paragraph alerts because Next.js adds a distinct route announcer. Retry comparison extracts every submitted FormData field, excluding React's previous feedback-state argument, which legitimately changes.
- The upgrade runner needed `to_jsonb` for the historical composite profile RPC before checking version. No old RPC or production contract changed.
- Property mutation exposed missing explicit 120-codepoint and valid-shape/ineligible-coverage assertions. They were added; thresholds were retained.
- A malformed discriminator constructor mutant was reported as surviving with **zero completed tests** by the mutation runner. Moving construction into `z.lazy` keeps invalid construction inside the parse/test boundary; the property gate then reached 100%. This is a checker limitation discovered and addressed, not a semantically equivalent mutation exclusion.
- An INSERT-only lock witness passed after removing the explicit lock because FK checking also waits on the practice. G15 now additionally queues a read, which has no insertion/FK wait, and requires its observed lock before releasing the practice. G14 independently checks queued demotion/revocation. The product contract stayed unchanged; the fault detection was strengthened.
- SQLFluff's existing approved-contract keyword exception now includes `type`, matching the new public credential field. No behavioral, coverage, or mutation gate was weakened.
- Coverage investigation found source-map dot-segment identities were assigning other functions to the first bundled source. The checker resolves identities before browser/Node conversion. Synthetic source-identity and uncalled-function attribution cases were observed RED and then GREEN; removing normalization makes the attribution control fail.
- Correct attribution also revealed mixed coverage granularity: raw V8 conversion marks physical formatting/closing lines, while Vitest's AST mapping inventories executable statement lines. The gate now requires complete coverage on every owned executable statement line in that inventory, combines all three execution sources, and rejects missing/incomplete input. Its synthetic control rejects an uncalled statement while accepting unexecuted formatting continuations; forcing all counts to one fails that control. The inventory must be copied before Istanbul merge, which otherwise mutates it. This corrects measurement without lowering its 100% executable-line threshold or excluding any owned file.
- The corrected gate exposed actual policy-deselection, clipboard-feedback, and administrator-demotion-cancellation gaps. Focused tests assert remaining coverage IDs, exact copied links/fallback text, and denied/confirmed submissions with original target version. The latter two protect unchanged inherited behavior. `tools/ui-coverage-sensitivity.mjs` applies three real source faults and requires named assertion failures, exact restoration, and GREEN reruns.
- A multi-command preflight accidentally let later commands use the machine's default Node. The affected build/browser run was repeated with `export PATH="$PWD/.tools/node/bin:$PATH"` and confirmed Node 24.21.0. The unpinned run is not final evidence.
- Source-bound run `95176e1b-679c-4f31-a299-b880b5a87a61` at checkpoint `42dedff2b4faac85b9c85432d9ae4f131a337ccf` passed its first 20 layers and stopped at browser A05: `reports/ui-coverage-sensitivity.json` retained a raw deliberate clipboard-fault diagnostic containing a fixture invitation link. All four register browser scenarios passed, but the whole browser gate correctly failed. `mutationFailureEvidence` now records assertion classifications with the named fault, exit status, and restoration evidence, without raw messages/DOM. A new retained-artifact control was observed RED against raw-message retention and GREEN against classification; all three actual UI faults still failed their named assertions and passed after exact restoration. All 34 checker controls passed. The artifact rejection rule and behavioral-failure requirements were not relaxed. A complete fresh run is required after this repair.
- Run `321fe9b6-1225-49b0-9944-df3436cf8236` at checkpoint `85504ea63553b1f2a0aacd99452223252b738ff2` passed 12 layers, then failed inherited integration S23: the queued invitation joined despite the test's expected expiry. The local catalog still matched exactly. The test had waited on the host timer without observing database expiry. It now requires the blocked RPC transaction to have started before expiry, then observes `clock_timestamp() >= expires_at` in PostgreSQL before releasing the lock, with a bounded wait. The named test passed; applying the actual `transaction_timestamp()` fault made that same assertion fail, exact function restoration was verified, and the restored test passed. Application SQL and expiry behavior were not changed. The fresh full run must also execute the inherited SQL fault and shuffled integration gates.

## Acceptance and specification mapping

Scenario IDs below refer to the SPEC; several test-title prefixes are grouped differently. The file and named behavior identify the actual witness.

| SPEC | Plan | Concrete executable witness / source |
| --- | --- | --- |
| G01 | AC5/AC9 | `tests/integration/practice-register.test.ts` empty register; `getRegister` distinguishes unavailable projections. |
| G02 | AC1 | Integration clinician-not-staff snapshots; `public.clinicians` and `private.create_practice_clinician`. |
| G03–G04 | AC2 | Integration all-types/both-owners/several-records; `credentials_owner_shape`. |
| G05–G06 | AC3 | Integration shared-policy/zero/ineligible coverage; `private.credential_projection`; browser shared policy appears once. |
| G07–G08 | AC4/AC6 | Integration foreign/missing/duplicate/NULL/multidimensional references; pgTAP/FK controls and composite/discriminator constraints. |
| G09 | AC6 | Integration scalar and Unicode boundaries; register properties and application `registerInputSchema`; SQL `private.register_name`. |
| G10–G12 | AC7/AC8 | Integration immutable retries, conflicts, caller-scoped keys, eight concurrent/reordered requests; request replay and audit snapshots. |
| G13 | AC7 | Integration faults at all five entity/link/audit/receipt insertion targets with complete before/after snapshots and restored same-key retry. |
| G14–G15 | AC4/AC5/AC8 | Integration queued demotion/revocation, old-token receipt denial, and independent read/create lock witnesses; explicit role/lock faults. |
| G16 | AC4/AC5/AC6 | `tests/unit/register-operations.test.ts` verified auth, outages, live access, derived practice, forged fields, exact RPC binding. |
| G17 | AC6 | `tests/unit/register-actions.test.ts` duplicate/file/repeated-coverage parser cases; `registerInput` and strict schema. |
| G18 | AC4/AC9 | Register operation/repository tests reject malformed projections and strip private extra fields; exact safe-message/action redirects. |
| G19 | AC9 | Register browser creation, reload and sign-in; route tests preserve home/settings and link/backlink. |
| G20 | AC5/AC10 | Register browser manager creation, viewer read-only, stale demotion and revocation; form/route role tests. |
| G21 | AC6/AC9/AC10 | Form tests keep draft/linked focused errors, deliberately reset incompatible ownership/coverage, and permit definite correction. |
| G22 | AC8/AC9/AC10 | Unit pending/exact retry and browser delayed write, pre-commit failure, post-commit abort; exact same database rows after retry. |
| G23 | AC9 | Browser actual read-function outage yields existing safe error boundary with no fabricated empty list; route/repository failures. |
| G24 | AC3/AC10/AC12 | Browser keyboard, Axe at 375px, no overflow, one policy card, Dates not entered; inactive-text copy and viewer presentation. |
| G25 | AC11 | `tools/register-upgrade.mjs` seven historical tables, nine-section rollback, empty five-table backfill, two representative policies, old RPCs and fresh replay. |
| P01–P02 | AC6 | `src/lib/register/properties.test.ts` 1,000-run seeded generated inputs plus fixed boundaries, malformed Unicode, ownership/UUID/projection/message invariants; independent property mutation run. |
| P03 | AC4/AC7/AC8 | Integration 20 seeded real actor/name/key sequences with exact retry/conflict/foreign denial and unchanged snapshots. |
| A01 | AC4/AC5 | Real roles/public table/RPC/private storage/helper/direct-DML denials, old access tokens, same-practice privileged FK tests. |
| A02 | AC4/AC6/AC10 | Forged form identity, invalid enums/UUID/Unicode in properties/operations; markup rendered as text in register form tests. |
| A03 | AC4/AC8/AC9 | Browser actual foreign-Origin action rejected with unchanged rows, real post-commit response abort and exact-key retry. |
| N01–N03 | AC4–AC8 | Live membership/tenant/lock/receipt/audit constraints, API tests, applied SQL faults and restoration. |
| N04 | AC11 | Entire inherited suites and seven-table upgrade snapshot. |
| N05 | AC12 | Schema, UI, capability review: no dates/cycles/jobs/provider sends; single credential identity does not prove future SMS dispatch behavior. |
| N06 | Scope | Capability/dependency/secret checks; no new packages; UI request uses cryptographic UUID and authenticated Supabase RPC only. |
| N07–N08 | AC11 | Dedicated exact-project/endpoint/fixture guards, schema/type fingerprints, test/layer inventories, restored faults and final source hash. |
| N09 | Scope | Local branch only; no deployment/push/merge/external messages. |

Fixed examples and generated invariants share `src/lib/register/properties.test.ts` rather than duplicating them in a separate schema test file. Both the full unit suite and independent property mutation configuration execute that file.

## Final-source run

Pending. Reproducible entry point: `PATH="$PWD/.tools/node/bin:$PATH" npm run gauntlet`, using the 30-layer inventory in `tools/layers.json` and independent required list in `tools/gauntlet.mjs`. Final SHA/hash/run ID, actual counts and layer results will be recorded only after the complete current-source run. Do not treat intermediate passes above as final evidence.

The initial pipeline attempt stopped at `tools/source-state.mjs` with **`Error: Untested dirty source inputs:`** before executing any layer or clearing reports. The subsequent explicit **“push to prod”** request authorized the required checkpoints and release. Checkpoint `42dedff` was committed and its complete run exposed the artifact-retention defect documented above. Vercel built that archive without switching the public domain; production migration and promotion remain gated on a fresh passing 30-layer run. The clean-source gate remains intact; Phase 4 remains unchecked until that run completes.

### Preflight observations — not a final 30-layer result

These are separate local invocations, not one final source-bound pipeline run. Pinned runtime: Node 24.21.0; when chaining commands, first `export PATH="$PWD/.tools/node/bin:$PATH"`. Browser runs also set `PLAYWRIGHT_BROWSERS_PATH="$PWD/.browser-cache"`. Tool versions remain pinned in repository manifests and the existing local verification setup.

| Command | Observed result |
| --- | --- |
| `npm run test:coverage` | 204 tests / 26 files passed. Unit-only executable lines: 662/692, 95.66%. |
| `npm test -- --sequence.seed=20261017` | 204 tests / 26 files passed in shuffled order. |
| `npm run test:db` | 94 SQL assertions / 5 files passed; 41 applied FK/index/invariant/grant faults failed expected assertions and rolled back. |
| `npm run test:integration` | 77 tests / 7 files passed against the dedicated fixture project. |
| `npm run build` | Pinned-runtime production build passed, including `/practice/register`. |
| `npm run test:e2e` | 28 browser tests passed; 0 skipped, flaky, or unexpected. Actual write/read faults, lost-response retry, foreign Origin, live role changes, mobile keyboard and Axe included. |
| `node tools/check-coverage.mjs` | 692/692 owned executable lines, 54 source files; 300 browser / 92 Node source remappings. Reported branches 1117/1292 (86.45%); no 100% branch-coverage claim. |
| `npm run test:controls` | 33 checker controls passed. |
| `node tools/checker-sensitivity.mjs` | 21 checker defenses removed and caught; 3 UI behavioral faults caught, exact source restored, and cases passed again. |
| `npm run typecheck`, `npm run lint`, `npm run format:check` | Passed. A default JSON reporter artifact initially interrupted formatting; the tool now uses its explicit ignored report path and the accidental generated file was removed before a passing rerun. |
| `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests` | Passed. |
| `node tools/schema-fingerprint.mjs` | Fresh local columns, grants, policies, functions, triggers, constraints, indexes and schemas matched the expanded contract. |
| `node tools/check-generated-types.mjs` | Tracked public TypeScript database types matched local generation. |
| `git diff --check` | Passed; main-agent scoped source/diff review completed. |

Earlier preflight observations: all three upgrade rehearsals passed, including the new seven-table register rehearsal; the application mutation gate reached 100% (1139 generated: 528 killed, 611 compile errors), property-only mutation reached 100% (238 generated: 152 killed, 86 compile errors), and 58 applied SQL faults were killed with schema restoration. These are **intermediate results**, requiring another full final pipeline run. Earlier supply-chain/capability/secret checks also passed but remain pending final source-bound reruns. No final 30/30 result, implementation SHA, or gauntlet run ID is asserted.

## Inspection and limits

The main agent reviewed the SQL grant/helper/lock order and the scoped diff. A populated 375px screenshot was inspected: clinician/credential cards, owner/coverage labels, pending dates, focused button, navigation and no visible clipping. Automated keyboard/Axe checks are separate from that visual inspection. User-confirmed desktop/mobile acceptance remains unchecked.

No capacity/SLA benchmark, exhaustive browser/Unicode guarantee, real legal-validity assessment, production migration/provider delivery, independent verifier, or later date/calendar/SMS behavior is claimed. Pilot lists aggregate completely; pagination is later scope. Reload discards unsaved drafts and reads persisted records; a manually reconstructed new request can duplicate a similarly named entry.
