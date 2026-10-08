# Verification Summary

Date: 2026-10-08 (America/Los_Angeles).
Plan: `thoughts/shared/plans/2026-10-08-e4-s1-phone-enrollment.md`.
Baseline: `886133312e5e7a8b89a327a43c5e918253a8bcc3`.
Overall readiness: **Ready for local implementation using the proposed Twilio default.** Live activation remains conditional on external setup and designated test-phone acceptance. Provider selection was asked asynchronously and is an explicit unconfirmed planning assumption.

This is a primary-agent plan review, not an independent implementation review. No source or database implementation has begun.

## Findings

### Major: trusted verification must not be an authenticated approval flag — resolved

Location: Private data and permissions; Phase 2.

The application's existing client uses only the session-bound publishable key. Allowing an authenticated caller to post provider approval would let the user manufacture phone proof. The plan instead isolates a server-only privileged repository, binds persisted requests to verified identity, rechecks live membership/revision in SQL, grants proof commits only to the service role and tests direct authenticated/anonymous denial. Its checker exception is explicit and bounded; it does not rename a key to evade the current ban.

### Major: resend requests and active challenges needed separate records — resolved

Location: Proposed private data tables; state transitions.

One record per send combined with one active challenge per phone would prevent a legitimate resend or accidentally create another challenge. The plan now has a durable challenge plus distinct send/check request records, with the same challenge SID/first expiry for resends, one active challenge per endpoint, immutable OTP-free receipts and an explicit new request ID for each entered code. Expiry transitions occur under the endpoint lock; no time-dependent uniqueness predicate is proposed.

### Major: shared-phone STOP must not acquire tenant locks in reverse order — resolved

Location: Locking and callback suppression.

Bulk mutation of every enrollment for a phone would require cross-practice locks and risk inversion against member/phone changes. STOP now updates only the global endpoint/event ledger. Every eligibility calculation consults that endpoint's suppression state/epoch. User mutations lock practice before endpoint; member invalidation never locks the endpoint; STOP never locks practice/member/enrollment. Both ordering outcomes require witnessed real-session tests.

### Major: rollback and a disabled live flag must retain callbacks — resolved

Location: Server configuration; Phase 6; rollback.

Promoting the prior app would remove the new STOP route, and using one enable flag for the entire module would stop processing withdrawals when sends were disabled. The plan requires separate callback persistence/validation from live-send enablement, retains withdrawal/status paths on provider failure, and preserves a callback-capable deployment during rollback. Historical consent/suppression data is not dropped.

### Minor: legacy readiness and refreshed enrollment versions — resolved

Location: Current State; detailed projection; UI.

The deployed recipient parser requires literal false and three exact readiness reasons. The new projection does not change that legacy response. Enrollment has its own version, and the UI refresh witness covers updated enrollment with unchanged recipient-assignment version. Assignment success copy must describe responsibility without claiming enrollment state.

### Minor: OTP notices, configuration, expiry and artifact scope — resolved

Location: Disclosure/activation; Phase 4 verification.

The plan explicitly records requested-code permission independently from recurring reminder consent, requires actual terms/privacy/support configuration before live use, derives expired challenges from DB time, and disables code/phone-bearing diagnostic captures. Callback sender allowlist and private-schema service-role usage are now explicit. No contact, legal approval or live provider acceptance is invented.

## Repository facts verified

