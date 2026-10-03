# Verification Summary

Reviewed: 2026-10-03
Plan: `thoughts/shared/plans/2026-10-03-e1-s1-practice-profile-and-timezone.md`
Overall readiness: **Ready** for local implementation, following the documented environment preflight.

This is a planning review performed in the current chat, not an independent code review and not verification of a completed application.

## Findings

### 1. Runtime and framework choices needed a concrete baseline — resolved

Severity: Minor
Location: Key Discoveries; Chosen foundation; Phase 1
Description: The initial draft required a supported LTS runtime but left its major version and the session-refresh filename conditional. The host's Node 26 is Current rather than the selected LTS baseline.
Recommendation implemented: The final plan chooses Node 24 LTS and Next.js 16, records actual patch versions during scaffolding, and uses `src/proxy.ts`. Official Next.js/Supabase guidance and the Node release table support these choices.

### 2. Scaffolding must preserve the existing documentation — resolved

Severity: Minor
Location: Chosen foundation
Description: The repository root is non-empty because it contains the research and planning documents. A generator can reject it or introduce unwanted file collisions.
Recommendation implemented: Scaffold in a temporary directory if needed and copy only checked new files; preserve `thoughts/`.

### 3. Name-length and deletion invariants needed explicit contracts — resolved

Severity: Minor
Location: Proposed persistence and access model; Phase 3 verification
Description: JavaScript string length and PostgreSQL character length can differ for Unicode input. Referential deletion behavior was also unspecified.
Recommendation implemented: Count Unicode code points consistently, test boundaries, and restrict destructive deletion of practices with owner/audit relationships. Deletion and retention workflows remain separate stories.

## Missing Work

No missing work remains within E1-S1's stated scope. The plan includes authentication bootstrap, configuration, database schema/grants/RLS, audit transactions, validation, create/update concurrency behavior, UI states, real-user database/API/browser tests, documentation, and rollback behavior.

Application dependencies, local Supabase initialization, actual migrations, and tests are future implementation work. Their absence is verified current state, not evidence of failed implementation.

## Risks

- Docker is installed but its daemon and image availability have not been checked. Supabase CLI is not installed globally; the plan includes a pinned local dependency.
- Package installation and runtime setup may require network access not available through the current shell sandbox. The earlier read-only changelog curl failed DNS resolution; official documents were retrieved through the web tool instead.
- Hosted email sending and production project credentials remain pilot prerequisites, not part of the local story.
- Ownership-only access deliberately supports one owned practice per account. E1-S2 must add staff memberships before shared access is enabled.
- A plan cannot establish working RLS, auth cookies, or email delivery. Real local tests are explicit completion requirements.

## Suggested Changes

The three concrete revisions above have been incorporated. During implementation, follow the current CLI help and pinned package documentation; do not use outdated auth helpers, broad grants, a service-role application client, or mocked persistence to satisfy acceptance criteria.

## Final Recommendation

Approve the plan for local implementation. The user's requested deliverable here is the plan; no application implementation or external provisioning was performed.

Review evidence: the entire plan and original research document were read, repository inventory and available runtimes were inspected, existing/future paths were distinguished, and the accepted story/stack were checked against the user's responses. Review covered route/auth behavior, ownership policies, immutable columns, database uniqueness/version guards, private trigger scope, audit atomicity, timezone validation, test coverage, scaffolding preservation, and rollback.


## Implementation completion record — 2026-10-03

The original planning text above is retained unchanged as history. The user approved the old-coder executable specification with **“approved”** before implementation.

- Phase 1: Next.js 16 / Node 24 foundation, email OTP, protected routing, cookie refresh and sign-out implemented and verified against local Supabase/Mailpit.
- Phase 2: Owner-scoped practice storage, column grants/RLS, optimistic versioning and atomic private audits implemented. Fresh replay, actual two-account access, 20-way creation, conflicting edits, rollback and restrictive foreign keys verified.
- Phase 3: Practice creation/settings, name and timezone validation, editable browser suggestion/UTC fallback, truthful example, retained errors and accessible mobile form implemented. Real Chromium production flows, keyboard checks, axe and agent image inspection completed.
- Phase 4: README and final source review completed. Final fresh gauntlet run `82563028-5e3d-42c5-aa86-bbd722aed3a4` passed 26/26 required layers against source `5121df8b3c4a158f83d9d5fe540f106120216077`: 97 unit tests, 7 integration tests, 20 SQL assertions, 10 browser tests, 914/914 mapped owned lines; mutation and shuffled-order checks passed.

Evidence: `thoughts/shared/research/2026-10-03-e1-s1-old-coder-evidence.md`. It records exact commands, scenario mappings, actual dependency findings, failure history and assurance limits. Independent fresh-agent review and user manual product sign-off were not obtained. No hosted project, public deployment, SMS/reminder delivery or portal agent work was performed.

Implementation is committed in the attached worktree on `codex/e1-s1-practice-profile`; original research and approved specification remain intact. Optional browser client scaffolding was unnecessary because this story uses server clients/actions.
