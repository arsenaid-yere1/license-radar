# SPEC — E1-S1 Practice Profile and Timezone

- Date: 2026-10-03
- Tier: **3 — authentication, private practice data, concurrency, and atomic writes**.
- Approval: **pending**. This document is the approval artifact; the earlier choice of story/stack and implementation request are inputs, not approval of this executable contract.
- Implementation plan: `thoughts/shared/plans/2026-10-03-e1-s1-practice-profile-and-timezone.md`.
- Current baseline: three research/planning Markdown files, no application, no test suite, no package manifest, and no Git repository. No existing application tests can be baseline failures.
- Deliverable: verified email sign-in → create practice name/timezone → saved, editable owner-only settings. One owned practice per account for this story.

## Setup Plan and Authorization Boundary

Approval of this specification authorizes the following local setup and checkpoint operations together. It does not authorize deploying, pushing commits, provisioning cloud projects, contacting real recipients, or making changes in renewal portals.

### Isolation and Git

1. Initialize Git in `/Users/macbookpro/Coding/license-radar` with `main` as the initial branch. Preserve all current documentation. Commit the approved SPEC and existing documents as the initial baseline, adding an approval entry that quotes the user's approval.
2. Create and attach a managed worktree from that baseline, with an implementation branch named `codex/e1-s1-practice-profile`. Implement and run checks in that worktree so application changes do not land in the original checkout during development.
3. Make local checkpoint commits after GREEN/refactor stages. Do not push, merge into `main`, or archive the worktree containing the finished result. Deliver its attached reviewable branch, file paths, and evidence report.
4. Rebuild dependencies in the worktree; never infer a green run from another checkout's ignored files. Record actual worktree/runtime/environment differences in EVIDENCE.
5. Use the existing Git identity; if none exists, report the missing identity rather than inventing an identity or changing global Git configuration.

### Tools and Environment

- Node 24 LTS and npm: reuse a compatible existing installation or obtain a pinned official Node archive in the worktree's ignored `.tools/` directory with checksum verification. No global runtime change.
- Docker and the local Supabase development stack: use local containers for Postgres, Auth, Data API, and the development email inbox. Pull the required images and start only this story's local stack; never reset or stop unrelated containers.
- Chromium through Playwright: download a pinned browser into an ignored local test cache for real UI tests.
- Gitleaks: use a pinned release binary in ignored `.tools/` with checksum verification for tracked-file and history secret scanning.
- SQLFluff: pin in `requirements-dev.txt` and install in an isolated ignored `.venv-gauntlet/`; use the PostgreSQL dialect for migration/test SQL checks.
- Runtime/package/tool versions and image identifiers go in the committed `tools/toolchain.json` and lockfiles. Dependency installs may access their official/package registries. No real credentials belong in committed files.
- Local auth emails go only to generated fixture accounts in the development inbox. A hosted Supabase account and real SMTP sender are unnecessary for this local implementation.

### New Direct Dependencies

Resolve compatible stable exact versions during setup and pin them; enumerate transitive dependencies through the lockfile and license report. A newly needed direct dependency outside this list requires a visible SPEC revision before installation.

| Dependency | Justification |
| --- | --- |
| `next` | App Router, server rendering/actions, and production build |
| `react`, `react-dom` | Application components and rendering |
| `@supabase/supabase-js` | Authenticated local Auth/Data API operations |
| `@supabase/ssr` | Cookie-aware server/browser clients and session refresh |
| `zod` | Explicit validated form/action contracts |
| `typescript` | Static checking of application and tests |
| `@types/node`, `@types/react`, `@types/react-dom` | Type definitions for the selected runtime and UI |
| `eslint`, `eslint-config-next` | Framework-aware linting with zero warnings |
| `prettier` | Formatting consistency |
| `supabase` | Pinned local CLI for stack initialization, migrations, types, and database tests |
| `vitest`, `@vitest/coverage-v8` | Unit/property/integration runner and executable coverage collection |
| `@playwright/test` | Real-browser sign-in, forms, navigation, and isolation checks |
| `@axe-core/playwright` | Automated accessibility checks alongside keyboard/manual checks |
| `fast-check` | Seeded Unicode, timezone, and input-contract properties |
| `@stryker-mutator/core`, `@stryker-mutator/vitest-runner`, `@stryker-mutator/typescript-checker` | AST-based mutation generation, test execution, and type-aware mutant checks |
| `@testing-library/react`, `@testing-library/dom`, `jsdom` | Component behavior assertions where a browser is not needed |
| `pg`, `@types/pg` | Test-only local Postgres fixtures, audit fault injection, and schema assertions |
| `c8`, `v8-to-istanbul`, `istanbul-lib-coverage` | Remap/merge actual Node/browser runtime coverage with unit coverage |
| `license-checker-rseidelsohn` | Inventory dependency licenses for an auditable redistribution check |
| Python `sqlfluff` | Parse/lint PostgreSQL migrations and database-test SQL |

