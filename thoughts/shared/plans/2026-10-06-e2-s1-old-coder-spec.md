# SPEC — E2-S1 register ownership

Date: 2026-10-06 (America/Los_Angeles).
Tier: **3** — live access, public RPCs, concurrent creation, migration, and atomic audit/recovery.
Baseline: `fc337c1224d18987896f311d45127059aed41f2a`.
Implementation plan: `thoughts/shared/plans/2026-10-06-e2-s1-register-ownership.md`.

## Authorization and setup

User instruction: **“create specs then implement it”**. Proceed autonomously with the researched plan. Separate approval of this new SPEC was **not obtained (autonomous run)**; evidence must declare the reduced independence of specification review. This is not permission to deploy or send external messages.

- Isolation: local branch `codex/e2-s1-register` in the existing checkout, reusing the pinned dependencies, runtime, and local verification caches. No remote push/merge or production changes.
- New dependencies/tools: **none**. Use the existing Node 24.21.0, npm, Supabase 2.119.0, PostgreSQL/Docker fixture stack, Vitest/fast-check, Playwright/Axe, SQLFluff, Stryker, and Gitleaks. Do not upgrade tooling opportunistically.
- Local setup: start the dedicated Supabase project if stopped, regenerate ignored fixture environment files through `tools/local-environment.mjs prepare`, and reset only after its exact-project/endpoint/fixture-account guards pass. Never print private status keys.
- Git: retain existing history. Final gauntlet requires a committed clean source through `tools/source-state.mjs`; request any necessary local checkpoint authorization with a concrete reviewable implementation before that gate. No automatic push, merge, or production promotion.
- New source: `src/lib/register/{schema,repository,operations,messages}.ts`, `src/app/practice/register/{page.tsx,actions.ts}`, `src/components/register/{register-panel,clinician-form,credential-form}.tsx` and a small shared form/recovery component if needed.
- New persistence: CLI-generated register migration, `supabase/tests/practice_register.test.sql`, public clinicians/credentials/policy coverage, private audit/create receipts.
- New verification: `tests/integration/practice-register.test.ts`, `src/lib/register/{schema,properties}.test.ts`, `tests/unit/register-{operations,actions,forms}.test.{ts,tsx}`, `tests/e2e/practice-register.spec.ts`, and `tools/register-upgrade.mjs`. Reuse and extend existing schema catalog, FK controls, SQL faults, layer runner/inventory, mutation/property configuration, route tests, and generated types. Reports stay in ignored `reports/`/`coverage/`.
- Durable artifacts: this SPEC, the plan/review/research, and `thoughts/shared/research/2026-10-06-e2-s1-implementation-evidence.md`.

## Failure model

| Failure | Concrete defense/witness |
| --- | --- |
| Another practice's clinician/policy accessed or linked | RLS, same-practice composite FKs, real two-practice/anonymous API and SQL tests; isolation/FK faults. |
| Stale form/token retains manager authority after demotion | Practice-lock-before-live-role-check, queued revocation/demotion and independent lock-removal witnesses. |
| Policy appears once per covered person | Single credential ID, unique coverage links, aggregate list; cardinality and future-cycle boundary assertions. |
| Lost response/repeated requests duplicate entity/audit | Immutable caller-scoped request receipts; concurrent/API and browser post-commit abort/retry tests. |
| Partial entity/link/audit/receipt commits | One PostgreSQL transaction and forced failures at every write boundary; independent persisted snapshots. |
| App accepts input SQL cannot store | Positive/negative Unicode/UUID/type/owner parity cases and generated properties. |
| Migration changes existing history or leaves faulty schema | Seven-table upgrade snapshot, deliberate transaction rollback, expanded nine-section schema comparison, full replay. |
| Failure falsely appears as empty list/success | Runtime RPC projection validation, real read/write faults, explicit safe result/uncertain-save states. |
| New check silently omits a table/layer/test or fault | Inventory/negative controls and restored catalog; nonempty actual named test results. |

## Observable contract

Clinicians are records, not user accounts. All active members read the shared register; only administrators/managers create. Type values are `state_license`, `dea_registration`, `malpractice_policy`; either clinician or practice ownership is allowed. Only practice-owned malpractice can have additional coverage links. Empty coverage is valid. Duplicate names/titles are permitted.

