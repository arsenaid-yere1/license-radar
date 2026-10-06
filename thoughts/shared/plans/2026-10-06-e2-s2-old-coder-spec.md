# SPEC — E2-S2 authoritative dates and issuer/jurisdiction

Date: 2026-10-06 (America/Los_Angeles).
Tier: **3**, because this changes persisted public contracts, tenant authorization, atomic creation, recovery, and migration behavior.
Baseline: `93f058bdd31f0a9cbbcdebb8b397a90c6708a478`.
Plan: `thoughts/shared/plans/2026-10-06-e2-s2-authoritative-dates.md`.

## Authorization and setup

User instruction: **“add specs and implement it”**. Proceed autonomously with the verified E2-S2 plan. Separate SPEC approval before implementation: **not obtained (autonomous run)**. Evidence must state this limitation; the implementation request authorizes the work, not independent review of this newly written contract.

- Isolation: new local branch `codex/e2-s2-authoritative-dates` in the existing checkout, retaining pinned ignored tools/caches. No remote push, merge, hosted migration, or deployment.
- New dependencies/tools: **none**. Reuse repository Node 24.21.0 (`.tools/node/bin`), npm, Supabase/PostgreSQL/Docker, Vitest/fast-check, Playwright/Axe, SQLFluff, Stryker, and Gitleaks.
- Local setup: reuse/start the dedicated fixture stack and generate ignored fixture environment through the existing guarded tool. Resets/upgrade/fault runs are sequential and require exact project, loopback ports, and fixture-only accounts. Never print private status keys.
- Git: retain existing history. Create local specification and implementation checkpoints as necessary for `tools/source-state.mjs` and the source-bound final gauntlet. Commits are local and reversible; do not push or alter production.
- New source: `src/lib/register/dates.ts`; CLI-generated additive migration under `supabase/migrations/`. Extend existing register schema/repository/messages/actions/form/list; keep clinician behavior and legacy create signatures/results unchanged.
- New verification: `src/lib/register/dates.test.ts`, `supabase/tests/practice_credential_dates.test.sql`, `tests/integration/practice-credential-dates.test.ts`, `tests/e2e/practice-credential-dates.spec.ts`, `tools/credential-dates-upgrade.mjs`. Reuse/extend register properties/unit/browser tests, schema catalogs/contracts, FK/SQL faults, Stryker/property lists, and gauntlet inventories. Fix the documented schema-control missing import with a positive witness.
- Durable artifacts: this SPEC, plan/review/research, and `thoughts/shared/research/2026-10-06-e2-s2-implementation-evidence.md`. Generated evidence stays in ignored `reports/` and `coverage/`.

## Failure model

| Failure | Defense/witness |
| --- | --- |
| Impossible/ambiguous dates accepted or display shifts a day | Strict lexical/Gregorian/range validation in application and SQL; properties; differing browser timezones. |
| Unknown date becomes an invented regulatory date | Nullable dates, explicit unknown UI, action-only/end-only tests and unknown-cycle backfill. |
| Earlier action deadline hidden or later than expiration | Strict ordering errors; both separately labeled; independently asserted effective-date selection. |
| Shared policy dates duplicate per covered clinician | One credential/initial cycle, coverage cardinality tests. |
| Partial metadata/cycle/link/audit/receipt commits | One transaction, induced insert/update/audit/receipt faults, full snapshots. |
| Lost response duplicates creation or old receipts change | Same-key concurrent/post-commit browser retry; unchanged legacy RPC snapshots; migration replay. |
| Another tenant or stale manager reads/writes | RLS/composite FKs, live post-lock authority, old-token and queued demotion tests. |
| Upgrade corrupts prior inventory/history | Populated 12-table baseline, original-column preservation, full rollback/schema replay. |
| Verification falsely passes missing protections | Fix unimported comparator, positive identical-schema test, actual removed-defense faults and restored schema. |

## Observable contract