No ORM, CSS framework, icon library, SMS provider SDK, cloud-agent SDK, or production monitoring dependency is introduced.

### Files Added or Updated

All application/configuration paths enumerated in the implementation plan remain in scope. Additions for the old-coder contract and gauntlet are explicitly:

- This approved document: `thoughts/shared/plans/2026-10-03-e1-s1-old-coder-spec.md`.
- Final report: `thoughts/shared/research/2026-10-03-e1-s1-old-coder-evidence.md`.
- `tools/gauntlet.mjs`: one fail-closed entry point; expected-layer manifest, cleanup, exit-status checks, and actual result capture.
- `tools/source-state.mjs`: identify the tested commit/input tree and reject relevant dirty/untracked application inputs.
- `tools/local-environment.mjs`: start/verify only local endpoints and prepare ignored test environment values without printing secrets.
- `tools/check-coverage.mjs`: merge remapped coverage, bind it to changed source lines, and reject missing/unreadable/insufficient coverage.
- `tools/sql-mutants.mjs`: persisted SQL mutation execution, assertions of each applied mutant, clean database replay, and restore verification.
- `tools/check-capabilities.mjs`: inventory changed network/filesystem/process/environment capabilities; report detection limits.
- `tools/gauntlet-controls.test.mjs`: known-bad controls for custom coverage, local-endpoint, result-manifest, and mutation-execution checks.
- `tools/toolchain.json`, `tools/layers.json`, `stryker.config.mjs`, `.sqlfluff`, `requirements-dev.txt`, `.gitleaks.toml`: reproducible tool configuration and expected layers.
- `src/lib/practice/schema.test.ts`, `src/lib/practice/timezones.test.ts`, `src/lib/practice/properties.test.ts`: named validation and property checks.
- `tests/unit/auth-actions.test.ts`, `tests/unit/practice-actions.test.ts`, `tests/unit/practice-form.test.tsx`: observable action/component contracts with external boundaries replaced only where needed.
- `supabase/tests/practice_profiles.test.sql`: real role/constraint/audit assertions.
- `tests/integration/practice-profile.test.ts`, `tests/integration/practice-properties.test.ts`: real local API/database and generated-input checks.
- `tests/e2e/practice-onboarding.spec.ts`, `tests/e2e/practice-isolation.spec.ts`, `tests/e2e/practice-failures.spec.ts`: production-build browser checks.
- `tests/helpers/local-fixtures.ts`, `tests/helpers/local-mail.ts`, `tests/helpers/coverage.ts`: local-only fixtures/inbox/coverage collection.
- `tests/fixtures/gauntlet-controls/`: deliberately invalid non-secret fixtures for proving custom checkers fail.
- `.gitignore`: exclude dependencies, local keys/environment files, containers' data, generated reports/coverage, browser artifacts, tool binaries, and the Python environment. Never ignore application source or the approved contract.

Helpers may be split within these directories for readability without expanding behavior or adding dependencies. Persist every command used as final evidence in the repository. Evidence includes the generated CLI migration's actual filename.

## Failure Model

