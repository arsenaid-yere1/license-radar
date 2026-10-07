# SPEC — E2-S3 register maintenance

Date: 2026-10-06 (America/Los_Angeles).
Tier: **3** — concurrency, retained data, tenant authority, and public RPC compatibility.
Baseline: `27b728b4578a96d526e7fd25cf8f385284856e3c`.
Plan: `thoughts/shared/plans/2026-10-06-e2-s3-register-maintenance.md`.

## Authorization and setup

User instruction: **“create specs and implement it”**. Execute the verified E2-S3 plan autonomously. Separate pre-code SPEC approval: **not obtained (autonomous run)**; evidence must disclose this correlation limit. The user authorized implementation, not independent review of this new document.

- Isolation: local branch `codex/e2-s3-register-maintenance`, reusing the existing checkout's pinned ignored tools and fixture environment. Retain all current planning documents. No production changes or publication.
- Dependencies/tools: **none added**. Reuse Node 24.21.0 at `.tools/node/bin`, npm, Docker/local Supabase, PostgreSQL, Vitest/fast-check, Playwright/Axe, Stryker, SQLFluff, and Gitleaks, pinned in `tools/toolchain.json`.
- Setup: prepare/reset only the dedicated guarded fixture stack at existing loopback ports/project. Never output keys or personal data. Run database resets/upgrades/faults sequentially.
- Git: local specification and implementation checkpoints as necessary for the existing clean-source gauntlet; no push, merge, force operation, or deployment. Runtime source is recorded by `tools/source-state.mjs`.
- New runtime: CLI-generated migration under `supabase/migrations/`; `src/components/register/edit-record-form.tsx`, `archive-record-form.tsx`, and an initial-values-capable `credential-fields.tsx` extraction. Extend existing register schema/domain/repository/messages/actions/page/list. A small shared form component may live in the edit module; no generalized form framework.
- New witnesses: `supabase/tests/practice_register_maintenance.test.sql`, `tests/integration/practice-register-maintenance.test.ts`, `tests/e2e/practice-register-maintenance.spec.ts`, `tools/register-maintenance-upgrade.mjs`; extend existing unit/properties/schema/SQL fault/control inventories. Preserve all inherited gates and add exactly one upgrade layer (32 total).
- Artifacts: this SPEC and `thoughts/shared/research/2026-10-06-e2-s3-implementation-evidence.md`; ignored `reports/` and `coverage/` contain actual machine results and RED history. No browser draft persistence.

## Failure model

| Failure | Executable defense |
| --- | --- |
| Concurrent edit overwrites another edit/archive | Aggregate version and cycle/revision checks, real competing API/browser sessions. |
| Uncertain response repeats a change or overwrites current state with old replay | Immutable caller-scoped mutation receipt, replay before freshness, postcommit retry and version-aware UI tests. |
| Metadata/coverage/date/audit/receipt partially commit | Single transaction, faults at each insert/update/delete stage, complete row-set snapshots. |
| Shared-policy type/owner switch violates or leaves stale coverage | Ordered coverage deletion/update/insertion, restrictive composite FKs, rollback witnesses. |
| Archive loses history or reappears after refresh | Persisted archive state, no deletion, active-filtered legacy/new reads, UI tombstones. |
| Another tenant/stale manager reads or writes | Live role after practice lock, RLS/tenant FKs, anonymous/outsider/queued demotion/revocation/private-write attacks. |
| Date revision misses changed underlying date or increments for metadata/no-op | Exact cycle/credential row comparisons, NULL transitions and unchanged tracking date witnesses. |
| Duplicate warning blocks legitimate data or leaks another tenant | Advisory matching, NULL-safe ASCII folding, owner/type/metadata boundary and cross-tenant fixtures. |
| Upgrade corrupts historic dates/receipts | Populated thirteen-table preservation, full rollback/catalog equivalence, legacy replay after edit/archive. |
| Checker silently skips protection/fault/test | Exact inventories, actual applied negative controls, required assertion failures, independently restored schema and 32-layer gate. |

