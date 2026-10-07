# EVIDENCE — E2-S3 register maintenance

Date: 2026-10-06 (America/Los_Angeles).
Status: implementation complete; final fresh gauntlet pending. This draft does not declare final verification complete.
Tier: 3 (tenant authority, concurrency, history, and compatibility).
SPEC: `thoughts/shared/plans/2026-10-06-e2-s3-old-coder-spec.md`; initial checkpoint `fbb6617`.
Plan: `thoughts/shared/plans/2026-10-06-e2-s3-register-maintenance.md`.
Baseline: `27b728b4578a96d526e7fd25cf8f385284856e3c`.

## Delivered behavior

Administrators/managers can edit the existing authored fields or explicitly archive a named credential. Updates retain the initial cycle and use aggregate version plus cycle/date revision freshness. Metadata-only changes preserve the cycle, date changes revise it once, and canonical no-ops write only an immutable receipt. Archives retain coverage, dates, cycles, audits, and receipts; active/legacy reads hide them and an explicit archived view preserves inventory. Separate creation and maintenance contracts keep historical creation receipts unchanged.

The UI retains blocked conflict drafts for comparison and replaces them only through **Reload saved values**, with fresh tokens/key. Uncertain requests freeze the full payload and in-form cancellation/view switching for exact retry. Highest-version overlays and archive tombstones prevent stale refresh/replies from restoring older known state; a fresh authoritative read is required before another edit. Suspected duplicates are advisory, scoped to active same-practice type/owner/title/issuer/jurisdiction, using ASCII case and trim normalization. SMS is inactive. E3 event exclusion and E4 outbox replacement/cancellation remain required future work, not executed job acceptance.

## Setup and RED history

Reused the existing checkout and ignored pinned fixture environment on local branch `codex/e2-s3-register-maintenance`. No dependency or tool upgrade was added. Node 24.21.0 is at `.tools/node/bin`; all commands use that runtime. The host Node 26 is not the tested runtime. Local resets/upgrades/faults use the exact guarded loopback Supabase project; no hosted mutation, deployment, remote push, or merge was performed.

The initial baseline unit run passed 217 tests. Before the maintenance migration, all 12 new real API tests failed by assertions. Before domain implementation, all 7 new domain tests failed by missing-export assertions; modules still collected. Before UI implementation, 4 new rendered-form scenarios failed on absent maintenance controls. Action/route RED history includes absent-action and changed-read-boundary failures; these are weaker than isolated behavioral assertions and are not represented as independent API RED. Names and observed counts are persisted in `tools/red-history.json:e2s3`.

New tests written after behavior existed are supported by executed negative controls/mutation, not invented pre-implementation RED claims. The final browser archive regression actually failed on repeated-success focus before its fix. SQL and UI controls require actual applied changes, named assertion failures, and verified restoration.

## Witness mapping

| SPEC | Concrete tests / persisted entry point |
| --- | --- |
| M01 correction | API “M01 M02 corrections of every type owner and dates retain one initial cycle”; “M01 M03 coverage replacement…”; browser M12 full edits; exact action RPC arguments in `tests/unit/register-maintenance.test.ts`. |
| M02 dates | API NULL/known/action-only/boundary transitions, unchanged earlier tracking deadline under changed end date, exact same cycle ID and revisions; browser corrected dates and contrasting-zone action-only case. |
| M03 metadata/no-op | Complete API business/audit/cycle row-set comparisons, canonical coverage reorder/no-op receipt, metadata cycle equality; real browser no-op snapshots. |
| M04 freshness | API concurrent winners and stale version/cycle/revision; two browser sessions with blocked draft/current comparison and explicit reload. |
| M05 archive | API six concurrent same-key archives, retained links/cycles/history and both read contracts; browser named confirmation and archived persistence. |
| M06 replay | API caller/payload/intent conflicts, concurrent exactly-once writes and later edit/archive replay; populated upgrade replays old legacy/detailed and new maintenance receipts. |
| M07 rollback | API faults at credential/cycle/coverage delete/insert/audit/receipt and archive stages; exact complete row sets before/after and restored retry; real browser precommit archive fault. |
| M08 authority/locks | API actual witnessed practice lock waits and queued demotion/revocation/replay denial; anonymous/viewer/outsider denial, domain role/auth gating and inherited stale-tab browser coverage. |
| M09 schema | New 27-assertion TAP file, actual private helper/history/direct-write denial, exact protection-removal controls, nine-section fingerprint controls and SQL behavior faults. |
| M10 duplicates | API reciprocal sorted candidate IDs, owner/type/metadata/NULL/ASCII/tenant/archive boundaries; browser create/edit-apart/edit-back/archive warning resolution; read-only UI links. |
| M11 boundary | Strict expected-token/authored/forged-field schemas, exact bound arguments, scalar/file FormData rejection and safe response allowlists; API inherited SQL validation and same-safe missing/foreign target outcomes. |
| M12 UI | Prefilled cancel/owner/type-reset/error/conflict unit and real browser cases; successful feedback focus, explicit draft discard and rotated tokens/key. |
| M13 recovery | Browser actual lost committed update/archive responses, pending lock and precommit fault; complete persisted snapshot equality after retries; applied UI faults for frozen payload/highest versions/tombstones; historical receipt/newer authoritative unit case. |
| M14 access/persistence | Viewer active/archived reload/sign-in, manager API/unit route authority, 375px Axe/keyboard/overflow and contrasting browser zones; inherited staff/recipient/practice browser suites. |
| M15 reads/origin | Missing-cycle API read/update/archive errors with unchanged rows; inherited read-outage browser now targeting the authoritative maintenance entry; real maintenance foreign-Origin POST rejected with unchanged rows. |
| M16 upgrade | `tools/register-maintenance-upgrade.mjs`: two practices, thirteen populated historical tables, known/unknown/action-only cycles, legacy/detailed receipts and shared coverage; complete old-column/value preservation, full transactional schema/row rollback, immutable replays after correction/archive, fresh-replay catalog equality. |
| M17 limits | API credential/date revision integer maximum, allowed no-op/metadata-only, required-increment conflict with unchanged rows. |
| P05 properties | Seeded strict token/authored combinations and canonical round trips, safe archive/duplicate projections and useful discriminant errors in `src/lib/register/properties.test.ts`; independent property-only mutation suite. |

