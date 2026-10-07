# E2-S3 register maintenance research

Date: 2026-10-06 (America/Los_Angeles).
Baseline: `27b728b4578a96d526e7fd25cf8f385284856e3c`.
Scope: current implementation and constraints for the next story; no runtime changes.

## Story selection and repository boundaries

`README.md:Planned workflow` explicitly names E2-S3 next. The E2 table in `thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md` specifies editing/archive, suspected duplicates, unsent-job updates/cancellation, and retained audit history. Its original empty-workspace observations are historical. `thoughts/shared/handoffs/2026-10-06-e2-s2-production-release.md` records the completed date-entry release, all 31 verification layers, and the separate unconfirmed hosted authenticated/manual acceptance boundary. Those release checks were not rerun here.

The repository is one Next.js/React/TypeScript application, not a multi-package monorepo. `src/app/` owns routes/actions; `src/components/` owns UI; `src/lib/` owns validation, authority lookup, and persistence; `supabase/` owns database invariants and migrations; `tests/` and `tools/` own verification; `thoughts/shared/` owns durable research/plans/evidence. No local AGENTS file or existing graph was found in the inspected inventory; chat-supplied repository instructions apply.

## Existing behavior

- `src/lib/register/schema.ts:registerInputSchema` is a strict create-only discriminated union. Normalization trims bounded names, lowercases UUIDs, sorts unique coverage IDs, maps blank optional metadata/dates to NULL, and rejects contradictory ownership, incompatible coverage, and incorrectly ordered dates. `credentialSchema` requires a coherent initial cycle number 1; it has no archive or duplicate state.
- `src/lib/register/dates.ts:isCredentialDate`, `trackingDate`, and `detailLabels` supply date-only validation, earlier-deadline precedence, and type-specific meanings. Preserve these rules for edits, including unknown, historical, and action-only dates.
- `src/lib/register/operations.ts:createRegisterRecord` verifies authentication and live practice access before validation. Administrators/managers can create; viewers cannot. `src/lib/register/repository.ts:createRecord` uses the detailed creation RPC; `getRegister` uses the original list RPC and fails closed on malformed results.
- `src/app/practice/register/actions.ts:registerAction` parses FormData, redirects expired authentication, and returns safe messages. `src/app/practice/register/page.tsx:PracticeRegister` is dynamic, derives practice authority, loads the register, and supplies independent creation request keys.
- `src/components/register/create-form.tsx:CreateForm` freezes the entire FormData/request key on uncertainty, blocks field changes, retains validation drafts, rotates the key on acknowledged success, and refreshes. `CredentialFields` in `credential-form.tsx` is private and starts empty. Type changes reset metadata/dates via a keyed subtree; owner changes preserve them while clearing incompatible clinician/coverage selections.
- `src/components/register/register-panel.tsx:RegisterPanel` overlays newly created records. Its `merge` never replaces an existing ID. That works for creation but cannot represent edits or an archive tombstone. It displays dates and unknowns and explicitly says texts are inactive.

## Database contracts

`supabase/migrations/20261006180010_register_ownership.sql` defines clinicians, credentials, coverage, immutable create receipts, and private register audits. `private.require_register_member` locks the practice before consulting active membership. Public RPCs are invoker wrappers over checked private definer entries with empty search paths. Client SELECT is tenant-scoped; direct DML and ordinary access to receipts/audits/helpers are denied.

Credentials have an integer `version`. The composite `policy_coverage_credential_fkey` includes credential type and owner kind, with restrictive deletion. An edit switching a shared policy away from practice-owned malpractice must delete its old coverage rows before changing those discriminator columns, then insert the final eligible set within the same transaction.

`private.register_replay` scopes receipts by practice, actor, and request key, returning the immutable original response after authority checking. Creation remains replayable even after later changes. Do not rebuild old receipts from current data. `private.finish_register_create` supports only creation operations and NULL before-state. The existing audit operation/entity/before-state CHECKs must be explicitly expanded for credential updates and archives while preserving all historical rows and creation behavior.

