# E1-S2 implementation evidence — in progress

Approval: user “continue with implementation”, in direct response to the initial SPEC approval request. Approved documentation commit: `defdc87`.

Isolated checkout: `/Users/macbookpro/.codex/worktrees/e1-s2-staff-access/license-radar`; branch `codex/e1-s2-staff-access`. Main contains only the approved documentation checkpoint.

No E1-S2 scenario or gauntlet pass is claimed yet. Independent verification: not performed. Final 28-layer run and all scenario/invariant mappings are pending.

## Setup and observations

- Existing pinned dependencies rebuilt with `npm ci --no-audit --no-fund`: exit 0, 687 packages. No dependency manifest changes.
- Docker inspection identified the dedicated `license-radar-e1-s1` stack and the unrelated `cliniq` database. The latter is outside task scope.
- Pinned Supabase `db --help` and `migration new --help` succeeded with local sandbox escalation. No schema/reset action has run yet.

## Membership checkpoint (intermediate results, not final evidence)

- CLI-created migration: `20261005211436_practice_membership_authority.sql`. Membership backfill, live RLS, RPC-only profile writes, user serialization, deferred administrator invariant, and transactional access audits implemented.
- RED observations persisted in `tools/red-history.json`: 4 integration failures before migration; 7 adapted unit failures before RPC implementation; 6 access-helper failures against its throwing stub.
- First local migration test exposed an invalid `OLD.practice_id` reference on the practice trigger row. Nested row-kind checks fixed it; 4/4 membership integration tests passed afterward.
- Complete unit suite: 105/105 tests in 12 files; `npm run typecheck` and `npm run lint`: exit 0. Complete API suite before fresh replay: 11/11 in 3 files, including 1,000 real PostgreSQL Unicode cases and 20 generated API sequences. SQL suite: 20/20 plus real foreign-key negative controls.
- First complete integration run failed writing an absent ignored `reports/` directory after its behavior assertions passed; created the directory and reran successfully.
- `node tools/access-upgrade.mjs`: exit 0. Actual S1 reset, 2 fixture profiles at versions 2 and 3, 5 old audit events; deliberate transactional upgrade failure observed and rolled back; actual CLI migration upgrade preserved rows; 2 creator-administrator memberships and initialization events; final fresh replay schema matched upgraded schema. No historical reports copied as evidence.
- `npm run gauntlet` is still pending; these intermediate passes do not satisfy final evidence. New checker controls/sensitivity, SQL lint, browser tests and Phase 2–4 remain pending.
