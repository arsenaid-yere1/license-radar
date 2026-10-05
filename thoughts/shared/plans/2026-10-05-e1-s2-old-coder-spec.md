# SPEC — E1-S2 Staff Invitations and Roles

- Date: 2026-10-05
- Tier: **3 — authentication, tenant access, revocation, transactional writes, migration, and concurrency**.
- Approval: **pending**. This request authorizes writing the specification, not its implementation. Earlier E1-S1 approval does not approve E1-S2.
- Implementation plan: `/Users/macbookpro/Coding/license-radar/thoughts/shared/plans/2026-10-05-e1-s2-staff-invitations-and-roles.md`.
- Research: `/Users/macbookpro/Coding/license-radar/thoughts/shared/research/2026-10-05-e1-s2-staff-access.md`.
- Source baseline: `491e6905bdbc2aa853c94c9cc7e192d51cd9a676`, current branch `main`. Application source is clean; the three E1-S2 planning/research files are untracked before this specification is added.
- Deliverable: administrators invite verified staff, assign/change roles, and revoke access without removing the last administrator. Existing practice/profile behavior survives the membership transition.

## Product Contract

Approval of this SPEC adopts these previously proposed defaults together:

1. An account has **at most one active practice membership**. A revoked member can join/create another practice. There is no switcher or silent replacement of an active membership.
2. Administrators **copy an invitation link** for their chosen sharing channel. The application creates the link and does not send invitation email. Existing six-digit OTP authenticates staff, including new accounts, through local Mailpit.
3. Invitations expire **seven elapsed days after database-managed issuance**. Expired/canceled/superseded links cannot join. Only an explicit authorized reissue rotates the token, issuance time, expiry, and version. Email and role remain unchanged on reissue.
4. Roles are `administrator`, `manager`, and `viewer`. The UI labels manager as Office manager. All active members can read the shared practice name/timezone and their own role. Only administrators edit settings, list staff/invitations, and manage access. Manager record/calendar capabilities and viewer assigned-record limits will be implemented when those records exist.
5. Administrators can demote/revoke themselves or another administrator only while another active administrator remains. Pending administrator invitations do not count. No separate self-service leave workflow.
6. Creator identity remains immutable provenance, not authority. Revoking the creator removes access; old ownership never restores it. Remove creator uniqueness in favor of active-membership uniqueness.
7. Reactivation requires an invitation issued/reissued **after the latest revocation**. Pending invitations from before revocation and historical accepted links cannot reactivate a member. An invitation created with valid authority remains valid after its inviter's later demotion/revocation unless canceled.
8. Join requires confirmed matching email, a valid invitation, and explicit acceptance. Viewing a link, previewing it, or verifying an OTP does not create membership.

These are testable product decisions, not regulatory claims. Approval covers this exact version of the contract. A later preference answer changes the SPEC and requires approval of the revised document.

## Permission and Error Contract

| Caller | Shared profile/own role | Edit profile | Team/invitation list | Invite/change/revoke |
| --- | --- | --- | --- | --- |
| Active administrator | Read | Allowed with expected version | Allowed | Allowed within invariants |
| Active manager | Read | Forbidden | Forbidden | Forbidden |
| Active viewer | Read | Forbidden | Forbidden | Forbidden |
| Revoked/nonmember | No rows | Forbidden | Forbidden | Forbidden |
| Signed out | No grants/private details | Sign-in required | Sign-in required | Sign-in required |

Authenticated invitation preview/accept is separately authorized by the stored invitation and confirmed actor email; it is not general tenant access. A member active elsewhere gets a neutral conflict on acceptance and no membership replacement.

Server actions use the following typed outcomes and visible messages. SQL errors do not reach the browser. Redirects remain explicit action/route behavior rather than being swallowed as unavailable.

| Outcome | Required UI result |
| --- | --- |
| `invalid` | `Check the highlighted fields.` with field-associated errors; no write |
| `forbidden` | `You do not have permission to do that.`; no write/private result |
| `auth-required` | Redirect to `/login`, or show the sign-in form on `/join`; no write |
| `conflict` on team state | `This access record changed. Reload before trying again.` |
| `conflict` on practice settings | Preserve `These settings changed. Reload before saving.` |
| `other-practice` | `You already belong to a practice. Your access was not changed.`; omit its identity |
| `invalid-invitation` | `This invitation is unavailable. Ask an administrator for a new link.` for unknown, malformed, wrong-email, expired, canceled, superseded, or pre-revocation pending links |
| `last-administrator` | `Add another administrator before removing this access.` |
| `invite-exists` | `A pending invitation already exists for this email. Cancel or reissue it.` |
| `already-member` | `You already belong to this practice.`; show current role, do not apply the invitation's role |
| `unavailable` | Preserve `We could not complete this request. Try again.`; no false success |
| Successful create/reissue | `Invitation link created.` and explicit expiry; never claim it was sent |
| Successful accept/change/revoke/cancel | Accurate confirmation reflecting persisted state |

Database/RPC errors may be mapped to these domain outcomes; exact SQLSTATE names are implementation details, but stable domain results, no unintended writes, and denied grants must be asserted. All opaque-token errors use the same invitation message and omit practice/email/role details.

## Failure Model