`supabase/migrations/20261006225257_credential_dates.sql` adds optional issuer/jurisdiction, cycles, strict SQL date parsing, and the detailed create API. `private.initialize_credential_cycle` gives legacy and detailed creation exactly one initial cycle. `private.credential_details_projection` selects cycle number 1 and rejects missing cycles. `private.list_practice_register` currently returns all credentials. No edit/archive endpoints, lifecycle fields, duplicate matching, successor-cycle workflow, reminder jobs, outbox, scheduler, calendar, or SMS worker exist in the inspected source/migrations/generated public types.

The new story can implement the archive/revision foundation immediately. Actual unsent-job cancellation/replacement and accepted-message suppression remain dependencies of E4; inventing a dummy job table would not verify them. E3 must filter archived credentials before generating events; E4 must check archive state and date revision before scheduling/dispatch and transact changes with its real outbox.

## Verification patterns and compatibility

`tests/unit/register-operations.test.ts`, `register-actions.test.ts`, and `register-forms.test.tsx` witness derived authority, strict parsing, safe replies, frozen retries, type/owner switches, immediate saved display, and unknown-date presentation. `src/lib/register/properties.test.ts` and `dates.test.ts` cover normalization and date/ownership invariants.

`tests/integration/practice-credential-dates.test.ts` uses real authenticated API calls, snapshots six register tables, concurrent identical creation, practice-lock waits, post-lock demotion/revocation, direct-write denial, and injected failures in every write stage. `supabase/tests/practice_credential_dates.test.sql` has 22 catalog/constraint/audit assertions. `tests/e2e/practice-credential-dates.spec.ts` uses the production-local build, mobile Axe/keyboard checks, date rendering across browser timezones, real SQL faults, read failure, stale access, and foreign-Origin rejection.

`tools/credential-dates-upgrade.mjs` applies every migration after E2-S1, snapshots twelve historical tables, checks rollback/catalog equivalence, and replays old receipts. A separate E2-S2 baseline rehearsal must also include existing cycles, making thirteen historical application tables, with no new business-row backfill. The new receipt table starts empty. Existing upgrade rehearsals should still pass.

`tools/layers.json` and `tools/gauntlet.mjs:requiredLayers` independently require 31 layers. A maintenance upgrade rehearsal requires updating both inventories to 32. `tools/schema-catalog.mjs:schemaQueries` covers all six public tables plus all private tables across nine sections, so the new private receipt table is already in its schema filters. `tools/gauntlet-controls.test.mjs` now imports and exercises `assertSchema` correctly; the old missing-import finding is repaired.

`tools/foreign-key-controls.mjs` requires an exact TAP count and expected failures for each applied removal. `tools/sql-mutants.mjs` requires real applied faults, complete named behavioral-test inventories, assertion failures, and independent restoration. Both Stryker configurations include the register modules; the property configuration must include any new property files. Preserve the inherited 100% mutation and application executable-line coverage requirements.

## External guidance checked

Checked the official [database function documentation](https://supabase.com/docs/guides/database/functions) and [row-level security documentation](https://supabase.com/docs/guides/database/postgres/row-level-security). The plan follows existing uniquely named RPCs, constrained execution grants, checked private authority, and protected public tables. These pages support the platform conventions; proposed business behavior is a planning decision based on repository evidence. Fetching `https://supabase.com/changelog.md` failed with unsupported Markdown content type; relevant changes must be rechecked before implementation. No platform change is inferred from that failure.

## Checks performed

- `git status --short`: clean starting tree. `git rev-parse HEAD` and `git log -4 --oneline`: baseline and E2-S2 release sequence confirmed.
- `rg --files` and complete relevant source/history reads: next story, ownership boundaries, constraints, retry/UI behavior, and verification patterns confirmed.
- `npm test -- tests/unit/register-operations.test.ts tests/unit/register-actions.test.ts tests/unit/register-forms.test.tsx src/lib/register/properties.test.ts src/lib/register/dates.test.ts`: **5 files / 33 tests passed** against existing behavior.
- Planning document formatting and diff checks are recorded in the accompanying verification document after writing/review.

No database reset/mutation, implementation, commit, deployment, or new-story acceptance test ran. Planning uses the installed host runtime; implementation verification must use repository Node 24.21.0.