All three current types and both owner kinds remain supported. Optional issuer/jurisdiction are normalized to NULL or 1–120 Unicode code points; type labels are Licensing board/State or territory, Issuing authority/Registration jurisdiction, and Insurer/Coverage jurisdiction. No issuer is auto-confirmed.

Dates are NULL or strict `YYYY-MM-DD`, years 0001–9999, with real Gregorian validity. NULL/omitted/empty means unknown; nonempty whitespace or other formats fail. Expiration/end date and action deadline are separate. Action-only is allowed; when both exist the action deadline must be strictly earlier. Past/today/future dates are accepted. Effective tracking date is action deadline, otherwise end date, otherwise absent. Date display has no timezone conversion.

One initial cycle (number/revision 1) exists per credential. Backfill contains only NULL dates. Detailed create atomically saves metadata/dates/coverage and its complete final audit/receipt. Original seven-argument create and historical receipt payload/result/audit shapes remain exact. New named detailed create uses contract discriminator 2 and the existing caller/practice/key namespace; old/new key reuse conflicts. New reads require coherent cycle data; malformed/missing data is unavailable, not unknown.

Messages remain the existing safe contract except new credential success is **“Record saved.”** Date validation is **“Enter a valid date (YYYY-MM-DD).”** Ordering is **“The action deadline must be earlier than the end date.”** Both unknown remains **“Dates not entered”**; unknown end is type-specific **“Expiration date unknown”** / **“Coverage end date unknown”**. Texts remain **“Text reminders are not active yet.”** No legal validity or scheduled notification is asserted.

## Named scenarios

Each D/P/A/N row maps to actual executable witnesses or an explicit unverified boundary in final evidence.

| ID | Input/action | Expected observation |
| --- | --- | --- |
| D01 detailed type/owner creation | All three types, practice/clinician, issuer/jurisdiction, end `2028-02-29`, action `2028-02-01` | Canonical metadata/dates and one cycle number/revision 1; final audit matches saved projection. |
| D02 unknown and action-only dates | Both empty, end-only, action-only | NULL remains NULL; action-only tracks action while flagging unknown end; no inferred dates. |
| D03 real date validity | `2000-02-29`, `0001-01-01`, `9999-12-31` versus `1900-02-29`, `2100-02-29`, `2026-04-31`, year zero, timestamp/whitespace/infinity | Valid strings persist exactly; invalid fields return invalid with no writes. |
| D04 strict earlier deadline | End `2026-12-02`, action `2026-12-01`, equal or later | Earlier succeeds; equal/later produces action field error without rows. |
| D05 metadata and ownership boundaries | Trimmed/blank/120/121-codepoint metadata; foreign/NULL/repeated coverage | Canonical valid text or NULL; malformed/foreign/ineligible inputs rejected. |
| D06 same-key retry/conflict | Identical concurrent requests, reorder coverage, change any metadata/date | One credential/cycle/link-set/audit/receipt; exact successes or request-conflict; other caller cannot replay. |
| D07 atomic failures | Trigger/cycle insert/cycle update/coverage/audit/receipt faults | Every register table unchanged; restoring fault permits exact-key retry. |
| D08 live authority and lock | Queue detailed create, demote/revoke; separate still-valid lock witness | No write after authority loss; valid request visibly waits then succeeds. |
| D09 legacy API | Original RPC creation/replay, extended list | Exact legacy shape/result/audit; one unknown cycle; added list fields strip under old schema. |
| D10 schema protections | Direct foreign cycle, range/ordering/revision/unique violations and denied DML/helpers | Restrictive tenant FKs/CHECKs/uniqueness and grants enforce invariants. |
| D11 domain/action boundary | Forged cycle/practice/revision/effective fields, duplicate scalars/files, malformed projections | No unintended write; useful safe field errors; malformed response unavailable; no private metadata. |
| D12 form recovery/switches | Date validation, switch type/owner, acknowledged save | Draft retained/error associated; type clears metadata/dates; owner preserves dates; success rotates/reset. |
| D13 uncertain detailed save | Abort actual response after commit, retry unchanged | Every metadata/date/request field frozen; full persisted row sets identical; one visible record. |
| D14 persistence/access/display | Reload/sign-in, viewer, different browser timezones, keyboard/Axe at 375px | All date purposes survive with no day shift; unknown states explicit; viewer has no creation controls. |
| D15 read fault | Missing cycle or real list outage | Safe error, never fabricated empty register or guessed unknown dates. |
| D16 populated upgrade | 12-table E2-S1 fixture, failed then successful migration, legacy replay, fresh replay | Full rollback; original values/history exact; metadata NULL and one unknown cycle per credential; schema matches. |
| D17 checker soundness | Identical schema and deliberately removed protection | Positive comparator passes; negative rejects from real comparator, not ReferenceError; fault restores. |
| P01 Gregorian dates | 1,000 seeded valid days/invalid neighbors, century boundaries | Acceptance agrees with independent calendar oracle, canonical date round-trip. |
| P02 effective-date and metadata | 1,000 seeded unknown/known/ordered pairs and text boundaries | Both acceptance/rejection bounds and effective-date purpose agree; normalization stable. |
| A01 tenant/role attacks | Anonymous/viewer/outsider/revoked token, direct table/private helper | Unauthorized access denied; cross-tenant reads empty and references rejected. |
| A02 hostile form/API | Forged authority, malformed scalar/Unicode/date/coverage, markup | Safe invalid/error, no authority transfer/partial writes; text escaped. |
| A03 network/origin | Foreign-Origin actual detailed POST; post-commit lost response | Origin rejected without writes; exact normal retry resolves once. |