| Failure mode | Required detector |
| --- | --- |
| A nonmember, manager, or viewer elevates privileges or sees another practice's staff | Real Data API/RPC/table grant tests, guessed IDs, forged metadata/forms, role matrix, browser tests |
| Revoked creator retains ownership access; stale token retains a role | Same issued JWT reused after revoke/demotion; creator regression; no owner RLS fallback; isolation/revocation SQL mutants |
| Accepted or old pending invitation resurrects access | Issuance/revocation epoch tests across two revoke/rejoin cycles; replay and epoch mutants |
| Two administrators concurrently remove the last administrator | Real independent transactions, coordinated lock waits, final-admin count, deferred invariant tests/mutants |
| One user creates/joins two practices through racing requests | 20-way create/accept stress, two-practice race, partial unique index, shared user-lock tests |
| Lock waits admit expired invitations or stale role checks | Blocked transaction tests using post-lock wall-clock expiry/live actor checks; explicit lock-order restoration checks |
| Migration loses original profiles/history or produces half-backfilled access | S1-to-S2 upgrade snapshots, transactional failure/rollback rehearsal, fresh migration replay |
| Profile/member/invite changes survive failed audit writes | Real audit-trigger fault injection for each mutation family and persisted row/event counts |
| Fail-closed implementation rejects legitimate staff or Unicode profile values | Positive role/acceptance tests paired with denials; generated valid/invalid input properties; real PostgreSQL parity |
| Token/email leaks in tables, roster, errors, URLs, browser traces, or reports | Minimal projections, digest-only storage, fragment/referrer/header tests, redacted artifact controls, capability review |
| A checker reads stale evidence, ignores a relation/grant, or reports an unexecuted test/mutant | Fresh run/source binding; known-bad controls plus removed-defense sensitivity; exact suite/layer inventory |
| Local reset/upgrade/mutations affect another database or non-fixture data | Fixed endpoint/project guards and fixture-only check before destructive work; hosted/wrong-port negative controls |

## Setup Plan and Authorization Boundary

Approval authorizes the following local implementation/setup/checkpoints together. Nothing here authorizes a remote push, merge into `main`, hosted provisioning/deployment, real invitation delivery, or external messages.

### Isolation and Git

1. Record the exact approval quote as an appended approval record. Commit this SPEC and the three existing E1-S2 research/plan/verification documents as a documentation baseline in the current project, staging only those paths. Include a specification/evidence template if one is created within `thoughts/`; never stage unrelated user changes.
2. No attached worktree currently exists. At implementation start, inspect attachments again and reuse a suitable dedicated E1-S2 worktree if one appeared. Otherwise create/attach a managed worktree from the approved documentation commit, and use implementation branch `codex/e1-s2-staff-access`. Record the tool-returned absolute checkout path. Isolation keeps application changes off the user's `main` checkout.
3. Make local checkpoints after GREEN and REFACTOR stages; commit a clean final source before the final gauntlet. No push/merge/archive of the finished result. Deliver its reviewable branch/worktree and absolute SPEC/EVIDENCE paths. If isolation or commits are declined/unavailable, report the changed assurance boundary rather than silently using the working tree.
4. A material behavior change appends a dated amendment/reason and requires human approval of the amended SPEC before implementing it. Preserve prior clauses and resolutions; do not silently replace the approved contract.

### Tools and Environment

- Reuse existing versions in `package-lock.json`, `tools/toolchain.json`, `requirements-dev.txt`, and `tools/python-constraints.txt`: Node 24.21.0/npm 11.19.0, Supabase CLI 2.119.0, PostgreSQL 17 local stack, Vitest 5.0.3, Playwright 1.63.0, Stryker 10.0.0, fast-check 4.10.2, SQLFluff 4.4.0, and Gitleaks 8.30.1.
- Run `npm ci` in the isolated checkout. Recreate ignored Chromium assets via the pinned Playwright CLI, and rebuild `.venv-gauntlet` from the existing Python requirements/constraints. Reuse existing checksum-verified runtime/Gitleaks artifacts or obtain the exact recorded versions; record actual installs and checksums. Do not copy historical reports as new evidence.
- Reuse/start only the dedicated local `license-radar-e1-s1` Supabase project at API/Postgres/Mailpit ports 55321/55322/55324. Confirm loopback endpoints/project and inspect non-fixture account counts without printing emails/keys before any reset/upgrade/mutation. Non-fixture data blocks destructive setup; it is not automatically authorized by this SPEC.
- Generate private `.env.local` and `.env.test.json` through `tools/local-environment.mjs prepare`; never print/copy keys into source or browser artifacts. No application service-role client.
- Docker/Python must be available. Missing system prerequisites are reported, not silently installed or substituted. Preserve unrelated stacks/processes; identify ownership before stopping any task-owned preview on port 3000.
- Supabase help must be discovered from the pinned CLI before schema operations; generate migration files via `supabase migration new`. In this SPEC-writing turn the help attempt failed because the CLI tried to write telemetry outside the writable sandbox. No database command was executed; exact upgrade/reset flags remain implementation preflight, not an invented verified command.

### Dependencies and Capabilities

**New direct application/development dependencies: none.** Node `node:crypto` supplies random bytes and SHA-256; existing Supabase/Postgres, Zod, test/mutation/property/coverage/accessibility libraries cover the story. No mail provider, ORM, CSS framework, or additional runtime is introduced. Any genuinely necessary new package requires a visible SPEC amendment and justification before installation.

