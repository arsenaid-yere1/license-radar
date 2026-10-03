# License Renewal Radar

License Renewal Radar helps medical practices keep track of the licenses, registrations, policies, and recurring administrative obligations that keep their office running. The goal is to give the office manager one place to see what needs attention, who owns it, and when it is due—with a text reminder 60 days before a renewal date.

A practice's inventory can extend beyond clinician credentials. The planned register covers state medical licenses, DEA registrations, malpractice policies, laboratory licenses and certificates, city business licenses, Secretary of State filings, insurance directory updates, and PCI compliance tasks. Each item will use dates confirmed by the practice and a clear responsible owner.

## Project status

**Early development: practice setup is implemented.** The renewal register, calendar, and SMS reminders are planned features.

Today, users can:

- Sign in with a six-digit email code.
- Create a practice with a name and timezone.
- Edit those settings and return to the saved profile across sessions.
- Recover from validation and save failures without losing their input.
- Resolve conflicting edits by reloading the latest settings.

Each account currently owns one practice. Server-side authorization and database row-level security isolate practice records. Profile changes and their private audit events are saved in the same transaction.

The reminder preview in practice settings is an **example**, not a scheduled notification. The current application runs locally; hosted deployment and external email delivery have not been configured.

## Planned workflow

1. **Set up the team.** Invite staff, assign roles, and identify the office manager responsible for renewals. Staff memberships and invitations are the next story, E1-S2.
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

**`db:reset` deletes data in the dedicated local test stack.** Privileged fixtures enforce loopback endpoints at ports 55321/55322/55324; these commands are intended for that stack.

For production browser tests, install Chromium, build the app, and leave port 3000 free so the test runner can start its own server:

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.browser-cache"
npx playwright install chromium
npm run build
npm run test:e2e
```

### Complete verification

`npm run gauntlet` runs the full verification pipeline: types, lint, formatting, migration replay, database and API tests, properties, mutation testing, production browser tests, coverage, shuffled test order, dependency review, and secret scans.

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
- [Project verification report](thoughts/shared/research/2026-10-03-e1-s1-project-verification.md) — results tied to the tested source, recovery regression, and verification boundaries.