Names/titles trim ECMAScript whitespace and contain 1–120 Unicode code points. Reject NUL and malformed Unicode before PostgreSQL transport. Canonical UUID strings are lowercase; coverage UUIDs must be unique and are sorted for retries. Required identity/discriminator/request fields are NOT NULL. No dates, protected credential numbers, jurisdiction/issuer metadata, clinician login, or SMS enrollment are created.

Safe result statuses: `success`, `invalid`, `invalid-reference`, `request-conflict`, `forbidden`, `unavailable`, `auth-required`. Exact user messages:

- Clinician success: “Clinician saved.”
- Credential success: “Record saved. Dates still need to be entered.”
- Invalid: “Check the highlighted fields.”
- Invalid reference: “An owner or covered clinician is unavailable. Reload and review your selection.”
- Request conflict: “This save request was already used. Reload and review the saved register.”
- Forbidden: “You do not have permission to add register records.”
- Unavailable/transport uncertainty: “We could not confirm this save. Retry this save before changing it.”
- Read failure: existing safe error boundary, “We could not complete this request. Try again.”

After uncertainty, preserve and freeze the submitted request/payload; “Retry this save” sends precisely the same intent. Acknowledged validation/reference rejection permits correction. Success alone rotates the key and clears the draft. Reload does not automatically resubmit and does not retain drafts in browser storage. New independently keyed requests are not semantic duplicate detection.

## Named scenarios

Each row requires at least one named executable test. `G` names cover persistence/domain/UI; `P` properties and `A` hostile tests are separate. Map each to plan AC1–AC12 in final evidence.

| ID / name | Input/action | Required observation |
| --- | --- | --- |
| G01 empty register is real | Active member lists a new practice | Empty clinician/credential arrays; no fake records/cycles. |
| G02 clinician is not a staff account | Manager saves `  Dr. Rivera  ` | One clinician named `Dr. Rivera`, version 1; no memberships/invitations/recipient changes. |
| G03 all types and owners | Save each supported type with clinician and practice owner | Six separate records with exact ownership; no dates/jobs. |
| G04 multiple records per clinician | Save two same-type titles under one clinician | Two IDs persist; owner unchanged. |
| G05 shared policy identity | Practice malpractice covers two saved clinicians | One credential, two links, one list entry containing both names. |
| G06 zero coverage and unsupported coverage | Save practice-only policy, then coverage on state license/clinician-owned policy | Empty coverage succeeds; other combinations return invalid with no writes. |
| G07 foreign and missing owner/coverage | Use other practice's and random clinician UUIDs | invalid-reference or database FK rejection; no partial rows. |
| G08 duplicate and NULL links | Repeat same UUID, vary UUID casing, or include NULL | Rejected; no links/entities/events/receipts. |
| G09 scalar limits and normalization | Empty/whitespace/121-codepoint versus trimmed 1/120-codepoint and astral names | Invalid values rejected; valid names stored identically to normalized input. |
| G10 immutable same-key retry | Repeat identical clinician/credential request | Same success/ID; exactly one event/receipt/entity/link set. |
| G11 changed request conflicts | Reuse key with changed name/title/type/owner/coverage/operation | request-conflict; original result/history unchanged. |
| G12 concurrent retry and reordered coverage | Concurrent identical requests/reorder-only equivalent payload | One committed logical create, identical successes; sorted coverage. |
| G13 atomic creation failures | Fail entity, coverage, audit, receipt insertion separately | Complete before/after state equal; removing fault enables retry. |
| G14 authority after queued demotion | Create waits on practice lock; demote/revoke caller before release | forbidden; no creation. Existing token cannot replay original receipt/read rows. |
| G15 independent lock witness | Hold practice lock, queue valid caller, inspect unfinished request | No completion until release; then success. Removing lock makes witness fail. |
| G16 auth and derived authority | Missing/expired user, auth outage, missing access, posted practice/actor/role | Login/auth-required or safe unavailable/forbidden/invalid; no unintended RPC write. |
| G17 form cardinality | Duplicate scalar/files/unknown fields; repeated distinct coverage field | Scalars/files/extras rejected; only intended string-array field accepted. |
| G18 parsed RPC projection | Malformed/null/extra-private-field read/write responses | Invalid shape becomes unavailable; valid shape strips private fields; no raw DB details. |
| G19 saved register navigation | Create clinicians/records, reload, sign out/in | Saved records visible from settings link; existing home/settings routes remain. |
| G20 viewer and manager interface | Sign in viewer versus manager | Viewer reads without forms; manager creates without profile/team controls. |
| G21 input recovery and switches | Invalid draft; switch owner/type; resolve reference rejection | Draft retained; incompatible hidden ownership/coverage cleared deliberately; errors linked and focused. |
| G22 pending and lost-response recovery | Delay write, abort action response after commit, retry | Fields/pending button disabled; immutable retry creates no second rows/events; success clears draft. |
| G23 read outage is not empty | Fail register read | Error boundary rather than empty saved lists. |
| G24 truthful accessible mobile UI | Keyboard and Axe at 375px; policy coverage displayed | No horizontal overflow; text says Dates not entered and SMS inactive; one shared-policy card. |
| G25 guarded upgrade rollback replay | E1-S3 fixtures with seven nonempty historical tables | Exact old rows preserved; failed upgrade restores full schema; new tables empty; replay/old RPCs pass. |

