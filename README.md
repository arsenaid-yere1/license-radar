# License Renewal Radar

E1-S1: email code sign-in, one owned practice, practice name and timezone, editable settings, optimistic concurrency, and an atomic private audit trail.

## Local setup

Use Node **24.21.0** (`.nvmrc`), npm, and a running Docker engine. Versions and image digests are recorded in `tools/toolchain.json`. The application is a single Next.js 16 App Router project; `src/app` owns routes/actions, `src/components` owns the interface, `src/lib` owns auth/validation/persistence boundaries, and `supabase` owns schema, grants, RLS, and local email configuration. `tests` and `tools` own verification only.

```sh
npm ci
npx supabase start -x realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
node tools/local-environment.mjs prepare
npm run dev
```

Open http://127.0.0.1:3000. Local email is captured at http://127.0.0.1:55324. Enter the six-digit code there; no external SMTP sender is configured. Resend interval: 60 seconds. Code expiry: 10 minutes. Elevated local rate limits are test settings, not hosted recommendations.

`prepare` writes ignored `.env.local` with the local URL and publishable key, and ignored `.env.test.json` with loopback test endpoints. The application needs only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; never put an admin key in application environment variables. `.env.example` contains placeholders.

## Verification

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run db:reset
npm run test:db
npm run test:integration
npm run build
npm run test:e2e
npm run gauntlet
```

`db:reset` and all privileged fixtures refuse endpoints other than the dedicated ports 55321/55322/55324 on 127.0.0.1. They must never target a hosted/shared project. Migrations are replayed only on this local stack.

For the complete gauntlet, install Chromium with `PLAYWRIGHT_BROWSERS_PATH="$PWD/.browser-cache" npx playwright install chromium`, SQLFluff with `python3.12 -m venv .venv-gauntlet` then `.venv-gauntlet/bin/pip install -r requirements-dev.txt`, and the checksum-verified Gitleaks binary recorded in `tools/toolchain.json` at `.tools/gitleaks`. Use a clean committed source tree. Reports are rebuilt in ignored `reports/` and `coverage/`. Each successful layer is recorded only after its command exits successfully. Production Node and browser source maps are checked against current source, merged with unit coverage, and gated at 100% mapped owned lines. Branch coverage is reported separately.

## Ownership and future work

Each verified account owns at most one practice. Ownership comes from `auth.uid()`, with column grants and owner-only RLS. Clients cannot edit identity/version/timestamps, transfer ownership, delete profiles, or access the audit schema. Updates include an expected version; stale edits must reload. Retried creates return the existing practice without overwriting it.

Audit events participate in the profile transaction. A failed audit rolls back the profile change. The preview is a fixed **example only** for December 2, 2026 → October 3, 2026 at 09:00 in the selected zone.

Staff memberships and invitations belong to E1-S2. Future obligation records can reference `practices.id`; this story adds no obligations, notification jobs, SMS delivery, or browser renewal agents. No hosted project or deployment has been created.

See the approved specification in `thoughts/shared/plans/2026-10-03-e1-s1-old-coder-spec.md` and the evidence report in `thoughts/shared/research/2026-10-03-e1-s1-old-coder-evidence.md`. Independent fresh-agent review is not performed; automated checks and adversarial tests share the implementation author's blind spots.
