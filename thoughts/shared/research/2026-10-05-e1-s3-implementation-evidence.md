# E1-S3 recipient foundation implementation evidence

Status: recipient foundation implemented and verified locally; all 29 required verification layers passed. Production release, user-confirmed acceptance, and the original E2/E4 SMS integration gate remain separate.

## Behavior and ownership

This is one Next.js application. Routes/actions own navigation and verified requests; `src/lib/recipients/` owns validation and safe API outcomes; `src/components/recipients/recipient-panel.tsx` owns selection/recovery; the new migration owns authority, practice locking, versioned storage, and transactional audit/lifecycle behavior. No phone, consent, credential, cycle, or job tables were invented.

`supabase/migrations/20261006003555_practice_reminder_recipient.sql` adds private settings and recipient events. Existing/new practices start unassigned. `private.require_recipient_member` locks the practice and checks live active membership before reading or editing. Administrators/managers edit; viewers read a minimal selected person without candidates. The existing profile and team permissions remain unchanged.

`private.set_practice_reminder_recipient` checks expected version before no-op detection, rejects noneligible/foreign targets, and commits the new setting and event together. `private.mutate_member` invokes invalidation under its existing practice/member locks. Revocation/viewer demotion clears and audits; eligible role changes retain; promotion/rejoin never restores. Only `private.create_practice` and `private.mutate_member` changed among existing function bodies; existing schema sections, grants, policies, triggers, constraints, and indexes remain intact.

## Acceptance witnesses

| Criterion | Source and executable evidence |
| --- | --- |
| AC1 initialization/backfill/history | `private.create_practice`; R10 integration fault/retry; `tools/recipient-upgrade.mjs` snapshots all five E1-S2 application tables, two practice fixtures, full nine-section catalog rollback, null/version-one backfill, zero events, replay equality |
| AC2 eligible same-practice target | Setter and composite settings/events FKs; R01 real API role/target matrix; R11/R12 executed tenant constraints and helper/storage denials; R13 input properties |
| AC3 trusted authority | `saveRecipient` verifies Auth and derives practice from live access; private helper rechecks after lock; R15 operations, R01/R07 API; R22 browser manager restriction and viewer state |
| AC4 read isolation/current JWT | R01 minimal viewer projection and foreign/revoked denials; R05 reuses revoked JWT; R22 browser no picker and no-store response |
| AC5 independent version/no-op/race | R04 audit transitions, stale/no-op and unchanged profile version; R06 deliberately held practice lock, observed wait, one winner |
| AC6 private atomic audit | R04 exact actor/IDs/versions/reason/time; R08 assignment/replacement/clear/invalidation audit faults; R11 SQL grants; R12 event shape |
| AC7 access invalidation/rejoin | R05 eligible transition, viewer demotion, revoke and rejoin; R08 atomic access/membership/recipient rollback; R09 missing settings fails even unselected invalidation; R22 team explanation/demotion |
| AC8 post-wait live checks | R07 independent practice-only lock witness, candidate demotion/revoke, revoked editor, and assignment-before-demotion, all with separate sessions and observed wait |
| AC9 recovery/version state | R13/R15–R17 strict values/duplicates/files/forged fields/outages/malformed responses; R19 panel retained choice/pending/newest version; R21 conflict; R23 real storage failure and blocked pending action; R24 candidate invalidation recovery; R25 deliberately lost browser response after successful database commit |
| AC10 UI/accessibility/regression | R20 clear confirmation; R21 keyboard, axe and 375px overflow; R22 roles; R23 foreign-Origin rejection; inherited profile/team/join browser suite |

## Verification workflow

Use `.tools/node/bin` (Node 24.21.0) and the dedicated fixture-only local Supabase project. Local resets/upgrade/fault tests passed the fixed-project, loopback-endpoint and fixture-account guards. Production was not changed.

Commands executed during development: CLI migration/type command help; `npm run db:reset`; local public type generation; `npm run test:db`; `npm run test:integration`; `npm test`; `npm run typecheck`; `npm run lint`; `npm run format:check`; SQLFluff fix/lint; `npm run test:controls`; `node tools/recipient-upgrade.mjs`; `node tools/schema-fingerprint.mjs record`; `npm run build`; targeted Playwright; `npm run mutation`; `npm run mutation:properties`; `node tools/sql-mutants.mjs`.

