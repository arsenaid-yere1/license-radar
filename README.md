# License Renewal Radar

License Renewal Radar helps medical practices keep track of the licenses, registrations, policies, and recurring administrative obligations that keep their office running. The goal is to give the office manager one place to see what needs attention, who owns it, and when it is due—with a text reminder 60 days before a renewal date.

A practice's inventory can extend beyond clinician credentials. The planned register covers state medical licenses, DEA registrations, malpractice policies, laboratory licenses and certificates, city business licenses, Secretary of State filings, insurance directory updates, and PCI compliance tasks. Each item will use dates confirmed by the practice and a clear responsible owner.

## Project status

**Early development: practice setup, staff access, reminder responsibility, register ownership, date entry, and register maintenance are live in the hosted pilot.** E3-S1 calendar and agenda are implemented locally; SMS reminders remain planned.

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

The register is available from **Renewal register** in practice settings. Administrators and managers can add clinicians without logins and create state licenses, DEA registrations, and malpractice policies owned by a clinician or the practice. A practice malpractice policy can cover several clinicians while remaining one record. All active members can read the register; viewers have read-only access. Saves include private audit events and request receipts so an unchanged retry after an uncertain response returns the original creation. Drafts are not retained after leaving or reloading the page. Creation request keys protect retries; similar legitimate records remain allowed. New records can include an optional issuer, jurisdiction, expiration or coverage end date, and a separate earlier action deadline. Dates are entered by the practice and validated as calendar days; either can remain unknown. The tracking date uses the earlier action deadline when supplied, otherwise the end date. Unknown end dates are flagged, and records with both dates unknown display **Dates not entered**. Type changes clear the date and issuer draft; owner changes preserve it. Text reminders are not active yet. Editing, retained archiving, and advisory duplicate review are live in E2-S3. The E2-S1 release passed all 30 verification layers; its additive production migration preserved all seven historical data sets and matched all nine application catalog sections. See the [production release record](thoughts/shared/handoffs/2026-10-06-e2-s1-production-release.md).

Each account has at most one active practice membership. All active staff can read shared settings; administrators edit settings and manage the team. Live membership checks and database row-level security isolate practice records and enforce revoked access on subsequent requests. Profile and access mutations save their private audit events in the same transaction. Creator identity remains provenance rather than authority.

Recipient assignment records responsibility, with an independent version and private transaction audit. It does not enroll a phone or schedule texts; readiness remains “SMS setup pending.” Existing and new practices start unassigned. Viewers see the selection without a candidate roster.

