# E2-S2: Authoritative Dates and Issuer/Jurisdiction Implementation Plan

Date: 2026-10-06 (America/Los_Angeles).
Baseline: `93f058bdd31f0a9cbbcdebb8b397a90c6708a478`.
Status: Implemented; all 31 source-bound automated verification layers passed. User manual acceptance remains pending.
Research: `thoughts/shared/research/2026-10-06-e2-s2-authoritative-dates.md`.
Verification: `thoughts/shared/plans/2026-10-06-e2-s2-authoritative-dates-verification.md`.

## Overview

Deliver E2-S2: “As a manager, I can add a state license, DEA registration, or malpractice policy with its dates so the system can track it.” Extend record creation with issuer/jurisdiction metadata, explicit expiration or coverage-end dates, and an optional earlier action deadline. Introduce an initial credential cycle so subsequent calendar, date editing, reminders, and renewal history share one source of dates.

`README.md` names E2-S2 next. The original acceptance criteria are in the E2 table of `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md`. The E2-S1 production release is recorded in `thoughts/shared/handoffs/2026-10-06-e2-s1-production-release.md`; its hosted results are historical evidence, not checks repeated in this planning turn.

## Current State

This repository contains one Next.js/React/TypeScript application, Supabase Auth/PostgreSQL, and Zod. It is not a multi-package monorepo. Routes/actions belong to `src/app/`, interface/forms to `src/components/`, domain/persistence to `src/lib/`, database boundaries to `supabase/`, and verification to `tests/` and `tools/`.

`src/lib/register/schema.ts:registerInputSchema` validates clinician and credential creation. Credentials contain title, type, owner, coverage, and version; they have no dates or issuer/jurisdiction fields. `src/lib/register/repository.ts:createRecord` calls the original seven-argument credential RPC. `src/components/register/register-panel.tsx:RegisterPanel` always displays “Dates not entered.” `src/components/register/credential-form.tsx:CredentialFields` supports type/owner switches and optional policy coverage.

`supabase/migrations/20261006180010_register_ownership.sql` creates the public clinician/credential/coverage tables and private audit/request tables. `private.require_register_member` takes the practice lock before checking live membership. All active members read; only administrators/managers create through checked RPCs. `private.register_replay` compares caller-scoped immutable payloads and returns the original stored result. There is no cycle, edit/archive endpoint, calendar, scheduler, or SMS worker.

The existing register has unit/property, real SQL/API, browser, and upgrade tests. `tools/layers.json` and `tools/gauntlet.mjs` independently enumerate 30 required layers. Existing mutation and complete application executable-line coverage gates remain requirements.

## Desired End State

| ID | Acceptance criterion |
| --- | --- |
| AC1 | Administrators/managers create each existing record type with optional issuer/jurisdiction metadata and known or unknown dates, preserving all existing ownership and coverage rules. |
| AC2 | Labels distinguish licensing board/state or territory, issuing authority/registration jurisdiction, and insurer/coverage jurisdiction. Metadata is entered by the practice; no issuer, jurisdiction, or renewal period is inferred. |
| AC3 | Known dates are strict Gregorian `YYYY-MM-DD` values in years 0001–9999. Invalid days, leap dates, timestamps, ambiguous formats, year zero, BC dates, and infinities are rejected at application and direct RPC boundaries. |
| AC4 | State licenses and DEA registrations display “Expiration date”; malpractice displays “Coverage end date.” An optional “Earlier action deadline” remains separately visible and must be strictly earlier when both dates are known. |
| AC5 | Either date may be unknown. An action deadline can be entered without a known expiration/end date. Missing end dates are explicitly flagged; when both dates are missing, there is no effective tracking date. |
| AC6 | Effective tracking date is the action deadline when present, otherwise the expiration/end date. Its purpose is explicit. Dates remain date-only through persistence, display, retries, and practice timezone changes. |
| AC7 | Every credential has one initial cycle in this story. A policy covering multiple clinicians has one credential and one cycle, with no coverage-based date duplication. |
| AC8 | Credential metadata, initial cycle, coverage, final private audit snapshot, and receipt commit atomically. Exact normalized retries return the original creation; changed metadata/dates with the same key conflict. |
| AC9 | Tenant isolation, viewer read-only access, revocation/demotion checks after the practice lock, private history protections, and direct-write denial extend to cycles and the new RPC. |
| AC10 | Forms retain date/metadata drafts on validation or save failure, freeze the entire uncertain payload for retry, reset on acknowledged success, and work by keyboard and at 375px width with associated errors. |
| AC11 | Upgrade preserves all existing values, timestamps, versions, links, audits, and receipts; legacy RPC signatures/payloads/results still work. Existing credentials acquire only an unknown-date initial cycle, without fabricated business dates or user audit events. |
| AC12 | Saved records persist across reload/sign-in. Missing/malformed cycle reads show a safe error instead of fabricated missing dates. The interface continues to state that text reminders are inactive. |