Intermediate failures led to corrections: upgrade fixtures now decode the composite creation response as JSON and use the existing member-role argument order; browser alerts are scoped away from Next's route announcer; keyboard focus and Enter submission use stable native select setup; unit selectors read the full current-recipient paragraph; UI functions meet the existing complexity limit. Initial mutation survivors revealed missing empty-object rejection coverage and equivalent discriminator dispatch. The input/output schemas use ordinary unions of explicitly tagged objects; accepted contracts are unchanged. No threshold, checker, or gate was relaxed.

Minor plan adjustment: extracted the existing catalog queries unchanged into `tools/schema-catalog.mjs` so the upgrade can fingerprint the same transaction/session before and after rollback. A focused checker test verifies all nine sections including function bodies and ACLs. Broader browser profile version assertions were scoped to the profile fieldset because there are now independent versioned forms.

## Manual and future acceptance

Agent visual inspection of the local mobile screenshot is distinct from user acceptance. Automated keyboard/axe/overflow checks do not claim user-confirmed manual testing.

SMS readiness remains false. Original rule 9 (cancel former unsent jobs and create eligible in-window catch-up jobs) remains a mandatory E2/E4 gate, detailed in the approved plan. The foundation does not complete that original SMS criterion. Production migration/deployment and real recipient changes remain separately authorized work.

Final review added client-side handling for action transport exceptions. A lost response keeps the proposed selection, reports that the save could not be confirmed, disables repeat submission, and requires reload to reconcile committed state. The initial gauntlet controller was stopped before the SQL fault campaign, then restarted from the updated local checkpoint.

The practice-lock fault initially survived because settings and foreign-key locks masked the setter’s wait. The final independent witness holds only the practice lock and invokes the read operation (no foreign-key writes), proving the shared helper itself waits before projection. A failed witness uses a behavioral assertion, preserving the fault checker’s distinction between test failures and infrastructure errors.


## Final current-source verification

`npm run gauntlet` passed **29/29** layers. Run ID: `427c847b-8580-4f0b-bcd6-4a4a3b4cf6c5`. Tested source commit: `6bb56868c3de30da07c344c782a9b9c2435fc6f1`. Source hash: `bd653514897363b23681baddc7107796744a008da819abb2f9e8ac6abb2cb238`. Started 2026-10-06 01:13:48 UTC; finished 01:29:09 UTC. No application source changed during that run. Subsequent changes record documentation only.

| Command/check | Final result |
| --- | --- |
| `npm run test:controls`; checker sensitivity | 28 checker controls passed; deliberate checker failures detected |
| `npm run typecheck`, `npm run lint`, `npm run format:check`; SQLFluff lint | Passed |
| `node tools/access-upgrade.mjs`, `node tools/recipient-upgrade.mjs`, `npm run db:reset` | Both guarded upgrade rehearsals and fresh replay passed |
| Recipient E1-S2 history snapshot | Exactly preserved 2 practices, 4 memberships, 6 invitations, 4 profile audits, and 17 access events; full catalog rollback matched; 2 null/version-one settings, zero fabricated recipient events |
| Schema fingerprint and `node tools/check-generated-types.mjs` | Reviewed schema and fresh public types matched; schema restored after faults |
| `npm run test:db` | 72 SQL assertions; 23 applied FK/index/invariant/grant controls detected and rolled back |
| `npm run test:integration` | 63 tests passed; also passed after restored faults and with shuffled seed |
| `npm run test:coverage`, `npm test` with shuffled seed | 181 unit tests passed |
| `npm run mutation`, `npm run mutation:properties` | Both unchanged 100% thresholds passed; no surviving or timed-out mutants (compiler-rejected mutations separately recorded) |
| `node tools/sql-mutants.mjs` | All 44 actually applied SQL/API faults caught and independently restored; full restored integration suite passed |
| `npm run build`, `npm run test:e2e`, `node tools/shuffle-browser.mjs` | Production build passed; all 24 browser scenarios passed normally and in recorded shuffled order, with no skips |
| `node tools/access-adversarial.mjs` | Deliberate browser authorization faults caught; compiled source restored |
| `node tools/check-coverage.mjs` | 2,442/2,442 executable lines across 44 application files; browser and real Node maps verified; branch coverage reported separately at 88.17% |
| Capability/dependency/secret layers | Passed; zero runtime advisories, five classified development findings, zero Python advisories; Git history and built static assets secret scans passed; token-bearing artifact controls passed |

Ignored `reports/gauntlet.json` and per-layer logs contain the raw local run record. The durable evidence above distinguishes automated success from agent visual observation and pending user acceptance. No threshold or required layer was removed. The final diff was reviewed against the baseline; original migrations and unrelated application behaviors remain intact.
