# License Renewal Radar

License Renewal Radar helps medical practices keep track of the licenses, registrations, policies, and recurring administrative obligations that keep their office running. The goal is to give the office manager one place to see what needs attention, who owns it, and when it is due—with a text reminder 60 days before a renewal date.

A practice's inventory can extend beyond clinician credentials. The planned register covers state medical licenses, DEA registrations, malpractice policies, laboratory licenses and certificates, city business licenses, Secretary of State filings, insurance directory updates, and PCI compliance tasks. Each item will use dates confirmed by the practice and a clear responsible owner.

## Project status

**Early development: practice setup, staff access, reminder responsibility, and register ownership are live in the hosted pilot.** Dates, calendar, and SMS reminders remain planned features.

Today, users can:

- Sign in with a six-digit email code.
- Create a practice with a name and timezone.
- Edit those settings and return to the saved profile across sessions.
- Recover from validation and save failures without losing their input.
- Resolve conflicting edits by reloading the latest settings.
- Copy staff invitation links valid for seven elapsed days; staff verify their email and explicitly accept.
- Assign administrator, office manager, or viewer roles and revoke access while retaining an active administrator.
- Cancel invitations or reissue a fresh link when the original response is lost.
- Assign, replace, or explicitly clear one reminder recipient as an administrator or manager.
- Automatically clear the assignment when the selected member is revoked or becomes a viewer.

The register is available from **Renewal register** in practice settings. Administrators and managers can add clinicians without logins and create state licenses, DEA registrations, and malpractice policies owned by a clinician or the practice. A practice malpractice policy can cover several clinicians while remaining one record. All active members can read the register; viewers have read-only access. Saves include private audit events and request receipts so an unchanged retry after an uncertain response returns the original creation. Drafts are not retained after leaving or reloading the page. New request keys do not detect similar or duplicate entries. Records display **Dates not entered**; text reminders are not active yet. Editing and archiving come later. The E2-S1 release passed all 30 verification layers; its additive production migration preserved all seven historical data sets and matched all nine application catalog sections. See the [production release record](thoughts/shared/handoffs/2026-10-06-e2-s1-production-release.md).

Each account has at most one active practice membership. All active staff can read shared settings; administrators edit settings and manage the team. Live membership checks and database row-level security isolate practice records and enforce revoked access on subsequent requests. Profile and access mutations save their private audit events in the same transaction. Creator identity remains provenance rather than authority.

Recipient assignment records responsibility, with an independent version and private transaction audit. It does not enroll a phone or schedule texts; readiness remains “SMS setup pending.” Existing and new practices start unassigned. Viewers see the selection without a candidate roster.