New application capabilities are authenticated `client.rpc` calls, cryptographic token generation/hashing, clipboard copying, and tab-scoped invitation session storage. Existing Auth/Data API/cookie capabilities remain. No new application filesystem/subprocess access or external network service. Test/tools may use the existing guarded local Postgres/HTTP, subprocess, and filesystem capabilities for verification.

## File Scope

All new paths are proposals; create them after approval. Migration timestamps are assigned by the CLI and recorded in EVIDENCE, not fabricated in advance.

### Application and schema

- New CLI-generated migration(s) under `supabase/migrations/` for membership/backfill/authority and invitation lifecycle; keep `20261003191334_practice_profiles.sql` unchanged.
- New `src/lib/practice/access.ts` and `src/lib/team/schema.ts`, `repository.ts`, `operations.ts`, `invitations.ts`.
- New `src/app/practice/team/page.tsx`, `actions.ts`, `src/app/join/page.tsx`, `actions.ts`.
- New `src/components/team/team-panel.tsx`, `invitation-form.tsx`, `member-controls.tsx`, `src/components/auth/join-form.tsx`.
- Update `src/lib/practice/repository.ts`, `save.ts`, `src/app/practice/actions.ts`, `src/app/page.tsx`, `src/app/practice/page.tsx`, `src/app/onboarding/practice/page.tsx` for RPC/member-derived context and failures.
- Update `src/app/login/actions.ts`, `src/components/auth/email-code-form.tsx`, `src/components/shell.tsx`, `src/proxy.ts`, `src/lib/supabase/session.ts`, and required styles in `src/app/globals.css`.
- Regenerate `src/lib/supabase/database.types.ts`; update `README.md`. Modify `supabase/config.toml` only if a verified requirement needs it; preserve private-schema non-exposure and OTP settings.

### Behavior tests and fixtures

- New `supabase/tests/practice_access.test.sql` and `supabase/tests/practice_invitations.test.sql`.
- New `tests/integration/practice-access.test.ts`, `practice-invitations.test.ts`, `practice-access-properties.test.ts`.
- New `src/lib/team/schema.test.ts`, `properties.test.ts`, `tests/unit/practice-access.test.ts`, `team-actions.test.ts`, `team-forms.test.tsx`, `join-actions.test.ts`, `join-form.test.tsx`.
- New `tests/e2e/practice-team.spec.ts`, `practice-join.spec.ts`, `practice-access-adversarial.spec.ts` and `tests/helpers/access-fixtures.ts`.
- Update existing practice API/Unicode property/SQL/unit/route/auth/browser tests and `tests/helpers/browser.ts`, `local-fixtures.ts`, `coverage.ts` only where authority/routing changes require it. Maintain behavioral assertions; direct-DML and named-creator-constraint expectations are replaced by the new SPEC-authorized boundary, with real denial tests retained.
- Update `playwright.config.ts` only if needed for per-spec token trace/screenshot policy; retain normal S1 diagnostics. Generated mail/account/token fixtures remain local, private, and disposable.

### Gauntlet trust chain

Already present, reused/extended: `tools/gauntlet.mjs`, `layers.json`, `source-state.mjs`, `gauntlet-contract.mjs`, `local-environment.mjs`, `schema-fingerprint.mjs`, `schema-contract.json`, `check-generated-types.mjs`, `foreign-key-controls.mjs`, `sql-mutants.mjs`, `check-coverage.mjs`, `shuffle-browser.mjs`, `check-capabilities.mjs`, `checker-sensitivity.mjs`, `gauntlet-controls.test.mjs`, and `tests/fixtures/gauntlet-controls/controls.json`.

New persisted harnesses:

- `tools/access-upgrade.mjs`: guarded S1-to-S2 snapshot/failure-rehearsal/upgrade checks, with source restoration and no nonlocal endpoints.
- `tools/access-adversarial.mjs`: execute the named A01–A05 integration/browser attacks, verify actual expected test inventory/results, and persist redacted outcomes.
- `tools/access-controls.test.mjs`: negative controls for new/expanded upgrade, schema/grant/index, adversarial, and browser-inventory gates. Include this file in the existing controls command/layer.

Update `stryker.config.mjs`, `stryker.properties.config.mjs`, `vitest.properties.config.ts`, and required existing test configuration. `package.json` may adjust control-script selection without introducing dependencies. Record toolchain changes if any installed inventory changes.

SPEC: `/Users/macbookpro/Coding/license-radar/thoughts/shared/plans/2026-10-05-e1-s2-old-coder-spec.md`.

Future EVIDENCE relative to the implementation checkout: `thoughts/shared/research/2026-10-05-e1-s2-old-coder-evidence.md`; report its actual absolute path after the worktree exists. No completed EVIDENCE is fabricated in this turn.

Small helper splits within these owned modules are allowed without changing behavior/dependencies; record their exact paths in EVIDENCE. Unrelated files and historical S1 documents stay untouched.

## Scenarios — Named Executable Test List

Each S-ID must appear as a test-name prefix and map to one or more actual named tests in EVIDENCE. Parameterized variants must report their executed cases. Storage invariants use real local Auth/Data API/Postgres, not mocked persistence. Unit tests may replace network/clock boundaries only.

Fixtures: practice P (Cedar Clinic, UTC), practice Q (Birch Clinic, America/New_York); administrator A; matching invitee B; wrong-email account C; second administrator D. Generated fixture addresses substitute for these logical names. Every scenario starts from independent known state.

### Migration and practice foundation — AC1, AC9, AC12

