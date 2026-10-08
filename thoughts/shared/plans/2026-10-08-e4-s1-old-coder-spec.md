# SPEC — E4-S1 phone verification and reminder consent

- Tier: 3 (privileged proof, tenant authorization, concurrency and external provider).
- Contract: `thoughts/shared/plans/2026-10-08-e4-s1-phone-enrollment.md`, AC1–AC10. This specification adds named executable witnesses; it does not replace that plan.
- Spec approval: not obtained (autonomous run). The user requested “create specs and implement it”; independent review of this newly written specification has not occurred.
- Setup: reuse Node 24.21.0, Supabase CLI 2.119.0, PostgreSQL 17, Vitest, Playwright, fast-check, Stryker, SQLFluff and the existing gauntlet. Add exact runtime dependencies `twilio@6.1.2` (official Verify/signature adapter) and `server-only@0.0.1` (build-time privileged import boundary). Review transitives with the supply-chain gate. No production/provider provisioning or real SMS.
- Git: retain the current suitable checkout; checkpoint specification, persistence, application and verification as local commits. No push or deployment.
- Artifacts: add the CLI-named `supabase/migrations/*_practice_sms_enrollment.sql`, `supabase/tests/practice_sms_enrollment.test.sql`, `tests/integration/practice-sms-enrollment.test.ts`, `tools/sms-enrollment-upgrade.mjs`, `tools/sms-provider-fixture.mjs`, `tests/helpers/sms-fixtures.ts`, `tools/sms-capabilities.mjs`, `tools/sms-controls.test.mjs`, `tests/e2e/practice-sms-enrollment.spec.ts`, SMS domain/unit/property/UI tests, and source-bound evidence under `thoughts/shared/research/`. Reuse and extend existing gauntlet, source-state, schema, mutation, coverage, secret and supply-chain tools. Do not reduce their gates.

## Failure model

| Failure | Required witness |
| --- | --- |
| Forged proof or another tenant/person's enrollment | Ordinary RPC/table/helper denial; live authenticated API matrix; server import controls |
| Stale provider approval after replacement/revocation | Real database sessions with observed lock waits, both commit orders |
| Consent restored by retry, assignment, promotion or START | Receipt replay/current-state assertions; lifecycle and callback API tests |
| STOP races consent or proof; shared phone leaks tenants | Endpoint-only suppression; both serialization orders; owner-safe/shared projection assertions |
| Provider accepted but reply/commit is lost | Durable leases and receipts; fixture acceptance/lost-response contract tests |
| Parallel requests bypass limits | Persisted reservations, send/check budget boundary and concurrency tests |
| Upgrade loses rows or rollback leaves objects | Exact all-14-table snapshots, transactional rollback and complete catalog comparison |
| Phone, OTP or credentials leak | Private browser artifacts; sanitized outputs/ledgers; client import and asset scans |
| Fixture runs against hosted targets | Exact loopback and explicit-flag negative controls |
| UI implies delivery or verification implies consent | Production-local browser workflow and explicit inactive-delivery assertions |

## Scenarios

Each named scenario is an executable test name or a named multi-layer witness in the final evidence mapping. Any unmapped or unexecuted scenario remains unverified.