## Must NOT

| ID | Invariant/witness |
| --- | --- |
| N01 | No legacy receipt/result rewrite or changed original create signature; legacy/upgrade exact comparisons. |
| N02 | No guessed dates/issuer or policy fan-out; NULL backfill/cardinality/UI tests. |
| N03 | No credential editing, archiving, successor cycle, calendar, SMS jobs/provider/enrollment or legal-validity claim; schema/capability/UI scope review. |
| N04 | No stale/posted authority or direct cycle writes; real role/tenant/lock/grant fault tests. |
| N05 | No partial/duplicate creation; transaction snapshots and retries. |
| N06 | No inherited practice/team/join/recipient/clinician regression; all inherited tests/upgrades. |
| N07 | No dependency/secrets/admin-client keys/browser draft storage/capability expansion; supply-chain/capability/secrets/diff gates. |
| N08 | No hosted reset/deletion/deployment/push; guarded local fixture work and local source-state checkpoints only. |
| N09 | No weakened/skipped gates or invented evidence; exact 31-layer inventory, fresh source-bound results, independent property mutation, full restoration. |

## Verification and completion

Execute RED → GREEN → REFACTOR and preserve observed named failures. Already-green new behaviors require an applied behavioral fault. Assertions change only for documented contract additions, not to accommodate implementation defects. Final reproducible command is `npm run gauntlet` with all 31 required layers; retain inherited 100% mutation and complete executable-line gates. Use the pinned runtime and persist actual IDs/counts/failures/source identity in evidence.

The final evidence maps all rows to tests/layers, identifies unavailable/unverified checks, and separates automation, agent inspection, and user acceptance. Independent fresh-context implementation verification is **not performed** unless its protocol is separately invoked; earlier plan review is not implementation verification. User manual acceptance remains unchecked.

## Revisions

- 2026-10-06 — Initial SPEC before implementation, per “add specs and implement it.” Documents autonomous review limitation, local branch/checkpoint setup, failure model, concrete scenarios, and inherited/future boundaries.

- 2026-10-06 — Executable contract revisions: add nullable canonical input/read fields and cycle snapshots, new detailed RPC binding and save message; preserve exact legacy creation results. New date oracle uses 3,000 cases, ordered/unknown/metadata properties 1,000. Existing focus witness waits for the effect; paragraph selectors account for semantic time children. Fixture-only auth and revocation timestamps corrected. Full negative SQL inventory records the correlated cycle-number/uniqueness failures and isolates trigger metadata while actual API mutants witness initialization failure.