| ID / test name | Concrete action | Required outcome |
| --- | --- | --- |
| S01 preserves S1 profiles and audit history on upgrade | Start at the original migration with P version 2 and Q version 3 plus their existing create/edit audit events; apply S2 | Practice IDs, creators, names/zones, versions/timestamps and old audit rows unchanged; one active creator-administrator per practice; one explicit initialization event each |
| S02 failed backfill rolls back | Apply upgrade inside a real transaction with a deliberate failure after initial backfill work | Transaction fails; original data/schema snapshots survive; no half-created membership/grant/constraint state; restored actual upgrade succeeds |
| S03 fresh replay matches upgraded schema | Reset only the dedicated fixture stack and replay all migrations | Same intended grants, RLS, RPCs, indexes, constraints and triggers as upgrade; generated public types match |
| S04 concurrent practice create is atomic/idempotent | Send 20 `create_practice` requests for one confirmed new user, then retry with different values | One profile, one active administrator membership, one profile-create and one membership-create event; every successful response returns that profile without overwrite |
| S05 existing member cannot create another active practice | B belongs to P as manager and submits create with Birch/UTC | Return existing authorized P unchanged; no Q/orphan profile or administrator grant to B |
| S06 current practice follows membership | Revoke creator A from P after D becomes administrator; A creates a new practice | A cannot read/mutate P using the old JWT; new practice uses new ID with A administrator; old creator provenance stays intact; Q unaffected |
| S07 inherited profile contracts remain true | Authorized administrator runs S1 create/edit/validation/version/error/recovery cases through RPCs | Unicode/name/timezone validation, optimistic conflicts, audit rollback, fixed example-only reminder and last-successful-version retention still hold; no direct profile DML path |

### Invitation creation and privacy — AC2, AC4, AC6, AC10

| ID / test name | Concrete action | Required outcome |
| --- | --- | --- |
| S08 administrator creates digest-only seven-day invite | A invites `  Manager+Renewals@Example.test  ` as manager | Stored canonical email `manager+renewals@example.test`, role manager, pending state, version 1; expiry minus issuance exactly seven days; 32-byte base64url token shown once; only canonical 64-hex SHA-256 digest stored; one creation event |
| S09 invalid invite inputs cannot write | Try malformed email, 255 characters, tab/newline surroundings, non-ASCII, unknown role `owner`, extra actor/practice fields, bad version/token/digest shapes | Each invalid case rejected; field errors in app and validation at SQL/RPC boundary; no invite/member/event change |
| S10 email normalization agrees in application and SQL | Test spaces/mixed ASCII case, dots/plus tags, tabs/newlines, controls, valid ASCII boundary and invalid overlength | Same accepted canonical string or same rejection at both boundaries; no alias collapse; locale-independent ASCII mapping |
| S11 duplicate pending invitation is visible and safe | A creates B invite, then repeats or races creation with another role/token | Exactly one pending invite; losers return `invite-exists`; original role/digest unchanged; no duplicate create event |
| S12 cancel is idempotent and blocks join | A cancels a pending invite and repeats cancel | State canceled; exactly one cancel event; second call no-op success; old link preview/accept returns generic invalid invitation |
| S13 reissue rotates capability and version | A explicitly reissues pending or expired invite at expected version | Same email/role; new digest and later issued/expiry times; version increments once; old link invalid; new link works; one reissue event |
| S14 stale invitation mutation conflicts | Two reissue/cancel requests use same version while invitation is pending | At most one state-changing winner; stale conflicting operation reports conflict; repeated already-canceled no-op may succeed without event; no stale link success |
| S15 lost create response has recoverable pending state | Persist creation, discard its response, reload team | Pending row/expiry visible without raw token/digest; no false mail confirmation; explicit reissue supplies new usable link and invalidates lost link |
| S16 inviter's later revoke does not silently cancel | D creates valid B invitation; A later demotes/revokes D while remaining administrator | Invitation remains available until expiry/cancel; B's matching explicit acceptance succeeds; audit identifies D at issuance and B at acceptance |
| S17 roster/private projections are minimal | Read profile/own membership/team/invites as A, B manager, C nonmember, and anonymous | Only A receives its practice's minimal email/role/state/version roster/invite metadata; others get no roster/private rows; no digest/raw token/full Auth user record in list/error |

### Join and invitation lifecycle — AC3–AC5, AC7, AC9

