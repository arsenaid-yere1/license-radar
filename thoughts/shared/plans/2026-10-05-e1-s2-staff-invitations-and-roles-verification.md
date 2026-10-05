# Verification Summary

Date: 2026-10-05
Plan: `thoughts/shared/plans/2026-10-05-e1-s2-staff-invitations-and-roles.md`.
Overall readiness: **Ready as a proposed local implementation plan**, using the explicitly stated product defaults. One-active-practice and copy-link delivery are not recorded as user-confirmed choices.

This is plan verification and existing-source baseline checking, not verification of implemented E1-S2 behavior.

## Findings

### Major: creator ownership cannot remain an authorization fallback — resolved

Location: Key Discoveries; Persistence and authority; Phase 1.

The existing policies and duplicate-create handling are tied to creator ownership. Merely adding membership rows would deny invited staff and retain revoked creator access. The plan replaces authorization with live active membership, keeps creator ID only as provenance, replaces creator uniqueness with active-membership uniqueness, and moves profile writes to audited transactional RPCs.

### Major: pending old invitations can restore revoked access — resolved

Location: Invitation lifecycle; AC7; Phase 2 verification.

An already-active user's pending invitation can survive until after revocation. Rejecting only accepted-history replay is insufficient. The revised plan stores database-managed issuance/revocation times and rejects pending invitations issued at/before the latest revocation. New or explicitly reissued invitations can deliberately reactivate; accepted-history retries cannot reactivate or reapply an old role. Repeated revoke/rejoin cycles are tested.

### Major: last-administrator checks must serialize and cover initial creation — resolved

Location: Transactions and concurrency; Phase 1/2 verification.

Two concurrent administrators could each observe another administrator unless mutations serialize. The plan locks the practice before fresh actor/count checks, uses one lock order, includes active-membership uniqueness, and requires deferred invariant checks for both new practices and membership changes. Profile writes also recheck administrator authority after locks. The plan includes opposing-admin operations and privileged constraint tests.

### Minor: database time must be checked after lock waits — resolved

Location: AC4; Invitation lifecycle.

Transaction-start `now()` can accept an invitation whose expiry passed during a lock wait. The revised plan checks database wall-clock time after locks and tests an acceptance queued past expiry.

### Major: old verification contracts exclude new authority surfaces — resolved

Location: Phase 1; Phase 4.

The fingerprint excludes new public tables/functions and execute grants; SQL mutants select old constraint/predicate locations; browser shuffle requires exactly ten results. The plan explicitly expands those contracts and keeps controls fail-closed. Generated public types and broad test/coverage discovery already support conventional new paths.

The Unicode property suite directly updates profiles as authenticated SQL, which will be denied under RPC-only writes. The plan names `tests/integration/practice-properties.test.ts` and preserves actual PostgreSQL parity and generated identity/version sequences through authenticated RPCs. Old repository/action mocks also need RPC outcomes.

### Minor: normalization and browser artifacts require explicit contracts — resolved

Location: Invitation lifecycle; Phase 3 automated verification.

Generic JavaScript trim and SQL trim can disagree, and locale-sensitive lowercasing need not match. The plan defines matching ASCII operations, bounded ASCII email validation, and parity tests. Token-bearing Playwright traces would contradict the intended artifact boundary; invitation specs now disable tracing/automatic screenshots and mask links in intentional verification images.

## Missing Work

No omitted implementation phase remains within the proposed scope. All application/schema/test/tool changes are future work. Multi-practice switching or application-sent invitation email would materially change this plan; these were offered as alternatives and remain unconfirmed.

## Risks

- RPC invoker wrappers/private definer grants must be verified against real local roles; private USAGE is intentionally broader than S1, while private table and trigger access remain denied.
- Lock order, post-lock snapshots, upgrade/backfill, deferred invariants, and invitation epochs are proposed contracts until demonstrated in real transactions.
- Existing owner-only binaries and the new membership/RPC schema require coordinated use.
- Browser token context is tab-scoped. Wrong-account sign-out clears it; reopening the invitation restores context.
- No hosted delivery or deployment is included. The available HTML changelog/topic documentation was reviewed; the markdown index fetch was unavailable.

## Suggested Changes

The concrete findings above have been incorporated into the plan. During implementation, preserve the existing profile acceptance assertions while updating their authority boundary. Do not refresh the schema fingerprint blindly or relax test/mutation/coverage gates to fit the new feature.

## Final Recommendation

The proposed plan is technically ready for implementation under its stated defaults. It does not claim product approval or authorize an implementation/deployment in this planning turn.

The parent read the full plan/research and key implementation sources. A delegated read-only pass traced existing test/tooling contracts, then reviewed the full draft for missing contracts and lifecycle/race gaps. The parent verified important findings in source and incorporated the revisions. This is a planning review, not an independent review of completed application code.

## Commands and results

Run from `/Users/macbookpro/Coding/license-radar` with `PATH="$PWD/.tools/node/bin:$PATH"` (Node 24.21.0):

| Command | Result |
| --- | --- |
| `git status --short`, `git log -5 --oneline`, `git rev-parse HEAD` | Initially clean; baseline `491e6905bdbc2aa853c94c9cc7e192d51cd9a676`; source/history inspected |
| `rg --files` and targeted `rg -n`, complete `cat` reads | Next story and relevant implementation/test/tool paths found |
| `npm run lint` | Passed, exit 0 |
| `npm run typecheck` | Passed, exit 0 |
| `npm test` | Passed, exit 0; 99 tests in 11 files; seed 20261003 |
| Prettier on the three new Markdown artifacts | Formatting applied; final repository format check recorded below |
| `npm run format:check` | Passed, exit 0; all matched files use Prettier style |

Only planning/research Markdown files are changed. No migrations, database resets, integration/browser suites, mutation runs, or full gauntlet were run in this turn. Their E1-S2 criteria are future verification requirements. No user product/manual sign-off was obtained.