| Failure | Check that can detect it |
| --- | --- |
| Forged/stale auth, anonymous mutation, or identity supplied in a form | Real auth/route/action tests, direct API role tests, hostile input pass |
| Owner A reads or changes owner B's practice | Two-account real Data API and browser sessions; policy/grant mutation |
| Double-click/retry creates duplicates | Concurrent real requests, unique owner constraint, audited row counts |
| Two edits overwrite one another | Version-checked concurrent update test and version-predicate mutation |
| Profile survives failed audit or reports a false success | Test-only audit-trigger fault injection and outage/error contracts |
| Unicode validation disagrees with storage | Seeded input properties and real PostgreSQL boundary cases |
| Invalid timezone enters through direct API | Catalog-backed SQL validation plus API tests and predicate mutation |
| Session/cache responses leak another user's state | Separate browser contexts, protected-route assertions, cookie/cache-header checks |
| Migration/test cleanup touches another database | Local-only endpoint guard, known-bad hosted-endpoint control, fresh local replay |
| A checker reads stale artifacts or skips a layer/mutant | Fresh-run IDs, fixed manifest, missing-input and missing-mutant controls |
| Secrets or unjustified dependencies enter the result | Gitleaks, audit/license inventory, SPEC-to-dependency mapping |

## Scenarios — Named Executable Test List

Each ID below becomes a test name or a test-name prefix. EVIDENCE maps every row to actual file/test/result; a test that is not run is unverified, never passed.

### Sign-in and Routing — AC1, AC5, AC6

| ID | Concrete input/action | Expected observable result |
| --- | --- | --- |
| S01 | Signed-out browser visits `/practice` or `/onboarding/practice` | Redirect to `/login`; no profile data appears. |
| S02 | Generated fixture account requests an email code | Local inbox receives the code; UI asks for it; no authenticated profile access before verification. |
| S03 | Enter the delivered valid code | Verified cookie session exists; an account with no practice reaches setup. |
| S04 | Enter a wrong, expired, or reused code | Generic invalid/expired-code error; no new session or practice; resend remains possible. |
| S05 | Request another code before configured resend interval | No premature second delivery; useful retry message; later permitted resend works. |
| S06 | Saved owner signs out, then visits a protected page; subsequently signs in again | After sign-out, login is required; after fresh verification, the same profile returns. |
| S07 | Session refresh or redirect occurs | Refreshed cookie and relevant cache protections survive; another browser context does not inherit the session. |

### Form and Timezone — AC2, AC3, AC4, AC11

| ID | Concrete input/action | Expected observable result |
| --- | --- | --- |
| S08 | Submit name `  Cedar Clinic  ` and timezone `America/Los_Angeles` | Saved name `Cedar Clinic`; saved zone exactly `America/Los_Angeles`. |
| S09 | Submit empty/whitespace name | Field error `Enter a practice name.`; no row/audit change; other form values survive. |
| S10 | Submit 120 Unicode code points, then 121 | First accepted; second returns `Use 120 characters or fewer.` with no persistence. Include astral characters so UTF-16 length cannot substitute. |
| S11 | Select `UTC`, `America/New_York`, and `America/Los_Angeles`; submit `Mars/Olympus` | Valid choices persist; unknown zone returns `Choose a valid timezone.`; invalid direct API write is rejected too. |
| S12 | Submit ownership/role fields or malformed expected version | Validation rejects unrecognized ownership/role input; owner stays authenticated user. Edit version must be a positive safe integer or returns `Reload the settings and try again.` |
| S13 | Browser reports a supported timezone; detection fails or reports an unsupported value | Supported detection is a visible suggestion, editable before save; otherwise visibly select UTC. No silent profile write. |
| S14 | Change timezone in the form | Fixed example says October 3, 2026, 09:00 and selected timezone for a December 2, 2026 due date; labels it `Example only`; creates no notification. |
| S15 | Submit via keyboard at 375px viewport; induce a field error or pending save | Labels/error associations work; keyboard reaches controls; error is announced/focused; no horizontal overflow; pending submission is disabled. |

### Persistence, Grants, and Concurrency — AC5–AC9