| ID / test name | Concrete action | Required outcome |
| --- | --- | --- |
| S18 new user joins after OTP and explicit accept | Open B link signed out, request/verify delivered code, preview, then accept | No profile/membership during GET/OTP/preview; return to `/join`; correct P/manager preview; accept creates B membership/event once; refresh reads P without onboarding/create |
| S19 existing confirmed user joins | B already has an Auth account with no active practice; open/accept invitation | Same account ID joins P; no duplicate Auth account or profile; current practice/role persist across fresh login |
| S20 wrong or unconfirmed email cannot preview or join | C has valid B token; additionally test an unconfirmed matching-email identity through SQL/auth fixture | Generic invalid invitation with no P/name/role/email disclosure; invitation unchanged; no membership/event; confirmed B can still join |
| S21 unknown expired canceled superseded tokens deny uniformly | Submit malformed/unknown token and each lifecycle-invalid real token | Same `invalid-invitation` message/status; no private fields/mutations; unknown/malformed cases do not throw unsanitized errors |
| S22 exact expiry is exclusive | Preview/accept at just before expiry, equality, and afterward using real stored expiry/controlled DB boundary | Valid before; invalid at/after; denial leaves membership/invite/events unchanged; no guessed client-clock authority |
| S23 expiry during lock wait blocks queued accept | Hold practice lock, queue acceptance while valid, advance past stored expiry, release | Queued acceptance rejects using post-lock database wall clock; no membership/event |
| S24 concurrent acceptance is once-only | Send 20 accepts for B and one pending invitation | One durable membership and one acceptance event; successful retry outcomes point to same membership/practice; invitation accepted by B only |
| S25 accepted retry cannot restore old role | B accepts administrator invite, A later demotes B to viewer, B retries accepted link | Idempotent success/already-member reflects current viewer role; no promotion, role/version change, or extra acceptance event |
| S26 pending invite cannot change active role | B already manager of P; administrator invitation remains pending; B accepts it | `already-member`; role remains manager; no member/audit mutation; invitation remains pending |
| S27 other active practice blocks acceptance | B has active membership in Q and accepts P invitation | `other-practice`; Q untouched; no P membership; pending invite unchanged; response omits Q identity |
| S28 two-practice accept race has one winner | B without membership concurrently accepts valid P and Q invitations | Exactly one active membership/event; one accepted invitation; losing target remains pending; loser is neutral other-practice conflict |
| S29 create-versus-accept race leaves no orphans | B concurrently creates a practice and accepts P | At most one active practice; if acceptance wins, create returns P; if create wins, acceptance conflicts; only committed profiles have administrator/matching audit events |
| S30 accepted link cannot reactivate revoked user | B accepts, then is revoked; retry accepted link using old JWT | Invalid invitation/no reactivation; practice/member/events unchanged by replay; no creator or metadata fallback |
| S31 pending pre-revocation link cannot reactivate | While B is active, create pending invitation; revoke B; preview/accept old pending link | Reject because issued time is at/before latest revocation; no access restored; equality rejected too |
| S32 new explicit issuance can reactivate once | After revoke, A creates or reissues invitation; B accepts; revoke again and replay older pending/accepted links | Existing membership ID reused; version advances; issued role applied and event recorded once; latest revoked time retained; earlier-cycle links cannot restore access |

### Roles, revocation, and transactions — AC6–AC10

| ID / test name | Concrete action | Required outcome |
| --- | --- | --- |
| S33 full role matrix holds at every boundary | Parameterize administrator/manager/viewer/revoked/nonmember/anonymous for each implemented read/mutation | Exactly permission table's allow/deny behavior in routes/actions/Data API/RPCs; all denials assert no state or audit change |
| S34 member role change is versioned and audited | A changes B manager→viewer at expected member version, then submits stale version | First succeeds with one version increment and correct actor/before/after event; stale action conflicts without change |
| S35 last administrator remains | A is sole active administrator; try self-demotion/revoke with pending administrator invite present | Both return last-administrator; count remains one; no member/audit change; pending invitation does not count |
| S36 two administrators cannot remove each other | A and D concurrently demote/revoke each other, including queued stale actor checks | One eligible winner at most; at least one active administrator; losing actor rechecked after lock; no double-success/final-admin loss |
| S37 privileged invariant also rejects zero administrators | In local rollback-only SQL fixture, remove/demote last administrator or insert practice without initial administrator | Deferred constraint fails by transaction completion; no invalid practice survives; valid profile+administrator creation succeeds |
| S38 revoke takes effect with existing JWT | A revokes B manager and then creator D; reuse their same pre-revocation JWTs to read/mutate P | No P rows or team details; all subsequent RPC mutations denied; no auth refresh needed for membership revocation; Q unaffected |
| S39 queued profile edit rechecks role | B administrator opens profile form, then queued save waits while A revokes/demotes B | Post-lock save forbidden; no edit/version/profile-audit change; retained browser input and truthful access-lost state |
| S40 revoke retry cannot revoke a new grant | Revoke B, retry same revoke, explicitly rejoin B, then replay old expected-version revoke | Initial retry no-op/no extra event; replay after rejoin conflicts and cannot revoke newly granted membership |
| S41 access audits are atomic | Inject access-event failure for initial membership, invite create/reissue/cancel/accept, role change, revoke | Each actual operation fails and all related row/version/epoch/status/event changes roll back; restore trigger then legitimate retry succeeds once |
| S42 profile audit is still atomic | Force existing profile audit trigger failure during create/edit under new RPC | No profile/orphan membership or initial access event on failed create; edit preserves values/version; restore then retry works |
| S43 outages and expired auth cannot claim success | Inject transport/auth/read/write failures and expire session between open/action | Safe unavailable or auth-required according to boundary; no fabricated membership/profile/link; preserved inputs; retry follows persisted state rather than duplicating events |

### Browser context and accessibility — AC3, AC10–AC12