These are resolved planning defaults. No material implementation question remains open for this slice. Existing records remain unknown until E2-S3 provides editing; this story changes new-record entry, not existing-record maintenance.

## Key Discoveries

1. Immutable receipts are already production behavior. Replacing the old create signature or reconstructing its stored results would break uncertain-response recovery. Keep the original entry points and add a distinctly named detailed-create RPC.
2. The original audit helper permits only creation operations and a NULL before-state. Initial dates belong in a new creation's final snapshot; migration backfill must not pretend a user supplied dates.
3. The old `private.credential_projection` is used for both legacy create results and list results. Preserve its exact shape and add a details projection for the list/new create instead.
4. `tools/schema-catalog.mjs:schemaQueries` explicitly lists public tables in seven sections. Add the cycle table to every relevant filter before recording the new contract.
5. `tests/integration/practice-register.test.ts` and `tests/e2e/practice-register.spec.ts` snapshot five register tables. Include cycles in atomicity/retry witnesses and deliberately revise list-versus-legacy-result comparisons.
6. `tools/register-upgrade.mjs` applies all migrations after E1-S3, so it will also apply E2-S2. Keep that rehearsal passing and add a separate E2-S1-to-E2-S2 rehearsal with populated credentials and receipts.
7. `tools/gauntlet-controls.test.mjs` calls `assertSchema` without importing it. Its resulting ReferenceError matches `/schema/i`, so the current protection-removal control can pass without executing the comparator. Repair that witness before extending it for cycles.

## What We Are Not Doing

- Editing/filling existing records, archiving, suspected duplicates, ownership changes, clinician deactivation, or successor cycles (E2-S3/E5).
- Calendar, urgency dashboard, searching/filtering, renewal links, credential identifiers, evidence uploads, CSV, or new obligation types.
- Reminder schedule arithmetic, jobs/outbox, catch-up, phone verification, consent, provider integration, message dispatch, or rule-9 cancellation/catch-up (E4).
- Regulatory interpretation, renewal-period calculation, legal-validity labels, or verification against issuer portals.
- New dependencies, hosting/auth changes, runtime implementation, commits, or production writes during this planning turn.

## Implementation Approach

### Product and normalization rules

Keep the three type values and both ownership modes. Add nullable `issuer` and `jurisdiction`, using the existing text normalization/code-point rules with a 120-character maximum. Blank/omitted metadata becomes NULL; reject malformed Unicode/NUL and overlong nonblank text. All types support optional free-text jurisdiction; labels describe its meaning without restricting the user to an unverified legal taxonomy. Unknown metadata does not block creation.

| Type | Issuer label | Jurisdiction label | End-date label |
| --- | --- | --- | --- |
| `state_license` | Licensing board (optional) | State or territory (optional) | Expiration date |
| `dea_registration` | Issuing authority (optional) | Registration jurisdiction (optional) | Expiration date |
| `malpractice_policy` | Insurer (optional) | Coverage jurisdiction (optional) | Coverage end date |

Do not prepopulate DEA or a state board as confirmed data. Tell users to enter dates from their own records. Empty date fields explicitly mean “Unknown”; include that help text and show unknowns after saving. Do not require a future end date: historical, due-today, and near-term entries must be representable. Do not include coverage-start dates in this slice.

