# E1-S3 recipient foundation implementation evidence

Status: local implementation complete; final 29-layer verification pending. Production release and user-confirmed acceptance are separate.

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
| AC9 recovery/version state | R13/R15–R17 strict values/duplicates/files/forged fields/outages/malformed responses; R19 panel retained choice/pending/newest version; R21 conflict; R23 real storage failure and blocked pending action; R24 candidate invalidation recovery |
| AC10 UI/accessibility/regression | R20 clear confirmation; R21 keyboard, axe and 375px overflow; R22 roles; R23 foreign-Origin rejection; inherited profile/team/join browser suite |

## Verification workflow

Use `.tools/node/bin` (Node 24.21.0) and the dedicated fixture-only local Supabase project. Local resets/upgrade/fault tests passed the fixed-project, loopback-endpoint and fixture-account guards. Production was not changed.

Commands executed during development: CLI migration/type command help; `npm run db:reset`; local public type generation; `npm run test:db`; `npm run test:integration`; `npm test`; `npm run typecheck`; `npm run lint`; `npm run format:check`; SQLFluff fix/lint; `npm run test:controls`; `node tools/recipient-upgrade.mjs`; `node tools/schema-fingerprint.mjs record`; `npm run build`; targeted Playwright; `npm run mutation`; `npm run mutation:properties`; `node tools/sql-mutants.mjs`.

Intermediate failures led to corrections: upgrade fixtures now decode the composite creation response as JSON and use the existing member-role argument order; browser alerts are scoped away from Next's route announcer; keyboard focus and Enter submission use stable native select setup; unit selectors read the full current-recipient paragraph; UI functions meet the existing complexity limit. Initial mutation survivors revealed missing empty-object rejection coverage and equivalent discriminator dispatch. The input/output schemas use ordinary unions of explicitly tagged objects; accepted contracts are unchanged. No threshold, checker, or gate was relaxed.

Minor plan adjustment: extracted the existing catalog queries unchanged into `tools/schema-catalog.mjs` so the upgrade can fingerprint the same transaction/session before and after rollback. A focused checker test verifies all nine sections including function bodies and ACLs. Broader browser profile version assertions were scoped to the profile fieldset because there are now independent versioned forms.

## Manual and future acceptance

Agent visual inspection of the local mobile screenshot is distinct from user acceptance. Automated keyboard/axe/overflow checks do not claim user-confirmed manual testing.

SMS readiness remains false. Original rule 9 (cancel former unsent jobs and create eligible in-window catch-up jobs) remains a mandatory E2/E4 gate, detailed in the approved plan. The foundation does not complete that original SMS criterion. Production migration/deployment and real recipient changes remain separately authorized work.