| ID / test name | Concrete action | Required outcome |
| --- | --- | --- |
| S44 join fragment survives permitted same-tab flow | Open `/join#token=...`, clear fragment into session storage, reload, complete OTP, accept | No raw token in HTTP query/path/referrer; same tab retains context until success; success clears it; another tab requires reopening link |
| S45 wrong-account sign-out clears context | C opens B link and is denied; signs out; reopen original link and sign in as B | Old tab context cleared on sign-out; reopened link restores it; B joins explicitly; C never sees P details |
| S46 GET and hostile destination never consume | Request join/preview-like GET, submit return destination `https://evil.test`, `//evil.test`, encoded variants, or a foreign-Origin action | GET does not accept; only allowlisted `/` or `/join` destination honored; no off-origin redirect or successful hostile write |
| S47 actual role controls and profile recovery persist | Sign in each role; edit→save→invalid/unavailable→valid retry as administrator | Administrator has edit/team controls; manager/viewer show read-only profile and correct role; revoked action safe; hidden expected profile version retains last successful save |
| S48 keyboard mobile and artifacts are verified | Use tab/enter, field errors, pending requests at 375px and desktop; attempt failure capture | Labels/error focus/pending disable work; no horizontal overflow; axe passes; invitation flows have no trace/automatic token screenshot; intentional images mask links; responses private/no-store and join no-referrer |

## Properties and Explicit Adversarial Pass

Property tests must pair positive and negative cases, assert real state, record seeds, and avoid invalid assumptions that simply reject all input. The example counts below are requirements; actual executions must be reported separately from intended counts.

| ID | Property / attack | Required evidence |
| --- | --- | --- |
| P01 | 1,000 seeded ASCII email variants around valid addresses, dots/plus tags, whitespace/control/case/length boundaries | Application and SQL canonicalization/rejection agree; valid cases accepted, invalid cases rejected |
| P02 | 1,000 strict team input objects and versions/roles/token shapes; 1,000 generated token round trips | Extra identity/unknown roles rejected; valid enums/versions accepted; generated token decodes to 32 bytes and digest matches independently; no test log prints token |
| P03 | 20 seeded real sequences of invite/accept/role/revoke/reissue/rejoin across two practices | After every committed step: one active practice per user, at least one admin per practice, monotonic member versions, no old pending reactivation, expected event counts; denied steps unchanged |
| P04 | Preserve 1,000-case real PostgreSQL Unicode profile parity and 20 existing API sequences | Authorized RPC storage still matches existing validation/identity/version contract; no privileged write substituted for user behavior |
| A01 | Guess P member/invite/practice IDs as Q account and anonymous; invoke public RPCs directly; try direct table/private access | No unauthorized rows/mutations; grants/foreign-practice targets denied; stored fields/events independently checked |
| A02 | Forge actor/practice/owner/role fields, `user_metadata`, auth cookies, expected versions, and digest/token formats | No authority from submitted identity/metadata; safe errors; real confirmed-user checks remain mandatory |
| A03 | Replay accepted and old pending links after revoke and after revoke/rejoin/revoke; race cancel/reissue with acceptance | No unauthorized reactivation, stale capability acceptance, role reset, duplicate event, or final-admin loss |
| A04 | Markup/email injection and foreign-Origin actions/return destinations; signed-out GET scanning | Render untrusted display text safely; no unapproved outbound destination, external message, or GET consumption |
| A05 | Inspect redacted logs/reports/errors/team responses and token-bearing browser fixture policy | Digest-only persistence; no unauthorized member email/Auth projections or raw token retained artifacts; document inspection limits |

`tools/access-adversarial.mjs` runs the A-prefix integration/browser tests against final source and asserts each expected case executed with an actual pass/fail outcome. A zero-test run, unrelated crash, skipped case, or stale JSON is a hard failure, not a passed attack.

## Must NOT — Negative Contract

Each N-row must be mapped in EVIDENCE, including explicit unverified/N-A reasons if applicable. None may silently disappear.

| ID | Invariant | Required verification |
| --- | --- | --- |
| N01 | No creator fallback, JWT-cached role, editable metadata, or form-derived actor authority | S33/S38/A01/A02; policy/RPC review and isolation/role mutants |
| N02 | No second active practice, zero-admin practice, orphan profile, or cross-practice relationship | S01–S06/S28/S29/S35–S37/P03; partial unique/FK/deferred constraints; races |
| N03 | No old pending/accepted link reactivation or overwrite of a current member's role | S25/S26/S30–S32/A03; epoch/lifecycle mutants |
| N04 | No raw token persistence/retained logs, unauthorized roster/Auth data, or public private schema | S08/S17/S20/S44/S48/A05; grants/projections/artifact controls and source review |
| N05 | No direct ordinary profile/member/private DML, protected-field transfer, practice deletion, or audit editing | Real grants/RPC/FK tests; private trigger EXECUTE denial; S1 behavior carried forward |
| N06 | No changed profile validation/timezone example/version-recovery behavior | S07/S47/P04 plus existing S1 scenarios; named boundary adaptation only |
| N07 | No nonlocal/non-fixture destructive reset, unrelated stack/process change, or un-restored SQL/source mutant | Local endpoint/data guards, upgrade controls, restore fingerprint/hash and full restored suite |
| N08 | No invitation email sender, real messages, hosted deployment, SMS, obligations, practice switcher, or account deletion | Capability/schema/dependency diff; explicit no external actions; scope checks with limits stated |
| N09 | No application service-role/secret key, new unjustified dependency, or application filesystem/subprocess capability | Existing secret/supply-chain/capability gates extended for RPC/crypto; dependency diff maps to SPEC |
| N10 | No silent SPEC drift, weakened behavioral assertion, skipped layer counted green, or stale final evidence | Approval revision history; frozen assertions; exact source/run/layer/test/mutant inventory controls |
| N11 | No implementation in the user's main checkout; no remote push/merge | Worktree/branch/source-state evidence and final diff review; documentation baseline is the authorized exception |

## RED → GREEN → REFACTOR Contract