The reminder preview in practice settings is an **example**, not a scheduled notification. The hosted pilot is available at [license-radar.vercel.app](https://license-radar.vercel.app), using Vercel and the existing hosted Supabase project. Email-code sign-in uses the configured Resend SMTP provider. The original pilot setup used Resend’s test sender, which delivers only to the Resend account address; onboarding other staff requires a verified sending domain. Invitation links are shared manually.

## Planned workflow

1. **Set up the team.** Invite staff, assign roles, and identify the office manager responsible for renewals. Staff memberships and invitations are implemented in E1-S2. E1-S3’s recipient foundation is live in the hosted pilot; eligible active administrators and managers can be selected. SMS enrollment and original rule-9 job cancellation/catch-up remain required E2/E4 work. Register ownership and E2-S2 date entry are live in the hosted pilot. E2-S3 editing, retained archiving, and advisory duplicate review are live in the hosted pilot. E3-S1 calendar and agenda are implemented locally, including exclusion of archived records. E3-S2 dashboard is next; E4 unsent-job invalidation/cancellation remains required when that infrastructure exists.
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

`npm run gauntlet` runs the 32-layer verification pipeline, including practice, recipient, register, and populated date-entry and E2-S2-to-maintenance upgrade/rollback rehearsals and explicit adversarial attacks: types, lint, formatting, migration replay, database and API tests, properties, mutation testing, production browser tests, coverage, shuffled test order, dependency review, and secret scans.

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

- [E2-S2 executable specification](thoughts/shared/plans/2026-10-06-e2-s2-old-coder-spec.md).
- [E2-S2 implementation plan](thoughts/shared/plans/2026-10-06-e2-s2-authoritative-dates.md).
- [E2-S2 implementation evidence](thoughts/shared/research/2026-10-06-e2-s2-implementation-evidence.md).
- [E2-S2 production release](thoughts/shared/handoffs/2026-10-06-e2-s2-production-release.md).

The E2-S2 migration adds an unknown initial cycle to existing credentials without changing their historical values, timestamps, audits, or retry receipts. E2-S3 can now correct those existing dates. The original creation API remains compatible, including its historical response shape; new application saves use the detailed creation API.

The E2-S2 release passed all 31 verification layers. Its production migration preserved all 12 historical data sets and added exactly one unknown cycle to the existing credential. The hosted schema matched all nine application catalog sections, and anonymous access and private-route smoke checks passed. Authenticated hosted creation and user manual acceptance remain unconfirmed; real local SQL/API/browser checks cover those workflows.

- [E2-S3 executable specification](thoughts/shared/plans/2026-10-06-e2-s3-old-coder-spec.md).
- [E2-S3 implementation plan](thoughts/shared/plans/2026-10-06-e2-s3-register-maintenance.md).
- [E2-S3 implementation evidence](thoughts/shared/research/2026-10-06-e2-s3-implementation-evidence.md).

E2-S3 lets administrators/managers correct existing records and explicitly archive them while preserving dates, coverage, cycles, audits, and retry receipts. The active register hides archived records; the archived view retains them for all active members. Conflicts preserve the blocked draft for comparison; **Reload saved values** discards that draft before intended changes are reentered. Pending or uncertain requests freeze editing and view switching until an exact retry is confirmed. Drafts remain limited to the current page session. Possible duplicates are advisory matches on active same-practice type, owner, title, issuer, and jurisdiction, with ASCII case and whitespace normalization; differing dates/coverage do not hide them. Similar legitimate records remain allowed. No restoration, deletion, calendar, job cancellation, or text dispatch is implemented in this slice.

- [E2-S3 production release](thoughts/shared/handoffs/2026-10-07-e2-s3-production-release.md).

The E2-S3 release passed all 32 verification layers. Its additive hosted migration preserved all 13 historical data sets and matched all nine application catalog sections. Public-page, anonymous-denial, and private-route checks passed. An existing authenticated browser session loaded both active and archived register views; hosted edit/archive submissions were not exercised because the live register contained no records. Populated local SQL/API/browser tests cover those mutations. Text reminders remain inactive.

- [E3-S1 executable specification](thoughts/shared/plans/2026-10-07-e3-s1-old-coder-spec.md).
- [E3-S1 implementation plan](thoughts/shared/plans/2026-10-07-e3-s1-calendar-and-agenda.md).
- [E3-S1 implementation evidence](thoughts/shared/research/2026-10-07-e3-s1-implementation-evidence.md).

E3-S1 adds **Renewal calendar** from practice settings and the register. All active members can view a month calendar or agenda, filter by clinician or practice ownership, type, and jurisdiction, and open read-only record details. Each entered end date and earlier action deadline appears separately; the effective tracking date is labeled. A shared policy remains one event per date purpose. Records with both dates unknown remain visible under **Dates not entered** in every month. The practice timezone determines today; saved calendar dates do not shift with the browser timezone. Desktop defaults to month and phones to agenda, with explicit view links available on both.

Calendar/detail pages are saved snapshots. **Refresh records** and ordinary navigation recheck access and read current values; browser history may restore an earlier snapshot until refreshed. Corrections move dates and archiving removes events after a fresh read, preserving retained history. Detail links recheck current membership and active-record availability. Invalid filters show a warning until corrected or cleared. Register navigation remains locked while a maintenance save is pending or uncertain. No database migration or new dependency is needed. These changes have not been deployed. Text reminders remain inactive; E3-S2 dashboard and E4 scheduling/dispatch remain future work.
