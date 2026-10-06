# E1-S3 production release — 2026-10-05

The user explicitly requested **“push to prod”** after implementation. This release uses the existing hosted pilot and its configured production environment.

## Release identity

- Application: https://license-radar.vercel.app.
- Vercel project: `license-radar`, `prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF`, scope `arsens-projects-630b84fe`, Node `24.x`, Next.js preset.
- Supabase project: `vowgvmpxkctoqjoqfkqp`.
- Production Git branch: `main` at `https://github.com/arsenaid-yere1/license-radar.git`.
- Committed release archive: `c5247026d6d13bc957f3d59b3266b5ef912f6234`.
- Tested application source: `6bb56868c3de30da07c344c782a9b9c2435fc6f1`; source SHA-256 `bd653514897363b23681baddc7107796744a008da819abb2f9e8ac6abb2cb238`, identical in the release archive.
- Gauntlet: `427c847b-8580-4f0b-bcd6-4a4a3b4cf6c5`, all 29 layers passed; see `thoughts/shared/research/2026-10-05-e1-s3-implementation-evidence.md`.
- Promoted deployment: `dpl_9tEvN9BTYrczbAkGaXGeuu5oX4wG`, https://license-radar-624efdyb6-arsens-projects-630b84fe.vercel.app.
- Previous live deployment: `dpl_bHScsfxVPWWBp1CPUx4whSSCG3q8`.

## Coordinated rollout

1. `git ls-remote origin refs/heads/main` confirmed the expected E1-S2 baseline, `aeedf1cff3aba58218046483955a05b506c0b90c`.
2. Supabase `db push --project-ref vowgvmpxkctoqjoqfkqp --dry-run --skip-vault` identified exactly `supabase/migrations/20261006003555_practice_reminder_recipient.sql`. All three prior migration versions were present.
3. Read-only production queries captured all five historical row-set checksums. The existing E1-S2 schema matched all nine application catalog sections against that release's `tools/schema-contract.json`.
4. `git archive` prepared a clean committed release in a separate temporary directory. Vercel's dry upload inventory contained 161 files, 1,468,467 bytes, including the committed `.env.example`, and excluded private environment files, local tools, reports, dependencies, coverage, and build artifacts.
5. `vercel@62.4.0 deploy --prod --skip-domain --yes --project prj_j4QA3gBzpbK3B3aycDa7Lm9rrugF --scope arsens-projects-630b84fe` staged the archive using the existing production environment. Hosted compilation, TypeScript, page generation, tracing, and deployment passed. `vercel inspect` confirmed that the public live alias still used the previous deployment.
6. Supabase `db push --project-ref vowgvmpxkctoqjoqfkqp --skip-vault --yes` successfully applied the tested migration. No seeds, role files, database reset, or Vault changes were requested.
7. Record preservation, recipient backfill, and all nine schema comparisons passed before promotion. The previous live application still loaded the existing practice after migration.
8. `vercel promote dpl_9tEvN9BTYrczbAkGaXGeuu5oX4wG --yes --scope arsens-projects-630b84fe` succeeded. Inspection confirmed the public alias pointed to the new `READY` deployment.
9. A repeat migration dry-run reported an up-to-date database and zero pending migrations.

## Hosted verification

Automated read-only SQL checks used Supabase `db query --linked --project-ref vowgvmpxkctoqjoqfkqp`; local fixture, reset, mutation, and integration tools were never run against production.

- Counts and complete row-set checksums were unchanged for the one practice, one membership, one historical profile audit event, one access event, and zero invitations.
- The existing practice has one unassigned recipient settings row at version 1, zero recipient audit events, and an active administrator. No real member was selected during release verification.
- All nine application catalog comparisons passed using `tools/schema-catalog.mjs`: columns, policies, function definitions and client execute grants, triggers, client column grants, RLS, constraints, indexes, and private schema ACL. As in the previous release, platform `public.rls_auto_enable()`, hosted service-role function grants, and shared public-schema ACL remain outside the application comparison. Policy role arrays normalize from the CLI's equivalent text representation.
- Both new recipient RPCs reject anonymous Data API requests with HTTP 401/403 and PostgreSQL `42501`; dummy identifiers ensure the probes cannot affect a real practice.
- `/login` and `/join` returned HTTP 200. Anonymous `/practice` and `/practice/team` requests redirected to `/login` with `no-store` caching.
- Supabase security advisors reported the same three pre-existing warnings as E1-S2: two for platform `public.rls_auto_enable()` and one for disabled leaked-password protection. No new advisor findings appeared.

Read-only browser smoke verification used the existing authenticated Chrome session. The new `/practice` page displayed the saved practice, administrator controls, the reminder-recipient picker, “No reminder recipient selected,” and “Text reminders are not active yet.” `/practice/team` loaded the existing active administrator and invitation controls. No form was submitted, no email was requested, and no membership, invitation, profile, or recipient was changed. These hosted smoke checks supplement the local 29-layer gauntlet; exhaustive hosted lifecycle testing and user manual acceptance are not claimed.

Ignored `reports/e1-s3-production-*` files hold operational query, catalog, deployment, advisor, and smoke evidence. No credentials are committed.

## Release boundaries and recovery

This release implements reminder responsibility only. Phone enrollment, SMS consent, scheduled messages, and original rule-9 job cancellation/catch-up remain future E2/E4 work. Existing Resend SMTP settings and its documented pilot sender limitation are unchanged.

The recipient migration is compatible with the previous E1-S2 application; the old application was checked after migration. If application rollback is needed, preserve the additive recipient settings and audit history and their membership invalidation behavior. Prefer forward repair; do not drop production records or roll back to the pre-membership creator-authorized schema.

The only tracked changes after the tested release archive are the hosted-status README correction and this release handoff. They do not change runtime code, dependencies, migrations, or verification scripts. The release and documentation checkpoint are pushed to production `main` without force. The existing Git integration may build that documentation checkpoint; any resulting application must match the promoted archive.