After SPEC approval, execute one plan phase at a time. Create throwing stubs only when needed to make new tests fail on behavior rather than module imports. Record each new S/P/A test's actual RED run; tests initially green require an applied, executed, killed, restored throwaway mutant. Preserve existing behavior tests as regression armor with demonstrated sensitivity.

Adapt old direct-DML/mock expectations in a test-only step to the new approved RPC contract, observe failure, then implement in a separate step. Do not change assertion outcomes to match the implementation. While GREEN, run the complete unit suite and the relevant complete database/API/browser suites; expand to full checks for shared authority changes. Freeze assertions during implementation refactors. Separate any helper/fixture refactor, show green before/after, and rerun mutation.

## Gauntlet — One Final Fresh Run

Entry point remains **`npm run gauntlet`**. Keep every existing layer and add two explicit layers: `access-upgrade` before normal replay and `access-adversarial` after the production browser run. Synchronize `tools/gauntlet.mjs` and `tools/layers.json` to an exact **28-layer** inventory. Changing ordering inside dependent groups may be necessary, but deleting an assurance obligation is a SPEC amendment.

`access-upgrade` verifies S01–S03 using the original S1 migration boundary, real fixture snapshots, a failed transactional upgrade rehearsal, and the actual successful migration path. It restores the fixture stack before normal replay/tests. Discover supported CLI flags first; persist every exact command/fixture recipe in the harness. No reset runs on a hosted/shared/non-fixture target.

Final fresh execution deletes stale reports/coverage, uses one run ID, binds all layer results to the final clean source commit/hash, and checks the source restored unchanged. Logs/artifacts are redacted; successful results are recorded only after actual command completion. Evidence-only documentation commits afterward must distinguish report commit from tested source commit.

| Layer group | Commands / required outcome |
| --- | --- |
| Controls and sensitivity | `npm run test:controls`, `node tools/checker-sensitivity.mjs`; known-bad inputs fail for named reasons; temporarily removing each new defense makes its control fail |
| Static checks | `npm run typecheck`, `npm run lint`, `npm run format:check`; zero new errors/warnings; handwritten application function complexity maximum 10 |
| SQL lint and upgrade | `.venv-gauntlet/bin/sqlfluff lint supabase/migrations supabase/tests`, `node tools/access-upgrade.mjs`; actual upgrade/rollback and dialect validation pass |
| Replay/schema/database | `npm run db:reset`, `node tools/schema-fingerprint.mjs`, `npm run test:db`; real constraints/RLS/grants/RPC/trigger/index contracts verified |
| Integration and properties | `npm run test:integration`, `npm run test:coverage`; S/P named case inventory and actual counts/seeds recorded; no mock persistence |
| TypeScript mutation | `npm run mutation`; new/changed handwritten validation/auth/access/repository/action logic in scope; no unexplained non-equivalent survivor/no-coverage mutant; preserve enforced gate |
| Property-only mutation | `npm run mutation:properties`; report property suite alone, not full-suite attribution; scope to each declared invariant's implementation and report survivors/blind spots |
| SQL mutation and restoration | `node tools/sql-mutants.mjs`, fingerprint after restore; every listed actual fault applied/executed/killed/restored; full restored integration suite green |
| Generated types | `node tools/check-generated-types.mjs`; complete replayed public-schema types match committed source |
| Production execution and attacks | `npm run build`, `npm run test:e2e`, `node tools/access-adversarial.mjs`; real OTP/team/join/revocation flows and A01–A05 run |
| Owned executable-line coverage | `node tools/check-coverage.mjs`; existing gate executes every mapped owned TS/TSX statement-start line, including changed/added files, using unit plus real Node/browser maps; missing/uncovered/stale inputs exit nonzero; report branches separately |
| Suite health | Seeded unit/integration commands in `tools/layers.json`, `node tools/shuffle-browser.mjs`; all discovered expected tests executed, no skip/flaky/unexpected omission; record seeds/order |
| Capability/supply-chain/secrets | Existing capability/supply-chain/history/assets commands; RPC/crypto/clipboard/session-storage changes documented; exact inventories/advisories/licenses and limits reported, not a fictional zero-vulnerability count |

Generated database types, CSS, tests, framework code, and orchestration scripts are not claimed as application executable-line coverage. CSS/UI receives actual browser/axe/visual checks. SQL receives a changed-statement/predicate/constraint/grant/trigger/RPC mapping to real tests; missing entries block completion. Custom tools receive targeted controls, not blanket orchestration coverage.

### Required SQL/API Mutation Faults

One at a time: broaden practice isolation; skip live administrator check; restore creator fallback; drop active-user uniqueness; remove last-admin/deferred invariant; remove user/practice serialization at relevant race; omit profile/member expected-version check; bypass confirmed-email comparison; bypass invitation expiry or use transaction-start time; ignore latest revocation epoch; reapply accepted invitation role; remove profile/access audit atomicity; restore ordinary member/profile DML or expose private invite fields.

Every mutation must assert its actual applied source/catalog change and select a nonempty expected test inventory. Prove the intended failure, distinguish infrastructure crashes from kills, and restore source/schema in `finally` with independent fingerprints/hashes. A stale replacement, absent case, missing result, or skipped test is a hard runner failure. Stryker equivalents are classified with specific semantic reasons; do not quietly lower thresholds or suppress survivors. If the existing gate cannot express a justified equivalent exclusion, disclose and resolve that gate policy visibly before claiming pass.