- README, original P0 backlog and latest production handoff agree on E4-S1. E3-S2 deployment and its 32-layer success are historical, not newly executed checks.
- Current implementation is one Next.js application. Existing `getPracticeAccess` returns no membership ID; current membership/actor must be resolved at the authorized database boundary.
- Recipient storage, projection, independent version, candidate permissions, transaction audits and practice-first invalidation boundary were inspected. Legacy APIs and `recipientSchema` require false readiness.
- Existing `.env.example`, server client, package manifest and route inventory have no SMS provider or service client. Auth email-code configuration remains separate from proposed phone enrollment.
- Existing capability code rejects service-key spellings and editable auth metadata. Schema catalog includes all private objects and public/private nonextension function bodies/ACLs, so new private objects are discoverable without adding public SMS tables.
- Migration inventory contains 14 application tables, including register-change receipts. The new upgrade rehearsal must preserve all 14, not copy an earlier upgrade's smaller table list.
- Local fixture preparation currently writes only public configuration; upgrade scripts call it again. Secret/fixture preparation therefore needs an explicit extension that survives replay without logging credentials.
- Unit/integration discovery is automatic; mutation/property lists, SQL exact TAP inventories, required layer IDs and recorded dependency pins need scoped extensions. Adding only the SMS upgrade layer changes 32 to 33, while preserving existing thresholds and checks.
- Existing recipient unit/API/browser tests cover authorization, immutable private state, audit rollback, witnessed waits, lost responses, foreign Origin, no-store headers and private browser artifacts. Proposed SMS witnesses extend those patterns.
- Every command family in the phase plan exists in `package.json` or inspected tools; new migration/script/test names are proposed, not reported as existing implementation.
- Official provider verification/opt-in/opt-out/signature contracts and Supabase grants/function guidance are recorded with links in the research. The Markdown changelog and npm-registry pages could not be rendered; the HTML changelog/relevant change and official SDK repository were available. Exact SDK dependency versions must be resolved and reviewed during implementation rather than invented here.

## Missing Work

No material local implementation step is omitted: schema/access, provider trust, limits/recovery, signed callbacks, UI/disclosures, offline server fixture, legacy compatibility, upgrade/rollback, checker/dependency changes, properties/mutation, integration/browser regressions and documentation are planned.

External provider choice/provisioning, actual contact and terms/privacy review, sender/service configuration, authorized live phone tests and human acceptance remain explicit activation prerequisites. The request is planning; none is represented as completed. Same-number resubscription after provider STOP is deliberately deferred to E4-S4 and must be shown as blocked, even after START. Job invalidation/catch-up and original E1-S3 rule 9 remain E4-S2/S3 obligations.

## Risks

- Service credentials create a new privileged server capability; static import controls, production build/asset checks and SQL role-denial tests must establish the intended boundary.
- Provider approval and database commit may diverge. The proposed state machine rejects inferred success and recovers committed receipts; unresolved approval requires a fresh verification after expiry.
- Shared-phone suppression and membership transition budgets require real race witnesses. A stale snapshot may show older status until reread, but subsequent authoritative operations must fail closed.
- Offline provider contracts cannot establish live handset delivery or actual service/sender configuration. Live tests remain a separate recorded acceptance boundary.
- STOP is intentionally conservative and terminal locally in this story. Future resubscription must reconcile authoritative provider state and fresh practice-specific consent rather than treating START as sufficient.
- Consent/phone retention, customer-care details and deployment rollback preserving the callback require operator attention before activation.

## Suggested Changes

The findings above are incorporated. Preserve the explicit local/live boundary, legacy API, separate OTP/reminder consent and current verification gates. Do not broaden enrollment into scheduling or lower the checker to a blanket service-key exception.

## Final Recommendation

Proceed with phased local implementation when requested, using the stated provider assumption. Run each phase's narrow checks before the full 33-layer implementation gate. Resolve live configuration and test-phone prerequisites before activating external messages. This planning request does not authorize implementation, deployment or real text delivery.

## Planning-task checks

Recorded after formatting and final scope review below. Runtime lint/types/unit/API/browser checks are not required for three documentation-only files and were not rerun; the plan enumerates them for actual implementation. No local reset, fixture mutation, provider call, source commit or hosted change occurred.

- `.tools/node/bin/node --version` and the bundled Prettier version check: Node 24.21.0 / Prettier 3.9.9 confirmed.
- Explicit Prettier `--write` then `--check --ignore-path /dev/null` for all three documents: passed; thoughts are otherwise ignored by normal formatting.
- `PATH="$PWD/.tools/node/bin:$PATH" npm run format:check`: passed.
- `git diff --check` and added-file `git diff --no-index --check /dev/null <document>` for each new document: passed without diagnostics. Git's expected comparison status 1 was accepted only with empty output.
- Final scope/progress inspection: exactly three new research/plan/review documents; no tracked runtime/schema/dependency/configuration changes; every implementation/acceptance checkbox remains unchecked.
- Primary-agent review: plan reread; current recipient/access/provider absence, table inventory and tooling contracts verified; findings above incorporated. No independent review or implementation verification is claimed.