The reminder preview in practice settings is an **example**, not a scheduled notification. The hosted pilot is available at [license-radar.vercel.app](https://license-radar.vercel.app), using Vercel and the existing hosted Supabase project. Email-code sign-in uses the configured Resend SMTP provider. The original pilot setup used Resend’s test sender, which delivers only to the Resend account address; onboarding other staff requires a verified sending domain. Invitation links are shared manually.

## Planned workflow

1. **Set up the team.** Invite staff, assign roles, and identify the office manager responsible for renewals. Staff memberships and invitations are implemented in E1-S2. E1-S3’s recipient foundation is live in the hosted pilot; eligible active administrators and managers can be selected. SMS enrollment and original rule-9 job cancellation/catch-up remain required E2/E4 work. Register ownership is live in E2-S1. The next story is E2-S2: authoritative dates and issuer/jurisdiction fields.
2. **Build the register.** Enter practice and clinician obligations, authoritative dates, renewal links, and responsible owners. Support recurring administrative deadlines as well as license and policy expiration dates.
3. **See the workload.** Bring dates into a shared calendar and agenda, with views for upcoming, past-due, and missing-date items.
4. **Send reminders.** Text an enrolled office manager 60 calendar days before the relevant date, using the practice's timezone. Show failed or undelivered reminders so they can be addressed.
5. **Record completion.** Preserve renewal history and enter the next confirmed date to start a new cycle.

Later enhancements include spreadsheet import/export, calendar subscriptions, supporting documents, backup recipients, and additional reminder intervals. Browser agents that assist with renewal portals are a future exploration; no portal automation is implemented.

## Technology and project layout

The application uses **Next.js 16, React, and TypeScript**, with **Supabase Auth** for email-code sign-in and **PostgreSQL** for persistence. Zod validates application inputs; database constraints, column grants, and row-level security enforce data access rules.

| Directory          | Responsibility                                                                 |
| ------------------ | ------------------------------------------------------------------------------ |
| `src/app/`         | Pages, routing, and server actions                                             |
| `src/components/`  | Application interface and forms                                                |
| `src/lib/`         | Authentication, validation, timezone, and persistence logic                    |
| `supabase/`        | Database migrations, access policies, local configuration, and email templates |
| `tests/`           | Unit, database integration, and browser verification                           |
| `tools/`           | Local environment setup and verification tooling                               |
| `thoughts/shared/` | Product research, implementation plans, and verification evidence              |

## Run locally

### Prerequisites

- Node.js **24.21.0**, as specified in `.nvmrc`, and npm.
- A running Docker engine for the local Supabase stack.

From the project root:

```sh
npm ci
npx supabase start -x realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
node tools/local-environment.mjs prepare
npm run dev
```

Open the application at [http://127.0.0.1:3000](http://127.0.0.1:3000). To sign in, enter your email address and retrieve the six-digit code from [local Mailpit](http://127.0.0.1:55324). Codes expire after 10 minutes; another code can be requested after 60 seconds. The local stack captures email instead of sending it externally.

The `prepare` command creates ignored `.env.local` and `.env.test.json` files using the running local stack. Application configuration consists of `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; see [`.env.example`](.env.example). Admin keys are not needed by the application. Local auth rate limits are configured for testing and require review before hosted use.

For a production build running locally:

```sh
npm run build
npm start
```

## Development checks

Run the everyday checks with:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
```

With the dedicated local Supabase stack running, verify migrations and real API behavior:

```sh
npm run db:reset
npm run test:db
npm run test:integration
```

**`db:reset` deletes fixture data in the dedicated local test stack.** It requires the exact project, loopback endpoints at ports 55321/55322/55324, and no non-fixture accounts. Upgrade and mutation rehearsals use the same guards.

For production browser tests, install Chromium, build the app, and leave port 3000 free so the test runner can start its own server:

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.browser-cache"
npx playwright install chromium
npm run build
npm run test:e2e
```

### Complete verification

`npm run gauntlet` runs the 30-layer verification pipeline, including E1-S1, E1-S2, and E1-S3 upgrade/rollback rehearsals and explicit adversarial attacks: types, lint, formatting, migration replay, database and API tests, properties, mutation testing, production browser tests, coverage, shuffled test order, dependency review, and secret scans.

It requires a clean committed source tree, the local Supabase stack, Chromium, Python 3.12 with SQLFluff, and Gitleaks. Install the Python tools with:

```sh
python3.12 -m venv .venv-gauntlet
.venv-gauntlet/bin/pip install -r requirements-dev.txt
```

Place the checksum-verified Gitleaks binary at `.tools/gitleaks`; versions, checksums, and container image digests are recorded in [`tools/toolchain.json`](tools/toolchain.json). The persisted command list is [`tools/layers.json`](tools/layers.json). Generated logs and results live in ignored `reports/` and `coverage/` directories.

## Design and verification records

- [Product design, epics, and stories](thoughts/shared/research/2026-10-03-license-renewal-radar-system-design.md) — the original proposal; its initial empty-workspace observations are historical.
- [Practice setup implementation plan](thoughts/shared/plans/2026-10-03-e1-s1-practice-profile-and-timezone.md).
- [Approved executable specification](thoughts/shared/plans/2026-10-03-e1-s1-old-coder-spec.md).
- [E1-S2 executable specification](thoughts/shared/plans/2026-10-05-e1-s2-old-coder-spec.md).
- [E1-S2 implementation evidence](thoughts/shared/research/2026-10-05-e1-s2-old-coder-evidence.md).
- [Project verification report](thoughts/shared/research/2026-10-03-e1-s1-project-verification.md) — results tied to the tested source, recovery regression, and verification boundaries.

- [E1-S3 implementation plan](thoughts/shared/plans/2026-10-05-e1-s3-responsible-reminder-recipient.md).
- [E1-S3 implementation evidence](thoughts/shared/research/2026-10-05-e1-s3-implementation-evidence.md).

- [E2-S1 executable specification](thoughts/shared/plans/2026-10-06-e2-s1-old-coder-spec.md).
- [E2-S1 implementation plan](thoughts/shared/plans/2026-10-06-e2-s1-register-ownership.md).
- [E2-S1 implementation evidence — 30 layers passed](thoughts/shared/research/2026-10-06-e2-s1-implementation-evidence.md).
- [E2-S1 production release](thoughts/shared/handoffs/2026-10-06-e2-s1-production-release.md).
