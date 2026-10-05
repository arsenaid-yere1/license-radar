# E1-S2 production release — 2026-10-05

The user explicitly requested **“push code to prod”** after implementation. This authorizes this release beyond the earlier specification’s local-only implementation boundary.

## Release targets and source

- Production application: https://license-radar.vercel.app.
- Existing Vercel project: `license-radar`, ID `prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF`, scope `arsens-projects-630b84fe`; Node `24.x`, Next.js preset, `npm run build`.
- Existing Supabase project: `vowgvmpxkctoqjoqfkqp` (`license-radar`). No new project provisioned.
- Production Git branch: `main` of `https://github.com/arsenaid-yere1/license-radar.git`.
- Clean release archive: `b17e3f25ad7ca8057109c1c81fa83a34138c9920`, with tested application source `eea83e9dc4adc8d9303a22e4f2a8c18980032ed2`. The prior 28-layer gauntlet is documented in `thoughts/shared/research/2026-10-05-e1-s2-old-coder-evidence.md`.
- Staged and promoted Vercel deployment: `dpl_7HoEcbDE94BXmhcFqtdyQoBpuYDK`, https://license-radar-m3h82fn24-arsens-projects-630b84fe.vercel.app.
- Previous production deployment: `dpl_8TqGAx41QCcWnmoLkLBwgAjLaAHe` (source `491e6905bdbc2aa853c94c9cc7e192d51cd9a676`).

The release was prepared with `git archive HEAD` in a separate temporary directory. Vercel’s dry upload inventory contained 140 committed files (1,266,281 bytes) and excluded private environment files and all local tools/reports/browser/coverage artifacts. Production environment inspection confirmed the hosted URL and a configured publishable key; neither application source nor logs include a service key. CLI deployment metadata records the archive commit and tested source commit. No application code, migrations, dependencies, or verification scripts changed during deployment; the only subsequent tracked changes are the hosted-status README correction and this handoff.

## Coordinated rollout

1. Supabase `db push --project-ref vowgvmpxkctoqjoqfkqp --dry-run --skip-vault` showed exactly `20261005211436_practice_membership_authority.sql` and `20261005212526_practice_invitations.sql`.
2. Read-only count/checksum capture found one practice and one historical profile audit event; existing migration history contained only `20261003191334`.
3. `vercel@62.4.0 deploy --prod --skip-domain --yes --scope arsens-projects-630b84fe` built the committed archive with the existing production environment. Hosted compilation, TypeScript, page generation, tracing, and deployment passed. `vercel inspect https://license-radar.vercel.app --json` confirmed the old deployment still served the live domain while the new deployment was staged.
4. Supabase `db push --project-ref vowgvmpxkctoqjoqfkqp --skip-vault --yes` applied both tested migrations successfully, without seeds, role files, resets, or Vault changes.
5. `vercel promote dpl_7HoEcbDE94BXmhcFqtdyQoBpuYDK --yes --scope arsens-projects-630b84fe` successfully promoted the prepared build.
6. Repeat migration dry-run reported up-to-date with zero pending migrations. Production history contains `20261003191334`, `20261005211436`, `20261005212526`.

## Production verification

All hosted SQL checks used `supabase db query --linked --project-ref vowgvmpxkctoqjoqfkqp`; no local test/fixture/mutation/reset tool ran against production.

- Existing practice and historical audit counts and complete row-set checksums are unchanged. The creator has one active administrator membership and one `membership_initialized` access event; zero practices lack an active administrator and zero invitations were created by release verification.
- All nine application-scoped catalog comparisons passed using queries from `tools/schema-fingerprint.mjs`: columns, policies, function definitions and application execute permissions, triggers, client column grants, RLS, constraints, indexes, and private schema ACL.
- Catalog comparison boundaries: JSON API policy role arrays normalize to the equivalent CLI text array; grant comparisons cover `PUBLIC`/`anon`/`authenticated` function permissions and `anon`/`authenticated` column grants; inherited hosted `service_role` execute grants and shared public-schema ACL differ from local infrastructure and are retained. Private schema ACL matches exactly. The pre-existing platform `public.rls_auto_enable()` function is outside the 32 application functions and unchanged.
- Twelve real Data API checks passed: anonymous requests to all ten application RPCs and reads of both public application tables returned HTTP 401/403 with PostgreSQL `42501` permission denial. Invalid dummy identifiers ensure the probes cannot target a real membership/invitation; no data was changed.
- Three anonymous HTTP route checks passed: `/login` renders the sign-in form; `/join` returns the intended public invitation/email-code page; `/practice/team` redirects to `/login`. The initial HTTP smoke assertion incorrectly expected sign-in heading text on `/join`; it was corrected after inspecting `src/app/join/page.tsx` and `src/components/auth/join-form.tsx`, without changing the application.
- Existing authenticated Chrome session loaded the saved practice and `/practice/team`, displaying the creator as an active practice administrator with team and invitation controls. No real invitation, role change, profile update, or email request was submitted. Agent inspected the visible production screen; this is a read-only browser smoke check, not a rerun of all local browser tests.
- Supabase’s security advisor reports zero new findings. The three unchanged findings are two warnings for the pre-existing `public.rls_auto_enable()` function and disabled leaked-password protection (this application uses email codes). The first post-release advisor call failed temporary CLI-role authentication while other CLI reads were concurrent; a sequential retry completed successfully.
- Hosted auth configuration still has the production Site URL, six-digit codes, 600-second expiry, 60-second resend interval, signup and email confirmation enabled, and anonymous sign-in disabled. The SMTP dashboard shows custom SMTP enabled at `smtp.resend.com:465` with a stored password. No credentials or auth settings changed. The original pilot test sender limitation is documented below; no fresh delivery test was performed.

Ignored `reports/production-*` files contain the actual catalog, count/checksum, advisor, and smoke results. They are local operational evidence, not committed credentials or portable assurance artifacts.

## Operational boundaries

The original hosted pilot configured Resend’s `onboarding@resend.dev` sender. Resend documents that this test sender delivers only to the account email; sending to additional staff requires an owned verified sending domain and corresponding sender address: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain. This release reuses the configured SMTP provider and does not purchase a domain, configure DNS, send real invitation email, or claim new end-to-end delivery verification. Application invitations are copied links; invitees still need functioning email-code delivery.

The previous owner-only application writes directly to the profile table. These migrations revoke those direct writes in favor of membership-authorized RPCs, so a previous-binary-only rollback is incompatible with the new schema. Recovery must coordinate application and database; no rollback or production data deletion was performed.

The hosted release checks supplement the complete local gauntlet. They do not constitute independent implementation verification, a new legal/security audit, or exhaustive hosted invitation lifecycle testing. Current Supabase changelog/deployment documentation was reviewed, including the explicit-grants Data API change; migrations already declare the needed grants.

## Git completion

The documentation checkpoint is pushed with the verified application as a fast-forward of remote `main`. Vercel’s existing Git integration may create a subsequent production deployment for that checkpoint; its application, migrations, and lockfile must match the prepared archive. Final command outputs and the resulting commit identify that checkpoint. No force push is used.