Canonical application fields are `issuer`, `jurisdiction`, `endDate`, and `actionDeadline`, all normalized to string-or-NULL. Date NULL/omission/empty string means unknown; any nonempty value must match the exact format without trimming, parse to a real Gregorian day, and remain in the stated range. If both dates exist, require `actionDeadline < endDate`; equality and later deadlines receive an action-deadline field error. An action-only entry is allowed and displays “Expiration date unknown” or “Coverage end date unknown” alongside the known tracking date.

Add `src/lib/register/dates.ts` with date validation, effective-date/purpose selection, and deterministic English formatting from numeric components. Avoid `new Date(dateString)`, UTC/local conversions, locale-dependent parsing, or rollover validation. A useful display is “Dec 2, 2026”; use `<time dateTime="2026-12-02">`. The effective date is derived, not separately writable or persisted. TypeScript and SQL implement independent checks, with shared acceptance fixtures as witnesses rather than one implementation testing itself.

Type switching resets issuer/jurisdiction/end date/action deadline and coverage so an insurer or coverage date cannot silently become licensing data. Keep title/owner behavior consistent with the existing form; owner changes preserve dates/metadata while clearing incompatible clinician/coverage choices. Retain all fields on acknowledged validation failure.

### Persistence and cycle foundation

Create the additive migration through the installed CLI's documented `migration new` command during implementation. Do not modify applied migrations or invent a timestamp in this plan.

- Add nullable `issuer` and `jurisdiction` columns to `public.credentials`, with normalized nonempty bounded-text CHECKs for non-NULL values. Existing rows get NULL; no original credential value/version/timestamp changes.
- Create `public.credential_cycles`: UUID ID, NOT NULL practice/credential IDs, `cycle_number integer NOT NULL DEFAULT 1 CHECK (>0)`, `date_revision integer NOT NULL DEFAULT 1 CHECK (>0)`, nullable PostgreSQL DATE `end_date`/`action_deadline`, and created/updated timestamps.
- Use a restrictive composite `(practice_id,credential_id)` FK to `public.credentials(practice_id,id)`, a restrictive practice FK, unique `(practice_id,credential_id,cycle_number)`, and unique `(practice_id,id)` for future tenant-scoped job references. Add a tenant/credential read index. Date CHECKs exclude infinities and values outside 0001-01-01 to 9999-12-31; enforce strict earlier-deadline ordering when both are present.
- Backfill exactly one cycle number 1/date revision 1 per existing credential with both dates NULL. Do not change private receipts/audits or claim the backfill is a date confirmation.
- Add a private, non-client-callable AFTER INSERT trigger on credentials that inserts the unknown initial cycle. Use SECURITY INVOKER with an empty search path under the already checked private create entry's transaction privileges. This keeps old creates cycle-complete without replacing their original payload/result/audit contract.
- The new detailed-create function inserts credential metadata and coverage, then updates its just-created initial cycle with validated dates before taking the final audit snapshot/receipt. This initial assignment remains date revision 1; it is one atomic creation, not a later edit. Failure of trigger, date write, audit, or receipt rolls back everything.
- Enable cycle RLS; grant only authenticated SELECT with the existing live `private.current_practice_id` tenant policy. Revoke PUBLIC/anonymous access and all authenticated direct DML, including TRUNCATE. Preserve private audit/receipt access rules. No public definer functions or invoker views are needed.

Only cycle 1 can be created through the story's RPCs. Future E5 will add completion/successor semantics; the unique per-cycle-number key avoids a permanent one-cycle-per-credential constraint. In this story the details projection requires the initial cycle, returning its ID, number, revision, and canonical dates. Missing cycles are an invariant/read failure, not a NULL-date fallback. Do not expose or accept workflow/completion fields that do not yet exist.

### RPC, compatibility, audit, and retry contracts

Preserve `public/private.create_practice_credential` (seven arguments), `private.credential_projection`, `private.register_replay`, clinician creation, and the shared finish helper's existing contracts. Existing seven-argument creates return the original safe credential shape, with one unknown cycle established by the trigger. Stored historical receipts replay verbatim after the current authority check, including receipts written before cycles existed.