| ID | Concrete input/action | Expected observable result |
| --- | --- | --- |
| S16 | A creates a profile, refreshes, closes/reopens the browser, and verifies a new code | Same practice ID, name, timezone, and owner are returned. |
| S17 | B creates a second practice, then queries/updates A's ID through the Data API | B can access B only; no A row is returned/changed. Privileged fixture inspection confirms A unchanged. |
| S18 | Anonymous caller queries/mutates profiles; owner attempts to write ID/owner/version/timestamps or delete | Required grants/policies deny operations; no protected-field or row change. |
| S19 | Repeat A's create request with different values after first success | Return A's existing ID and saved values; retry does not overwrite them; exactly one creation event. |
| S20 | Send 20 simultaneous create requests for the same verified account | Exactly one profile/creation event; all successful application results refer to that ID; no orphan records. |
| S21 | A edits `Cedar Clinic`/Pacific to `Cedar Medical`/Eastern at saved version | Persist new values; version increments by one; correctly attributed before/after audit event. |
| S22 | Two edits use the same expected version with different values | Exactly one succeeds; the other returns `These settings changed. Reload before saving.`; only the winner persists and is audited. |
| S23 | Client attempts direct access/modification of private audit storage | Denied; previously recorded events remain unchanged. |

### Failures and Recovery — AC9, AC10

| ID | Concrete input/action | Expected observable result |
| --- | --- | --- |
| S24 | Interrupt Auth/Data API boundary during request/save/read | No false success or fabricated profile; safe error `We could not complete this request. Try again.`; input retained; successful retry persists once. |
| S25 | Force the local audit trigger to raise during create/update | Transaction fails; neither profile mutation nor new audit event survives; application returns unavailable, not success. Restore the test-only fault before subsequent checks. |
| S26 | Session expires between opening and submitting a settings form | Mutation requires authentication; no row changes; a fresh sign-in permits retry. |
| S27 | Replay migrations into a fresh disposable local database | Same schema/grants/policies/triggers produced; re-run representative create/isolation/update/rollback scenarios successfully. |

### Properties and Adversarial Checks

- P01: Across 1,000 seeded generated names, accepted values are trimmed, contain 1–120 Unicode code points, and satisfy the same real database boundaries. Pair rejection properties with acceptance of valid boundary cases to catch fail-closed bugs.
- P02: Across 1,000 seeded form objects, unrecognized ownership/role fields and invalid timezone values cannot alter authorized ownership or enter storage. Mutate one field at a time around valid cases.
- P03: Repeated create calls and successful updates preserve practice identity/ownership; generated sequences against the real local API preserve one-owner-one-practice and monotonic versions. Record actual example counts rather than assuming 1,000 database calls are cheap enough for every suite.
- A01: Explicitly attack the finished application with forged cookies, guessed practice IDs, crafted owner/role fields, markup in names, cross-origin mutations, and competing edits. Assert rendered names stay text and all authorized state invariants survive. Record the exact attacks and outcomes, including untested cases.

## Must NOT — Negative Contract

| ID | Invariant | Evidence requirement |
| --- | --- | --- |
| N01 | Existing research/planning documents remain intact, except appended implementation progress/approval records | Git diff against approved baseline; do not silently rewrite earlier findings or approved scenarios. |
| N02 | No obligation inventory, real reminder delivery, agent renewal, external payment, or production deployment | Capability/schema/dependency inspection and explicit unchanged external-service state; record limits of inspection. |
| N03 | No service-role/secret key in browser or application authorization; no authorization from editable user metadata | Source/asset secret checks and hostile identity tests. Privileged test fixture credentials are local-only and never sent to the browser or committed. |
| N04 | No practice/audit deletion or ownership transfer for normal clients | S18/S23 plus SQL foreign-key/grant assertions. |
| N05 | Local test reset/fixture operations cannot target a hosted/shared database | Endpoint-guard negative controls before any destructive local fixture operation. |
| N06 | No mutation restore leaves changed application/schema inputs | Recorded source hash/Git diff before and after mutants, local migration replay, and restored green suites. |
| N07 | No skipped/unavailable layer or unrun scenario is marked passed | EVIDENCE mapping plus completed-layer manifest; failing required layer blocks completion. |

## RED → GREEN → REFACTOR and Gauntlet

Create runnable stubs first where a missing module would cause only an import error. Add tests, observe their behavior failures, then implement. Record each RED result. A test immediately green must be demonstrated sensitive with a real throwaway mutant. Keep assertions fixed during implementation refactoring.

One final fresh entry point: **`npm run gauntlet`** → persisted `tools/gauntlet.mjs`. Delete stale reports, assign a run ID, record layers only after successful command completion, and require the fixed layer manifest before printing success.