## Observable contract

Updates post full existing authored fields plus target, request key, expected credential version, expected cycle ID and expected date revision. Canonicalization, strict Gregorian dates, ownership/coverage restrictions, and unknown/historical/action-only dates remain unchanged. All expected tokens are strict positive bounded integers/UUIDs; posted authority/effective dates/archive timestamps are rejected.

Changed edits increment credential version once. Either date changing increments date revision once on the same initial cycle, even if effective tracking date stays unchanged. Metadata-only updates leave the cycle entirely unchanged. Normalized no-ops save a `changed:false` receipt without business-row/time/version/audit changes. Integer exhaustion conflicts only if an increment is needed.

Archive has named-record confirmation, sets database-clock `archived_at`, increments credential version once, and preserves coverage/cycle/all previous audits/receipts. Default/legacy lists exclude archived credentials; explicit archived view is readable by active members, with no edit/restore actions. New requests to archived records return `archived`; exact successful replay returns original result. Foreign/missing target returns indistinguishable `not-found`; missing actual cycle is unavailable. Conflict returns safe current values for comparison, preserves blocked draft, and requires explicit replacement with saved values before reentry.

Each changed mutation writes complete safe before/after audit and immutable result receipt atomically. Mutation keys share a new practice/actor/key namespace separate from unchanged creation receipts. Same key/payload retries return original result, before checking now-stale versions/references; changed valid payload/operation under the key returns `request-conflict`. Authority is always checked first. Historical create results remain exact after changes and never restore data. No failure receipts are persisted.

Duplicates are advisory pairs of distinct active same-practice records with equal type, owner kind/clinician ID and trim/ASCII-case-normalized title/issuer/jurisdiction (NULL-safe). Dates/coverage do not affect suspicion. Sorted candidate IDs are live read data, not receipt contents. Different owner/type/metadata/title, archived records and another tenant are excluded. Review links show existing saved summaries; no blocking/merge/deletion/dismissal persistence.

Drafts/frozen payloads live in the current page session. Pending/uncertain mutations freeze fields, in-form cancel/intent and view switching. Feedback instructs retry before leaving; browser navigation remains possible. Success refreshes current data; highest-known versions/archive tombstones prevent older replies/refreshes resurrecting records. Separate creation schemas remain compatible with old receipts. All feedback, date purposes and unknowns are keyboard/mobile accessible. Texts remain **“Text reminders are not active yet.”**

## Named scenarios