Add `public.create_practice_credential_with_details` and its checked private implementation. Arguments are the seven existing ownership/create arguments plus `p_issuer text`, `p_jurisdiction text`, `p_end_date text`, and `p_action_deadline text`. Distinct names avoid overloaded RPC dispatch. Keep text date arguments so direct API calls receive strict lexical validation rather than PostgreSQL's permissive implicit date parsing. Public wrapper: SECURITY INVOKER. Private entry: SECURITY DEFINER, empty search path, fully qualified references, live checked authority; authenticated execution only where needed. Utility parsers/projections/trigger functions have no ordinary client execute grants.

After `private.require_register_member(p_practice_id,true)`, normalize/validate the complete payload, then invoke caller-scoped replay before creating data. Preserve all existing ownership/reference/coverage checks, including NULL elements, array dimensionality, and duplicate UUID handling. The new canonical payload includes a `contract_version:2` discriminator, all old normalized values, nullable metadata/dates, and sorted unique coverage UUIDs. Continue using operation `credential-created` in the existing receipt namespace so reuse across old/new create or clinician intents conflicts. Do not mutate an old receipt or infer equivalence across contracts. Different new request IDs still do not deduplicate similarly named records. The new entry must not call legacy create first: that would write a premature legacy receipt/audit before dates are assigned.

SQL date validation accepts only NULL/empty or exact four-digit-year/two-digit-month/two-digit-day text. Validate format/range, construct via `pg_catalog.make_date`, and catch only expected invalid-date/range exceptions as a safe `invalid` result with field errors. Unexpected database/transport faults remain unavailable/uncertain; do not swallow them as acknowledged validation failures. CHECKs independently protect elevated direct SQL writes.

The new success projection includes all original safe credential fields plus nullable issuer/jurisdiction and `current_cycle:{id,cycle_number,date_revision,end_date,action_deadline}`. Add `private.credential_details_projection`, composing the old projection with these fields. Replace only the list implementation's projection call; preserve list authorization, ordering, complete aggregation, and public signature. Old runtime schemas strip added list fields, while legacy create results remain exact.

For new detailed creates, pass this complete result to `private.finish_register_create`: its existing `credential-created` audit records the final details/cycle snapshot and actor/time; its receipt stores the normalized intent and complete immutable result. Derive tracking date/purpose in the application from persisted dates, not a separately posted value. New RPC `invalid` results may include an allowlisted safe field-error map; update repository parsing so date/metadata errors survive without leaking SQL text. All existing result states remain.

Update `registerInputSchema`, safe read/success schemas, `createRecord`, `registerInput`/`registerMessage`, operations, and `registerAction` in the existing files. Clinician creation stays unchanged. New credential inputs use detailed create even when every optional field is unknown. Strict schemas reject posted practice/actor/cycle/version/effective-date authority; FormData rejects duplicate scalar fields, files, and unknown keys. Detailed read schemas require the new nullable fields and a coherent initial cycle; do not default a malformed server response into unknown dates. Runtime schemas strip unexpected private metadata.

Reuse `CreateForm`'s request key and frozen FormData behavior. The dates/metadata must be part of the frozen payload, including NULL normalization. Uncertain saves disable changes and offer the exact-key retry. Acknowledged invalid results allow correction; success rotates the key and resets the form; conflicts/forbidden require review. Change credential success text to “Record saved.” Render saved dates immediately via the returned record; retain the current saved-record merge behavior and refresh. No broad record update path is introduced.

## Phase 1: Database contracts and migration compatibility

### Files and changes

- Add the CLI-generated migration under `supabase/migrations/` implementing metadata, cycles/backfill/trigger, parsers/projection, and detailed-create wrapper/implementation.
- Add `supabase/tests/practice_credential_dates.test.sql` and `tests/integration/practice-credential-dates.test.ts` for new contracts. Extend existing `supabase/tests/practice_register.test.sql` and `tests/integration/practice-register.test.ts` only where list projections/snapshots legitimately changed.
- Regenerate `src/lib/supabase/database.types.ts` from the local public schema.

### Automated verification

Replay only on the guarded dedicated local fixture stack, then run narrow SQL/API tests and inherited suites. Witness:

1. All three types/both owners, shared policy with two clinicians and exactly one cycle, empty metadata, both dates unknown, end-only, action-only, and both known with strict ordering.
2. Leap-century cases (2000-02-29 valid, 1900/2100-02-29 invalid), month/day/year boundaries, years 0001/9999, malformed text, whitespace, NULL/empty, timestamp strings, infinity, overrange/BC dates, and real bounded-text normalization. A later/equal action date fails without writing any row.
3. Cycle composite FKs, uniqueness, revision/range/order CHECKs, tenant SELECT isolation, anonymous/outsider/revoked denial, viewer reads, direct DML/private helper denial, and safe wrappers. Use a real issued token after revocation.
4. Same-key sequential/concurrent retries create one credential/cycle/coverage/audit/receipt. Equivalent metadata normalization and sorted coverage replay. Changed issuer/jurisdiction/date/type/owner/coverage or old/new contract reuse conflicts; another actor cannot replay the caller's receipt.
5. Inject trigger/cycle insert/cycle update/coverage/audit/receipt failures and compare complete before/after register row sets. Restore faults, then same-key retry succeeds. Audit dates exactly match the committed cycle.
6. Queue detailed creation behind the practice lock, demote/revoke, release, and require denial. Independently witness the lock wait with still-valid authority, then success.
7. Original create/clinician RPC signatures, payloads, stored results, and audit snapshots remain exact. Extended list comparisons explicitly project legacy fields for old-result expectations while separately asserting cycle contents.

Commands: `npm run db:reset`, `npm run test:db`, `npm run test:integration -- tests/integration/practice-credential-dates.test.ts tests/integration/practice-register.test.ts`, and `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests`; then inherited integration suites and generated-type comparison.

### Manual verification

Review complete migration, execution/table grants, composite FK/null behavior, lock ordering, strict parsers, initial cycle trigger, and audit/receipt boundaries. Confirm no fake date or historical receipt rewrite occurs.

Exit: AC1–AC9 persistence invariants have real SQL/API witnesses; AC11 legacy create compatibility holds.

## Phase 2: Domain validation, projections, and action boundary

### Files and changes

- Add `src/lib/register/dates.ts` and `dates.test.ts`; update `src/lib/register/schema.ts`, `properties.test.ts`, `repository.ts`, `operations.ts`, `messages.ts`, and `src/app/practice/register/actions.ts`.
- Extend `tests/unit/register-operations.test.ts` and `tests/unit/register-actions.test.ts` for nullable normalization, exact new RPC argument binding, safe invalid field errors, and cycle projections.

### Automated verification

Run `npm test -- src/lib/register tests/unit/register-operations.test.ts tests/unit/register-actions.test.ts`, then everyday type/lint/unit checks. Cover strict date formats and actual calendar validity; Unicode metadata boundaries; forged/duplicate/file/extra fields; all unknown/known combinations; ordering errors; effective date/purpose; deterministic date display in UTC and negative/positive-offset runtime timezones; authentication/access failures; malformed/missing cycle data; private-field stripping; generic failure recovery; and clinician-create regression.

Properties independently generate real calendar days and invalid adjacent boundaries. Assert canonical string preservation, earlier-deadline selection, absent effective date for both unknown, and same input under different practice timezone values. No reminder schedule arithmetic is claimed. Production date validation must not call JavaScript Date constructors; tests may use an independent calendar oracle with explicit year handling.

### Manual verification

Review normalized payload equality, output shapes, error allowlists, and messages. Confirm new read schemas fail closed while legacy RPC projections/receipts remain untouched.

Exit: AC2–AC6/AC8 application rules match the SQL contract with independent witnesses.

## Phase 3: Record entry and saved-date presentation

### Files and changes

- Update `src/components/register/credential-form.tsx` for type-specific labels, optional metadata/date fields, unknown help text, earlier-deadline explanation, and explicit type-switch resets.
- Update `src/components/register/register-panel.tsx` to show metadata, both date purposes, unknown end-date flags, and “Tracking date: … (earlier action deadline / expiration / coverage end).” Both unknown shows “Dates not entered.” Keep “Text reminders are not active yet.”
- Reuse `src/components/register/create-form.tsx` error/focus/freeze/reset mechanics; modify it only if a required recovery/accessibility test proves an adjustment is needed. Avoid unrelated styling or clinician-form changes.
- Extend `tests/unit/register-forms.test.tsx`, `tests/unit/routes.test.tsx`, and `tests/e2e/practice-register.spec.ts`; add `tests/e2e/practice-credential-dates.spec.ts`. Include cycles in register snapshot helpers.