## Properties and hostile pass

| ID | Cases | Required invariant |
| --- | --- | --- |
| P01 name parity | 1,000 seeded Unicode/whitespace/boundary examples | Independent expected trim/codepoint count agrees with application acceptance/normalization; real SQL sample covers the same valid/invalid boundaries. |
| P02 strict ownership and UUID inputs | 1,000 seeded names/types/ownership/extra-fields/coverage variants | Valid supported combinations accepted; forged authority, duplicate canonical UUIDs, invalid combinations rejected; sorted canonical output. |
| P03 real create sequences | 20 seeded caller/practice/key/payload sequences | Same-key results/row counts/audit are invariant; changes conflict; denied writes leave state unchanged; references remain same-practice. |
| A01 table/RPC isolation | Anonymous, foreign practice, viewer, revoked; direct public/private access | No unauthorized reads/writes, private audits/receipts inaccessible, helper EXECUTE denied, direct DML denied. |
| A02 forged identity and hostile shape | Post identity/metadata fields, malformed enums/UUIDs, unsafe Unicode and markup | No authority transfer; safe errors; text renders escaped. |
| A03 origin and network attacks | Foreign-Origin actual action replay, post-commit response abort | No off-origin write; normal same-key retry resolves the persisted result. |

## Must NOT

| ID | Invariant and evidence |
| --- | --- |
| N01 | No creator/JWT/form identity authority; live membership and real role/isolation faults. |
| N02 | No cross-practice/orphan/unsupported coverage; restrictive composite FKs and dropped-defense controls. |
| N03 | No extra entity/audit on same-intent replay or partial transaction; real counts/forced faults/races. |
| N04 | No existing profile/team/join/recipient regression; complete inherited suites and historical upgrade snapshots. |
| N05 | No dates/cycles/calendar/jobs/text enrollment/provider sends or legal-validity claims; schema/capability/UI boundary review. Structural single-policy identity is not proof of later no-duplicate SMS dispatch. |
| N06 | No application secret/admin key, filesystem/subprocess, browser draft storage, or new dependency; capability/supply-chain/diff checks. |
| N07 | No hosted reset, nonfixture deletion, unrestored mutant, or changed source during final run; exact guard/fingerprint/source hash. |
| N08 | No weakened/skipped layer or stale evidence; exact 30-layer inventory, applicable executed faults, independent property mutation, fresh coverage and final-source binding. |
| N09 | No production deploy, external messages, remote push/merge; local branch and scope record. |

## Verification and completion

Execute RED → GREEN → REFACTOR per phase; freeze behavioral assertions during implementation changes. Persist observed RED results/IDs in evidence. New tests that are already green must have a demonstrated applicable throwaway fault. Follow the plan's phase checks and complete inherited suites.

Final reproducible command: **`npm run gauntlet`**, with 30 layers in both `tools/layers.json` and `tools/gauntlet.mjs`. Retain 100% application/property mutation gates and complete owned executable-line coverage. Extend seven public-table catalog filters and exact pgTAP/FK fault inventory. Added SQL fault witnesses must fail behaviorally, not on setup crashes, and restore the independently fingerprinted schema.

No required layer may be called passed without running it after the final implementation edit. Evidence maps G01–G25/P01–P03/A01–A03/N01–N09 and AC1–AC12, records source SHA/hash/run ID/tool versions/counts, names unavailable checks, and separates automation, agent UI inspection, and user acceptance. Independent fresh-context verification is **not performed** unless requested; main-agent review is not that protocol.