| ID | Concrete action | Expected result |
| --- | --- | --- |
| M01 correction | Edit each type/owner, issuer/jurisdiction/title, coverage | Correct full canonical record, same ID/cycle, version 1→2, one before/after audit. |
| M02 dates | End `2028-02-29`→`2028-03-01`, action remains `2028-02-01`; known/NULL transitions | Version and date revision +1 once; tracking remains action; no guessed date. |
| M03 metadata/no-op | Change title only, reorder identical coverage, trim equivalent text | Title-only leaves cycle identical; normalized no-op leaves all business/audit rows identical, one `changed:false` receipt. |
| M04 freshness | Wrong version/revision/cycle; two simultaneous different edits | Conflict/current safe snapshot with no writes; exactly one concurrent winner. |
| M05 archive | Confirm active shared policy; retry; request new archive/edit | One archive audit/receipt, cycle/coverage unchanged, active reads omit, archived reads retain, replay exact, new requests `archived`. |
| M06 replay | Concurrent identical requests, changed valid payload/intent, another caller, later edit/archive | Once-only write; canonical replay exact; conflicting payload rejected; caller isolation; historical results unchanged. |
| M07 rollback | Fault credential/cycle/coverage delete/insert/audit/receipt | Complete snapshots unchanged; restoring fault permits exact retry. |
| M08 authority/locks | Queue writes/replay then demote/revoke; anonymous/viewer/foreign IDs | Denial before data/validation/replay, no partial writes, valid requests visibly wait. |
| M09 schema | Remove private receipt FK/unique/audit/grant/RLS/function defense | Exact SQL/control assertions catch actual removal and restore; direct writes/helpers/private data denied. |
| M10 duplicate pairs | Same title case/trim with changed dates/coverage versus differing owner/type/metadata/title | Only defined active same-practice pairs, sorted reciprocal IDs; saves allowed; edit/archive removes warnings. |
| M11 boundary | Forged fields, invalid dates/Unicode/tokens, repeated scalars/files, malformed reply | Safe invalid/unavailable; exact bound RPC args, no authority transfer/private leaks. |
| M12 UI | Prefilled edit/cancel; type warning; owner switch; validation; conflict reload | No write on cancel; intentional resets; draft/error association; blocked comparison and explicit fresh baseline. |
| M13 uncertain UI | Lost real edit/archive response after commit; precommit fault then retry | Frozen exact request; one persisted mutation; no resurrection on stale refresh. |
| M14 access/persistence | Active/archived reload/sign-in, viewer, 375px Axe/keyboard, differing browser zones | Saved records/history accessible by role, no viewer maintenance controls, no date shifts or overflow. |
| M15 reads/origin | Missing cycle/list outage; foreign-Origin real maintenance POST | Safe read error, no fake empty/duplicate-clear state; Origin denied without writes. |
| M16 upgrade | Populate thirteen prior tables; failed and successful migration; replay old/new | All old columns/history/cycles identical; new archive NULL/receipts empty; full catalog rollback/fresh replay equality. |
| M17 limits | Credential/date revision at 2147483647 | Needed increment conflicts with no writes; allowed no-op/metadata-only does not overflow irrelevant cycle revision. |
| P05 maintenance properties | Seeded strict tokens, authored combinations and dates | Accepted/rejected bounds, canonical round-trip and sorted coverage are independently asserted. |

## Must NOT

| ID | Constraint and witness |
| --- | --- |
| N10 | Do not rewrite old create signatures/projections/receipts or introduce duplicate-blocking uniqueness; legacy/upgrade/replay/API witnesses. |
| N11 | Do not delete/restorе/complete a credential or create a successor cycle; preservation/cardinality/schema/UI scope witnesses. |
| N12 | Do not add inferred dates, calendar, queue/outbox/SMS/provider/consent or claim cancellation happened; capability/schema/UI review. E3/E4 must later implement real event/job acceptance. |
| N13 | Do not regress practice/team/join/recipient/clinician/create workflows; inherited tests, four prior upgrade layers. |
| N14 | Do not add packages, host/browser-storage capabilities, secret/admin client exposure, production operations or publication; dependency/capability/secret gates and source diff. |
| N15 | Do not weaken/skіp checks or fabricate RED/green evidence; existing strict mutation/coverage gates, required 32-layer inventory and actual final source results. |

## Verification and completion

Execute RED→GREEN→REFACTOR per behavior; related named tests may share a run. Persist observed behavioral failures. Pre-existing already-green defenses get real negative-control witnesses. Final entry point: `npm run gauntlet` with all **32** layers on the pinned runtime and a clean source checkpoint. Preserve inherited 100% mutation and complete executable application-line requirements. Report fresh exact results, source identity, spec/test mapping, failed intermediate checks/fixes, and pending manual/hosted acceptance separately.

Independent fresh-context implementation verification: **not performed** unless its complete protocol is later invoked; static planning review is not implementation verification. No deployment is part of completion. User manual acceptance remains unchecked.

## Revisions

- 2026-10-06 — Initial SPEC, per “create specs and implement it,” before runtime changes. Declares autonomous-spec review limit, local setup/checkpoints, concrete scenarios, original scheduling dependencies and full verification contract.