### New/Expanded Checker Controls

Known-bad fixtures must demonstrate: missing/incorrect new table policy or RPC EXECUTE grant; dropped partial unique/FK/admin invariant; unreadable/missing upgrade snapshot; hosted/wrong-port/non-fixture reset target; empty/incomplete/duplicate/skipped adversarial or browser inventory; absent/stale coverage/source map; missing/duplicate layer; non-applied/nonexecuted/nonrestored mutant; token-bearing retained artifact.

Expand layer-inventory checks to reject duplicate IDs as well as wrong counts/missing IDs. A successful control proves its named failure path, not complete checker correctness. Temporarily remove each added defense to show its control is non-vacuous; restore and rerun control suite. Existing textual capability detection remains a spelling inventory with documented limits; behavioral grants/API tests provide distinct authority evidence.

## Independent Verification and Known Limits

Fresh-context verification of finished implementation: **not performed by default**, zero rounds. The earlier delegated planning review is not this protocol and cannot count as independent implementation verification. EVIDENCE must declare this downgrade. If separately requested, read and execute `old-coder/references/verifier.md` in full with blind/fresh inputs and human grading; do not claim it ran from a familiar-context review.

This contract covers the local pinned runtime/database and implemented surfaces. It does not establish hosted mail/deployment operation, regulatory suitability, exhaustive Unicode/email-provider semantics, deterministic timing under every possible load, independent security assurance, browser-process restart behavior, or deletion/retention workflows. No new latency/SLA/performance budget is claimed; bounded test timeouts detect hangs, not capacity. Concurrent reads already completed/rendered before revocation cannot be recalled; subsequent authority requests must deny.

## EVIDENCE and Completion

Create the evidence file only with truthful draft/unverified statuses until the final run completes. It must include:

1. Exact approval quote and approved SPEC commit; each later amendment and approval; setup/actual environment changes and worktree versus landing-tree differences.
2. Exact final tested source commit/hash, run ID, pinned/actual versions, and the single reproducible entry point. Every reported command exists in a persisted repository script/config.
3. Mapping of **S01–S48, P01–P04, A01–A05, N01–N11**, and all plan **AC1–AC12** to actual named tests/layers, with pass/fail/unverified/N-A status. Do not claim current planning baseline checks validate these future scenarios.
4. All 28 final fresh layer results with actual counts/exit codes, property seeds/examples, coverage numerator/denominator/branches, mutation categories/property-only outcomes, upgrade snapshots/rollback, stress/race state assertions, checker controls/sensitivity, and restored source/schema evidence.
5. RED observations, failures and fixes, dismissed findings with evidence, and any equivalent mutants or tool limitations. Report unavailable/substituted/N-A checks distinctly; an unavailable required behavior/gate blocks completed implementation.
6. Agent keyboard/mobile/visual observations separately from automation and any user sign-off. Independent verification always explicitly `not performed`, `passed`, `failed`, or `blocked` for the final source.

Implementation is complete only when all applicable scenario/invariant mappings and required gauntlet layers pass on the final source, no unexplained behavioral/mutation/checker gap remains, the restored source matches, and the result is delivered in its attached isolated checkout. This SPEC-writing task is complete when the reviewable document is saved and shown; application implementation waits for SPEC approval.

## Revisions

- 2026-10-05 — Initial E1-S2 executable contract derived from the researched four-phase plan. Adds named S/P/A/N cases, exact user-visible outcomes, setup/dependency/isolation authorization, explicit upgrade/adversarial layers, final evidence mapping, and checker controls. Proposed product defaults remain pending as part of SPEC approval. No application/test/schema/tool implementation, install, reset, commit, or worktree creation performed.

## Specification Preparation Record

Read the invoked skill, SPEC/EVIDENCE templates, gauntlet guidance, full referenced plan and verification record, and relevant existing tool/source contracts. Repository/artifact inspection found `main` at the baseline with no attached worktrees and only the three prior E1-S2 documents untracked.

The previous planning turn's unchanged-source baseline passed lint, types, and 99 unit tests. Those are historical baseline results, not a new SPEC or E1-S2 test run. This turn attempted CLI help; telemetry initialization failed with sandbox EPERM before help was displayed. Schema flags are not asserted as verified. Formatting and document consistency checks are recorded after preparation; no behavioral test or gauntlet result is invented.

Preparation checks: `npm run format:check` passed (exit 0). A document-only ID check found exactly 48 contiguous unique S rows, 4 P rows, 5 A rows, and 11 N rows; the existing persisted layer manifest contains 26 entries, and this SPEC explicitly proposes 28. New-file diff review found no whitespace diagnostics; the no-index diff exits 1 because the file is new. `git status --short` shows only the SPEC and the three prior E1-S2 documents untracked. The attempted `supabase db reset --help` and `supabase migration up --help` returned telemetry EPERM; neither reset nor migration execution was attempted. No application test rerun was needed for this documentation-only task.

## Approval Record

Pending. Append the user's exact approval words and the approved document/source state before implementation; do not infer approval from silence, recommended-option selections, or this SPEC-creation request.

- 2026-10-05 — User: **“continue with implementation”**, responding directly to the displayed specification and approval request. This approves the initial SPEC, including its product defaults, local setup, isolation, and checkpoint commits. The pending labels above remain historical preparation records. Source before approval commit: `491e6905bdbc2aa853c94c9cc7e192d51cd9a676`.