### Automated verification

Verify creation/reload/sign-in for all types and date combinations; one shared policy/cycle; viewer read-only data; explicit unknowns on legacy records; type switches clear inappropriate metadata/dates; owner changes preserve dates; validation retains draft and links/focuses errors; acknowledged success resets fields/key; pending/uncertain blocks edits.

Abort a real detailed-create response after commit, then retry and require complete row-set equality, including cycle, metadata, dates, audit, and receipt. Repeat a pre-commit cycle failure followed by retry. Verify stale demotion/revocation, real read outage/missing-cycle error, no fabricated empty/unknown state, private/no-store responses, and foreign-Origin rejection without writes.

Run Axe/keyboard checks at 375px and verify no horizontal overflow. Render leap-day and year-boundary dates under differing browser timezones without a day shift. Build the production-local app and run `npm run test:e2e -- tests/e2e/practice-register.spec.ts tests/e2e/practice-credential-dates.spec.ts`, then all inherited browser tests.

### Manual verification

Inspect desktop/mobile entry, date validation, end-only/action-only/missing dates, shared policy, viewer, and uncertain-save states. Confirm “tracking date” never implies a scheduled text or legal standing. Record agent inspection separately from user acceptance.

Exit: AC10/AC12 pass and existing navigation, clinician entry, ownership, and coverage remain usable.

## Phase 4: Upgrade rehearsal, fault controls, and evidence

### Files and changes

- Add `tools/credential-dates-upgrade.mjs`, following `tools/register-upgrade.mjs` and `tools/local-environment.mjs` guards, with baseline migration `20261006180010`.
- Seed two practices with all historical access/recipient data plus clinicians, all credential types/owners, multi-clinician policy coverage, and creation audit/receipts. Snapshot all 12 pre-story application tables and their catalog. Apply the new migration in a transaction then deliberately fail: rows and all nine catalog sections must match after rollback.
- Apply normally; compare every original column value in credentials and require new issuer/jurisdiction NULL. Compare the other 11 tables completely, including immutable receipts/audits. Exactly one unknown initial cycle per existing credential is the only business-row backfill. Require unchanged old values/versions/timestamps, unchanged historical replay results, legacy creates establishing a cycle, and new detailed creates with one final audit/receipt. Compare upgrade schema to a fresh full replay and restore the local stack in cleanup.
- Expand all seven filtered public-table catalog sections in `tools/schema-catalog.mjs` for `credential_cycles`; record/review `tools/schema-contract.json` via `tools/schema-fingerprint.mjs`. In `tools/gauntlet-controls.test.mjs`, import `assertSchema` from `gauntlet-contract.mjs`, add a positive identical-schema comparison, and prove removal assertions fail through the comparator rather than a ReferenceError. Then extend section-inclusion, protection-removal, and trigger/function checks for cycles.
- Extend `tools/foreign-key-controls.mjs` with the new TAP file/exact assertion inventory and missing FK/unique/date CHECK/grant/trigger controls. Extend `tools/sql-mutants.mjs` with actual faults for date ordering/parsing, effective-date presentation witnesses where applicable, cycle initialization, tenant read isolation, detailed-create post-lock authority, audit/receipt atomicity, and new-payload date comparison. Each must apply, execute named tests, fail by behavioral assertions, and restore independently.
- Add `dates.ts` to both Stryker configurations; include date properties in `vitest.properties.config.ts` if separated from the existing register property file. Preserve inherited 100% mutation and complete executable-line coverage gates in `tools/check-coverage.mjs`.
- Add `credential-dates-upgrade` to `tools/layers.json` before replay and to `tools/gauntlet.mjs:requiredLayers`. Preserve every inherited layer; expected total is 31. Existing E1/E2-S1 upgrade rehearsals must still pass with the new migration included.
- Update `README.md` after implementation with actual date-entry scope, unknown existing-record behavior, inactive SMS, verification results, and E2-S3 next. Store actual acceptance/commands/evidence under `thoughts/shared/research/` and update implementation progress in this plan.

### Automated verification