Completion requires all four phases and current-source applicable gates passing. Dates/SMS and E1-S3 rule 9 remain future gates. User-confirmed manual acceptance remains unchecked. No capacity/SLA, production-provider delivery, regulatory correctness, or exhaustive Unicode/browser-version guarantee is claimed.

## Revisions

- 2026-10-06 — Initial SPEC written before implementation, per “create specs then implement it.” Adds concrete G/P/A/N tests, failure model, setup/isolation, unchanged dependencies, and evidence limits. NUL/malformed Unicode rejection makes the researched name contract transport-safe. Separate human SPEC review not obtained; implementation proceeds under the user's explicit instruction.

## Verification corrections during implementation

The G21 unit assertion initially inspected an input's own `disabled` property. A disabled parent fieldset correctly disables interaction without setting that property on descendants. The assertion now checks the element's effective `:disabled` state; it still requires blocked interaction and exact retry payload. No product behavior or acceptance criterion changed.

Browser selector corrections scope alerts to the application's `p[role=alert]`, excluding Next.js's separate navigation announcer. The retry comparison extracts the submitted form fields; React's previous-action feedback state may legitimately differ between attempts. It still requires identical request key and every submitted ownership/coverage field plus exact unchanged database rows.

The removed register-lock fault exposed a test gap: an INSERT also waits on the practice through its foreign key, so a valid-create-only witness passed with the explicit authorization lock removed. G15 now additionally queues the read RPC, which has no INSERT/FK wait, and requires an observed practice lock before both requests finish. G14 independently tests authorization changes while queued. This strengthens the existing required lock witness without changing the product contract.

The application slice exposed a pre-existing coverage conversion defect: bundled `webpack://..././src/...` source names do not match the converter's resolved names, so it attributed other functions to the first source. The checker now resolves source identities before conversion and explicitly supplies the same verified map for Node and browser data. Two synthetic controls were observed RED: normalized identities and an uncalled function remaining uncovered in its own source rather than contaminating an executed file. Checker sensitivity removes the normalization and requires the attribution control to fail. This retains the owned-line gate and corrects its attribution, without skips or thresholds changing. The implementation reuses `@jridgewell/trace-mapping`, already pinned in the converter's installed dependency tree/lockfile; no package installation, version or dependency graph changes.

Correct attribution exposed a second measurement mismatch: raw V8 bundle conversion creates a statement marker for every physical line, including closing braces and continuation lines, while Vitest supplies an AST-based executable-statement inventory. The owned executable-line gate now uses that complete per-file inventory and combines execution from unit, browser, and real Node runs at its statement lines. It requires every owned file and every inventoried executable line; missing/incomplete data and an uncalled executable statement still fail. No executable-line threshold or source-file scope changes. A synthetic continuation/unexecuted-statement control was observed RED before the correction; removing its zero-count defense must fail that control. The inventory is copied before merging runtime coverage so the merge cannot add formatting lines to the inventory.

That corrected measurement detected three real interaction gaps. G21 now explicitly verifies deselection preserves the other covered clinicians and submits only their IDs. Existing S35/S48 regression armor adds administrator-demotion cancellation and clipboard success/failure feedback in `tests/unit/team-forms.test.tsx`; no existing team production behavior changes. `tools/ui-coverage-sensitivity.mjs` is an additional persisted verification tool, invoked by the existing checker-sensitivity layer. Each initially GREEN case must fail an applied behavioral fault, restore exact source, and pass again. This addition supports the inherited whole-application gate and adds no dependency or required-layer exclusion.

## Production authorization — subsequent user request

The user subsequently requested **“push to prod”**. This authorizes the necessary local checkpoint commits, final verification, normal remote push, additive hosted migration and application deployment to the existing Vercel/Supabase pilot. It supersedes the original local-only release boundary. It is not retroactive independent SPEC review: SPEC approval before implementation remains not obtained. Release uses the existing E1-S3 rollout pattern: clean committed archive, production build without live-domain assignment, read-only historical/catalog capture, dry-run identifying exactly the register migration, additive migration without seeds/reset/Vault changes, historical preservation/schema checks, promotion, and read-only hosted smoke. Local fixture/reset/mutation tools remain strictly local. No production seed/test accounts, real record creation, external email request, or destructive database rollback is authorized or needed for verification.