| Layer | Required check |
| --- | --- |
| Full suite | All unit, property, local SQL/API, and browser tests green; no existing application baseline to discount |
| Types | TypeScript zero errors; generated database types match fresh schema |
| Lint/format/SQL | ESLint zero warnings; Prettier check; SQLFluff parse/lint with PostgreSQL dialect and actual migration replay |
| Changed-source coverage | 100% changed executable TS/TSX lines in owned `src/`, merging unit and real Node/browser execution coverage; gate exits nonzero for misses or missing source maps/input. Report branch coverage as well. Generated types, CSS, framework-generated declarations, and orchestration code are separate build/UI/control checks, not claimed executable-line coverage. Map SQL constraints/predicates/triggers/migration statements to real database tests. |
| Mutation | Stryker on handwritten validation/auth/action/persistence logic; meaningful non-equivalent survivors block completion. Re-run relevant mutants with property tests alone and report their separate score. SQL uses persisted manual mutants for isolation predicate, timezone validation, unique owner constraint, version comparison, and audit atomicity; prove each was applied/executed, killed, and restored. |
| Property tests | Seeded fast-check properties above, with bidirectional valid/invalid boundaries and persisted failure seeds |
| Concurrency and rollback | S20/S22 against real local storage; S25 fault injection and S27 clean replay |
| Real execution and UI | Production build started and exercised through real OTP sign-in/create/edit/return; accessibility checks plus recorded keyboard/mobile observations |
| Supply chain/licenses/secrets | Audit complete dependency tree; classify any advisories explicitly, with no unresolved exploitable issue. Inventory licenses and reject unknown/unapproved restrictive licenses pending review. Scan tracked files/history/assets with Gitleaks; verify every new direct dependency's justification. |
| Complexity | ESLint per-function cyclomatic complexity maximum 10 for handwritten application functions; split larger functions instead of suppressing the rule |
| Suite health | Randomized unit/integration order with recorded seeds and independent fixtures; browser tests isolated by context/accounts and order-shuffled with recorded order. Repeated-only substitutes must be labeled SUBSTITUTED, never equivalent to order randomization. |
| Adversarial pass | A01 plus the capability diff; state scope and blind spots |
| Custom checker controls | Missing coverage, an uncovered source line, a hosted reset endpoint, a missing layer, and a nonexecuted mutant each trigger the correct hard failure; temporarily remove each defense and demonstrate that its negative-control test fails |

SQL lint/mutation, runtime/browser coverage remapping, and local stack execution must actually run. A missing tool or unmapped line cannot be waved through as a successful layer. If the environment cannot support a required layer, report partial implementation and the exact limitation; do not call the story complete.

Manual verification performed by the agent is reported as observed evidence; plan items that specifically require user confirmation stay pending until the user confirms them.

Independent fresh-agent verification: **not performed** for this initial implementation unless separately requested. EVIDENCE must declare that downgrade; the author-written tests, adversarial pass, and mappings share author blind spots. Human approval of SPEC mitigates contract correlation but is not proof that the spec is complete.

## Evidence and Completion

Write `thoughts/shared/research/2026-10-03-e1-s1-old-coder-evidence.md` with the exact user approval quote, baseline commit, final tested source state, versions, reproducible entry point, all S/P/A/N mappings, all final fresh results, RED observations, checker controls, mutation scores/survivors, environment changes, and known limits.

Identify the immutable tested source commit before the final run; report-file/progress-only commits afterward must distinguish the tested source state from the report commit. Never attribute a prior run to subsequently edited application/tool/test code.

No implementation is complete while a required check fails. Exact dependency versions and real test counts will be recorded after execution, not invented in advance.

## Revisions

- 2026-10-03 — Initial executable contract derived from the selected E1-S1 plan; adds the Tier 3 failure model, named tests, explicit setup/dependency authorization, and reproducible evidence requirements. Approval pending; no implementation files, packages, containers, or Git repository have been created.

## Approval record — 2026-10-03

The user approved this specification with the exact message: **“approved”**. The earlier pending status is retained as history. Local setup, isolated implementation, and checkpoint commits above are authorized.
