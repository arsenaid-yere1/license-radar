# E2-S2 planning research: authoritative dates

Date: 2026-10-06 (America/Los_Angeles).
Baseline: `93f058bdd31f0a9cbbcdebb8b397a90c6708a478`.
Scope: current-state evidence for planning; no runtime or database changes.

## Story selection and ownership boundaries

`README.md` explicitly names E2-S2 next. The E2 backlog in `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md` requires type-specific issuer/jurisdiction, explicit valid dates, distinct earlier action deadlines, and unknown-date flags. The document's empty-workspace observations are historical. `thoughts/shared/plans/2026-10-06-e2-s1-register-ownership.md` marks its four implementation phases complete, and `thoughts/shared/handoffs/2026-10-06-e2-s1-production-release.md` records release and 30 passing layers. Hosted checks were not rerun here.

There is one application, not a multi-package monorepo. `src/app` owns routes/actions, `src/components` the interface, `src/lib` domain/persistence, `supabase` schema/access, and `tests`/`tools` verification. There is no reminder worker.

## Verified source facts

| File/symbol | Finding and planning implication |
| --- | --- |
| `src/lib/register/schema.ts:registerInputSchema`, `credentialSchema` | Creation and read contracts cover ownership/coverage only. New date/metadata fields need strict input and runtime read validation. |
| `src/lib/register/repository.ts:createRecord`, `getRegister` | Creates bind the legacy RPC; read/success outputs are parsed and errors mapped safely. A new named detailed RPC can preserve the old signature. |
| `src/lib/register/operations.ts:createRegisterRecord` | Auth and live role/practice precede persistence; posted practice identity is not authority. |
| `src/lib/register/messages.ts:registerInput`, `registerMessage` | Scalar repeats/files fail parsing; credential success explicitly says dates need entry. Both require date-specific review. |
| `src/components/register/create-form.tsx:CreateForm` | Frozen FormData survives uncertain saves, inputs are disabled, exact retry retains the key, and acknowledged success rotates it. New fields must participate. |
| `src/components/register/credential-form.tsx:CredentialFields` | Type/owner state clears incompatible coverage/owner fields; new type-dependent metadata/date resets belong here. |
| `src/components/register/register-panel.tsx:RegisterPanel` | Every record shows “Dates not entered”; saved results merge by ID with refreshed props. Date display can remain in this register. |
| `src/app/practice/register/page.tsx:PracticeRegister` | Dynamic authenticated route; viewers read; failures throw a safe error instead of empty data. |
| `supabase/migrations/20261006180010_register_ownership.sql:private.require_register_member` | Locks practice then checks live membership; private utilities have no client execute grants. |
| Same migration: `private.register_replay`, `private.finish_register_create` | Receipts compare operation/canonical payload scoped to practice/actor/key; stored results and private audits are immutable to clients. Audit accepts creation only with NULL before-state. |
| Same migration: `private.credential_projection`, `private.list_practice_register` | One projection serves legacy creation and read. Separate details projection avoids altering legacy create results. |
| Same migration: `public.credentials`, `public.policy_coverage` | Composite tenant keys/coverage discrimination exist; no dates/cycles/metadata exist. Cycle references can use `(practice_id,id)`. |
| `tests/integration/practice-register.test.ts` | Real RPC, complete five-table snapshots, concurrency, lock witnesses, faults, and isolation already exist. List-versus-create equality must account for additive read fields. |
| `supabase/tests/practice_register.test.sql` | Exactly 22 assertions, with separately enumerated fault-control expectations. |
| `tests/e2e/practice-register.spec.ts` | Covers production-local persistence/accessibility, response loss after commit, foreign Origin, and stale access; snapshot helper currently covers five tables. |
| `tools/register-upgrade.mjs` | Starts at E1-S3 and applies all later migrations; preservation covers seven historical tables. Need a populated E2-S1 baseline rehearsal for this story. |
| `tools/schema-catalog.mjs:schemaQueries` | Seven public-table filters explicitly list five existing public tables; cycles must be added in each. Nine catalog sections exist. |
| `tools/layers.json`, `tools/gauntlet.mjs:requiredLayers` | 30 required layers independently enumerated; adding a dedicated dates upgrade makes 31. |
| `stryker.config.mjs`, `stryker.properties.config.mjs`, `tools/check-coverage.mjs` | Mutation thresholds are 100%; application executable-line inventory covers new source automatically. New date helper must enter mutation lists. |

The relevant sources, tests, release record, existing plan, schema tooling, fault runners, generated types, and package commands were read completely. No local `AGENTS.md` or existing `graphify-out/graph.json` was found by the targeted inventory; working instructions were supplied in chat.

Independent plan review identified a relevant verification defect in `tools/gauntlet-controls.test.mjs`: its protection-removal test calls unimported `assertSchema`. The resulting ReferenceError includes “Schema” and satisfies its `/schema/i` expected-error pattern, so that test can pass without executing the schema comparator. The plan includes repairing the import and adding a positive identical-schema control before extending this witness for cycles. This is a source-review finding, not a newly executed fault experiment.

## Planning decisions

Dates are initial-cycle data, not independently maintained calendar values. Preserve legacy create signatures/results/receipts; add a detailed-create RPC, nullable credential metadata, an initial unknown-cycle backfill/insert trigger, and a details read projection. New detailed creates set their initial dates before the final audit/receipt. Existing records remain explicitly unknown until E2-S3 editing; no implicit data enrichment is performed.

Both dates may be unknown. Action-only entries remain useful without inventing an expiration. When both are entered the action date is strictly earlier. Dates stay Gregorian strings/PostgreSQL DATE, with strict lexical validation before construction, bounds 0001–9999, and no JS local-time interpretation. All three type-specific metadata labels accept optional manually supplied text; no legal requirement or issuer identity is inferred.

## External documentation check

Official [Supabase function documentation](https://supabase.com/docs/guides/database/functions) supports distinct RPC names, invoker wrappers, pinned search paths, explicit execution grants, and authorization inside definer functions. Official [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) distinguishes row policies from table access. These support retaining the repository's existing checked private-entry pattern.

PostgreSQL's [date type documentation](https://www.postgresql.org/docs/current/datatype-datetime.html) describes DATE as a date without time of day and documents broad input forms/special values; the proposed strict application/API range is narrower. [Date/time functions](https://www.postgresql.org/docs/current/functions-datetime.html) document `make_date` for constructing dates from components. Implementation should check against the installed local PostgreSQL version as well.

The Supabase skill's changelog-index fetch was attempted: the web reader rejected its Markdown content type and the sandbox shell could not resolve the host. Topic documentation loaded through the web tool. Changelog completeness is not claimed; recheck relevant changes at implementation time before using new platform behavior.

## Commands and verification boundaries

`git status --short` was clean at baseline. `git rev-parse HEAD` returned the baseline above; `git log -4 --oneline` confirmed the E2-S1 release/documentation sequence. `rg --files` located application, tests, migrations, and durable planning/history documents; targeted hidden-file inventory found no local instructions/graph. Complete file reads and comparison established the facts above.

This is planning research. One existing schema-control test and an isolated in-memory comparator probe ran on host Node 26.3.0; both passed, while the missing-import false-positive remains a statically verified defect scheduled for implementation repair. No application/SQL/API/browser suites, local database reset, hosted mutation, or deployment ran. Formatting/diff checks and exact planning-check commands are recorded in the plan verification report. The future implementation gauntlet still requires repository Node 24.21.0.