| Invariant | Evidence and limits |
| --- | --- |
| N10 legacy contracts / advisory duplicates | Old applied migrations/create helpers/projections unchanged; strict inherited creation parsers, exact receipts and populated replay after edit/archive; no duplicate uniqueness enforcement. |
| N11 retained history / one initial cycle | API/archive/upgrade exact rows and cardinality; no restore/delete/completion/successor API or UI. |
| N12 scheduling scope | Runtime/schema/capability diff inspection and inactive-SMS text; no queue/calendar/provider/job cancellation added. E3/E4 must meet original event/job criteria later. |
| N13 inherited workflows | Every inherited layer remains required, including all four prior populated upgrade rehearsals and full unit/SQL/API/browser suites. |
| N14 setup/capabilities/secrets | Manifest/lockfile unchanged, local fixture guard, actual capability/supply-chain/secret gates and source diff. Capability gate covers declared spellings, not a semantic transitive proof. |
| N15 trustworthy evidence | Both 32-layer inventories, clean checkpoint/source hash, exact test/fault inventories, actual applied/restored controls, separate behavioral kills/compile errors, final single fresh run. |

The failure model is mapped to the concrete concurrency, rollback, conflict/replay, archive-retention, tenant/lock, no-op/revision, duplicate-boundary, populated-upgrade, and checker-sensitivity witnesses above. Generic coverage/mutation scores do not substitute for them.

## Intermediate failures and corrections

- Initial API GREEN was 11/12: the coverage fixture expected clinician versions, but the established safe coverage projection is `{id,name}`. Corrected that expectation in a separate step and disclosed it in the append-only SPEC; selected IDs/names remain exact.
- React UI test submissions needed awaited asynchronous `act` scopes. Assertions remained unchanged. The inherited outage/route tests now target the maintenance list, retaining their denial/outage assertions; route calls pass the current Next.js page props explicitly.
- SQL protection controls initially used a guessed overlong constraint name; inspected PostgreSQL's actual truncated name and targeted it. Intentional malformed audit inserts could affect a later lookup; the TAP fixture now captures the original audit ID before probes, preserving exact expected failures instead of an infrastructure error.
- SQLFluff's default large-file limit skipped the new migration. Set `large_file_skip_byte_limit=0` so the gate parses all migration files; fixed top-level formatting and concatenated signature casts without suppression or threshold changes.
- Lint's function complexity limit drove a refactor into small field initializers, record controls/feedback and conflict review. Assertions were unchanged and the complete unit suite stayed green.
- The real browser caught repeated archive success text failing to receive focus. Store each completion as a distinct notice object so focus runs on every acknowledged save.
- The first full mutation attempt scored 99.44% with four survivors. Added meaningful default active-read/edit-message and discriminant feedback assertions; followed the existing lazy-dispatch pattern so malformed mutant schemas fail in tests rather than module collection. One cached lazy branch literal still escaped instrumentation. Declared immutable branch schemas at module scope while retaining lazy dispatch, then reran the strict checks. No tests were weakened, ignored mutants added, or thresholds changed.
- An exploratory coverage merge correctly rejected stale browser source maps from earlier builds. The final gauntlet deletes prior coverage/reports before building and exercising the final source.

## Final fresh verification

Pending. Reproduce with `export PATH="$PWD/.tools/node/bin:$PATH"` and `npm run gauntlet`, using the already recorded local tools/fixture prerequisites. `tools/layers.json` and `tools/gauntlet.mjs` require all 32 layers. Final results and source identity will be filled only from the completed fresh run after all source edits.

## Inspection and boundaries

Separate SPEC approval: **not obtained (autonomous run)**; implementation was authorized by “create specs and implement it,” but correlation-breaking review of this new SPEC did not happen. Independent fresh-context implementation verification: **not performed**. User manual acceptance: **pending**. Agent inspection and automated keyboard/Axe/browser checks are not user-confirmed manual acceptance. Hosted authenticated maintenance, production migration/deployment, real job cancellation/calendar integration and dispatch are outside this run.