Use Node 24.21.0 and run narrow phase checks first. Destructive/reset/fault/replay tools run sequentially only against the guarded dedicated local fixture stack.

| Command | Required implementation result |
| --- | --- |
| `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` | New and inherited checks pass. |
| `npm run db:reset`, `npm run test:db`, `npm run test:integration` | Replay, complete TAP inventory/controls, and real API behavior pass. |
| `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests` | SQL passes. |
| `node tools/credential-dates-upgrade.mjs` | Populated E2-S1 preservation, receipt compatibility, cycle backfill, rollback, and replay pass. |
| `node tools/schema-fingerprint.mjs`, `node tools/check-generated-types.mjs` | Reviewed expanded schema/types match replay. |
| `npm run test:controls`, `npm run mutation`, `npm run mutation:properties`, `node tools/sql-mutants.mjs` | New/inherited controls execute, catch their faults, and restore. |
| `npm run build`, `npm run test:e2e` | Production-local new and inherited browser paths pass. |
| `npm run gauntlet` | All 31 required layers pass against the actual committed implementation source. |

The gauntlet requires a clean implementation checkpoint through `tools/source-state.mjs`; preserve that gate. Resolve any necessary checkpoint authorization during implementation within the then-current user request. No checkpoint, local DB reset, deployment, or implementation test is part of this planning-only turn.

### Manual verification

Review final diff, migration/backfill, full control restoration evidence, and actual acceptance witnesses. Report commands/results, unrun checks, and limitations separately from manual acceptance.

Exit: AC11 and all new/inherited gates pass; delivered documentation agrees with actual behavior.

## Risks and rollback considerations

- A signature/projection rewrite can invalidate retries. Keep legacy create payload/result contracts exact; use the new named detailed RPC and discriminator. Older open app sessions may require a normal refresh after a Next.js deployment; database compatibility is not a promise about obsolete server-action identifiers.
- Nullable column addition changes `SELECT *` row shape. Preservation compares original credential columns plus new NULL metadata, not misleading raw old/new whole-row equality. Existing private audit/receipt row sets remain fully identical.
- Cycle backfill and trigger are intentional additions. Missing trigger/cycle rows must fail new reads; no guessed-date fallback. Never create cycles by coverage fan-out.
- An action-only record has a known tracking date and unknown end date; keep both facts visible. No future/date-only rule should erase past inventory or silently normalize impossible dates.
- New application/schema rollout is migration-first. For a later authorized production release, apply the reviewed additive migration, verify old data/replays/catalog and the cycle count, then promote the new app. Read-only hosted checks supplement local SQL/API/browser tests; do not claim authenticated hosted acceptance without running it.
- Application rollback to E2-S1 preserves new columns/cycles/receipts. Old creates continue generating unknown cycles, and the old interface can read the expanded list. New detailed records remain in storage even though the old interface does not present their dates. Prefer forward repair; never drop cycles/metadata or reset production to roll back.
- Calendar, date editing, job invalidation/catch-up, and renewal completion remain future work with their own verification gates. Having a date revision and cycle ID does not implement those behaviors.

## Completion criteria

AC1–AC12 have named source/test witnesses; each phase passes its exit criteria; the diff is reviewed; all 31 required implementation layers pass; and evidence records actual commands, preservation, recovery, and manual-verification boundaries. New records carry authoritative or explicitly unknown dates and type-specific metadata. E2-S3 is next.

## Implementation progress

- [x] Phase 1: Database contracts and migration compatibility.
- [x] Phase 2: Domain validation, projections, and action boundary.
- [x] Phase 3: Record entry and saved-date presentation — automated checks and agent inspection complete.
- [x] Phase 4: Upgrade rehearsal, fault controls, and evidence — automated checks and agent inspection complete.
- [ ] User-confirmed manual acceptance, separate from automated/agent verification.

Final evidence: `thoughts/shared/research/2026-10-06-e2-s2-implementation-evidence.md`.
Run `d474a1b4-2df3-4aef-83e7-49192e87ce3c` passed all 31 layers against source commit `411ab8dc0cf4fbe7ecea2e378a4449e2361a2838`, source hash `00cde850b87a2264c774ab1ca7c3c174090e467737ed73546a2e8d8ac58664ab`. No hosted release was performed.
