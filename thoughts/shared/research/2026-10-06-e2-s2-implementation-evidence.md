# E2-S2 implementation evidence

Date: 2026-10-06. Status: implementation complete; full source-bound verification in progress.
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

Pending. Results, source identity, mutation scores, executable coverage, inventories and final inspection will be recorded after all 31 required gauntlet layers pass. Ignored `reports/` and `coverage/` hold generated evidence; the final source checkpoint is required by `tools/source-state.mjs` and will not be bypassed.

## Remaining boundaries

Existing credentials receive no invented dates; filling them/editing/archiving is E2-S3. Calendar, successor cycles, phone/SMS jobs, catch-up and scheduling remain future stories. All destructive fixture resets/faults were restricted to the exact loopback project with fixture-only accounts. Hosted E2-S1 pilot state remains unchanged.