1. **Additive upgrade preserves historical rows** — populated practices, members, register, coverage, cycles, audits and receipts remain byte-equivalent; legacy recipient responses still have `ready: false`; there are zero enrollment/consent backfills.
2. **Empty enrollment is owner-safe** — an active member without a row receives version 1, revision 0, `not-started`, no phone/challenge/consent and `deliveryActive: false`.
3. **Only the active owner can prepare verification** — admin/manager succeeds; viewer, revoked, foreign and anonymous actors fail without writes. Posted actor/practice/member/proof fields fail strict parsing.
4. **Phone syntax is explicit international ASCII** — ASCII surrounding whitespace is trimmed; `+12025550123` is accepted; local numbers, Unicode digits/whitespace, extensions, leading zero and more than 15 digits are rejected.
5. **Phone replacement invalidates prior proof** — confirmed replacement advances phone revision/version, removes verification/consent and invalidates old challenges. Stale versions conflict before a no-op.
6. **OTP permission never grants reminder consent** — preparation records exact server-owned OTP disclosure and no reminder-consent event.
7. **Only trusted matching approval records proof** — direct authenticated/anonymous service RPCs fail; wrong account/service/SID/phone/channel or non-approved responses never verify.
8. **Verification needs separate reminder consent** — approved proof produces `consent-required`; unchecked consent fails; explicit true with the current version creates exact disclosure proof and `enrolled`.
9. **Selected readiness requires personal current enrollment** — assignment alone is never ready; independently enrolled selected active editor becomes `enrollmentReady: true`, with `deliveryActive: false`; other members receive no phone suffix or proof details.
10. **Withdrawal is immediate and idempotent** — one owner action clears consent; repeated withdrawal/replayed old consent cannot restore it; active viewers can withdraw but cannot verify/enroll.
11. **Access loss invalidates unselected enrollment** — viewer demotion/revocation clears proof/consent/challenges atomically whether selected or not; promotion/rejoin does not restore them; eligible role changes retain them.
12. **One live challenge exists per endpoint** — parallel users sharing a phone cannot allocate two live challenges; expired challenge is retired under the endpoint lock before a successor.
13. **Resend retains first expiry** — a new send request uses the known SID/current challenge; expiry remains ten minutes from the first request.
14. **Send budgets count every reservation** — 60-second cooldown, 5/30-minute and 10/day phone/actor limits and 100/day tenant limit include failed/unknown sends and cannot be bypassed by new request IDs, phone changes or membership transitions.
15. **Code checks are bounded and serialized** — exactly five reservations at most; one leased check; expiry at ten minutes rejects proof; codes contain exactly six ASCII digits and never enter a receipt/audit/result.
16. **Requests are immutable and claimed once** — duplicate exact requests return current state without another provider call; reused IDs with changed non-OTP payload/intent conflict; expired 30-second claims become uncertain, never automatically replay.
17. **Unknown acceptance fails closed** — lost start/check outcome is uncertain until expiry; no 404/client claim creates proof; committed proof with a lost response is recovered from current durable state.
18. **Stale approval loses to replacement or access loss** — both lock orders end with only current revision/live membership eligible; delayed callbacks cannot verify stale state.
19. **Audit and receipt faults roll back mutations** — forced persistence failures leave versions, proof, consent, challenges and events unchanged.
20. **STOP is signed and globally terminal** — valid canonical-URL/account/service/allowlisted-destination STOP atomically appends one sanitized event and suppresses all enrollments on that endpoint; unknown phone creates a tombstone.
21. **Callback duplicates do not duplicate suppression** — same MessageSid/content is idempotent; incompatible duplicate fails; no Body or raw payload is stored.
22. **START and HELP never restore consent** — recognized events are stored without unblocking; delayed START cannot defeat STOP; no application confirmation SMS is sent.
23. **Hostile callbacks fail before persistence** — absent/bad/altered signature, URL/fields/account/service/sender, duplicates, malformed phones/SIDs, wrong media type or oversized body are rejected with private no-store responses.
24. **Callback storage failure is retryable** — failed transaction returns 503, no partial suppression; retry succeeds before 2xx.
25. **STOP wins consent and approval races** — witnessed endpoint-lock orders never leave readiness true after committed STOP, without cross-tenant lock inversion.
26. **Missing setup disables collection and sending** — enrollment shows setup unavailable; withdrawal/status and unrelated routes still work; live flag off does not disable configured STOP validation.
27. **Fixture mode fails closed** — only explicit guarded local app/database/provider URLs and test credential enable it; hosted/deployment/conflicting-live/missing values fail; no universal application OTP bypass.
28. **Enrollment survives refresh and sign-in** — real production-local actions/DB/fixture complete request, wrong code, proof, explicit consent, refresh, withdrawal and replacement; code input clears after each response and drafts are not persisted.
29. **Enrollment refresh is independent of assignment version** — shared readiness updates with unchanged selection version; safe assignment copy does not claim incomplete enrollment.
30. **Private actions reject foreign Origin** — real browser replay cannot request verification or modify consent; private pages/responses are no-store.
31. **Enrollment is accessible on mobile and desktop** — keyboard/focused feedback, labels, Axe, terms/privacy links and no overflow at 375px/1440px; sanitized manual screenshots contain no phone/code inputs.

## Must NOT

- No renewal jobs, reminders, delivery activation, SMS sign-in, Auth phone mutation, behalf consent or automatic consent restoration.
- No exposed SMS tables, client service credentials/raw privileged client exports, OTP persistence/logging/URLs/storage, shared phone/suffix disclosure, arbitrary fixture URLs or live provider calls in automated tests.
- No weakened inherited tests, coverage/mutation thresholds, layer inventories or capability controls. Existing 32 layers remain; SMS upgrade adds the 33rd.
- No claim of live acceptance, operator/legal approval or independent verification without observed evidence. Phase 6 remains a separately authorized activation task.

## Revisions

- 2026-10-08: Initial specification, before implementation. Provider versions resolved from package metadata. Automated-only local implementation follows the user's instruction without a separate spec-approval exchange.
