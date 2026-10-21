# Insurance payer provider directory renewal type: current implementation research

Date: 2026-10-21 (America/Los_Angeles).
Scope: research for the requested new renewal type, using the explicitly invoked research-codebase skill. No application, database, or hosted changes.
Baseline: HEAD `cca99a7` plus the current working tree. Numerous newer features and verification artifacts are uncommitted; source findings describe the inspected working tree, not a verified deployment.

## Research question

How are renewal types defined, created, edited, tracked, completed, and retained today, and which existing contracts affect adding an **Insurance Payer Provider directory** type?

## Summary

Insurance directory updates appear in planned product scope (`README.md:5`), but there is no implemented directory type. Application and database validation accept four types: state license, DEA registration, malpractice policy, and PCI compliance certificate. The PCI addition is the closest existing example of adding a type across these boundaries.

The existing record provides title, optional external number, issuer, jurisdiction, practice/clinician ownership, explicit dates, renewal link/progress, retained cycles, and cycle evidence. **Inference:** these facilities could support a manually tracked directory obligation, subject to product decisions about ownership, payer/provider representation, and date meaning. They do not establish directory-specific rules.

The most significant semantic constraint is that every non-malpractice end date currently displays as an expiration. Creation/edit can leave both dates unknown or enter only an action deadline, but confirmed renewal always requires a new future end date. No payer-specific cadence, automatic directory attestation, or provider-directory synchronization was found in the inspected source.

## Repository and ownership boundaries

This is one Next.js/React/TypeScript application, rather than a multi-application monorepo (`package.json`; `README.md:42`). Responsibilities are divided by directory:

| Area                                                               | Responsibility                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `src/app/practice/register/`                                       | Authenticated pages and server actions                                                 |
| `src/components/register/`, `calendar/`, `dashboard/`, `renewals/` | Forms and saved-record presentation                                                    |
| `src/lib/register/`                                                | Shared types, input/output validation, dates, numbers, operations, database adapters   |
| `src/lib/renewals/`, `evidence/`, `reminders/`                     | Renewal lifecycle, attachments, and notification facilities                            |
| `supabase/migrations/`                                             | Persistent constraints, authorization, transactions, revisions, audits, retry receipts |
| `tests/`, colocated `*.test.ts`                                    | Unit, integration, and browser verification                                            |
| `tools/`, `thoughts/shared/`                                       | Verification infrastructure and historical engineering records                         |

These are code responsibilities; inspected files do not establish team ownership.

## Detailed findings

### 1. Shared types and application validation

- `credentialTypeSchema` and `typeLabels` define the four accepted values and visible names (`src/lib/register/types.ts:3`, `:10`). There is no custom/other-type escape hatch.
- Both create/update input and saved-record output use that schema (`src/lib/register/schema.ts:38`, `:106`, `:199`). Maintenance, register, and renewal projections compose it, so a new unknown type can cause an entire register response to be rejected rather than merely omitted (`src/lib/register/repository.ts:107`; `src/lib/renewals/repository.ts:31`).
- `renewalCycleSchema` also imports this shared leaf schema (`src/lib/renewals/history.ts:5`). Completion replies and evidence pages embed the cycle schema (`src/lib/renewals/schema.ts:111`; `src/lib/evidence/schema.ts:31`). Unlike the pre-PCI research snapshot, history no longer repeats an independent type enum.
- Ownership accepts practice or clinician; PCI has a practice-only refinement. Clinician IDs must agree with ownership. Covered-clinician lists are restricted to practice-owned malpractice policies (`src/lib/register/schema.ts:51`, `:126`). Directory ownership and any many-provider association are not defined.

### 2. Forms, labels, and type changes

- `CredentialFields` generates type choices from `typeLabels`; create and edit share these fields (`src/components/register/credential-fields.tsx:11`, `:76`; `src/components/register/edit-record-form.tsx:121`).
- Three separate maps supply visible terminology: `typeLabels`, `detailLabels`, and `recordNumberLabels` (`src/lib/register/types.ts:10`; `src/lib/register/dates.ts:42`; `src/lib/register/numbers.ts:6`). The latter two exhaustively cover `CredentialType` through TypeScript `satisfies Record` checks.
- Optional numbers are free text with trimming, a 120-code-point limit, and control-character rejection. They are not a structured payer ID, NPI, or verified registry identifier (`src/lib/register/numbers.ts:13`). Issuer and jurisdiction are optional bounded text (`src/lib/register/schema.ts:17`).
- Changing type clears draft number, issuer, jurisdiction, dates, and coverage. Editing asks for confirmation when those values exist. PCI additionally forces practice ownership and clears the owner clinician; cancel preserves the draft (`src/components/register/credential-fields.tsx:30`, `:60`, `:100`). That PCI-specific choice does not imply a directory ownership decision.
- Uncertain edit submissions preserve the exact original payload for retry, and stale edits show saved values for explicit reload (`src/components/register/edit-record-form.tsx:67`, `:151`).

### 3. Persistence and all API generations

- Server actions pass form values through `createRegisterRecord` or `changeRegisterRecord`. These check authentication, current practice access, non-viewer write authority, and input validation; the practice ID comes from current access (`src/app/practice/register/actions.ts:16`; `src/lib/register/operations.ts:12`, `:38`).
- `createRecord` selects the number-aware create API when the number field is present, even if blank becomes null; otherwise it uses detailed creation. `changeRecord` similarly selects number-aware update, legacy update, or archive (`src/lib/register/repository.ts:41`, `:123`).
- The latest persistent type CHECK permits exactly the four current values (`supabase/migrations/20261020210728_pci_compliance_certificate_records.sql:2`). A separate CHECK enforces PCI practice ownership (`:9`).
- The same migration contains three active type whitelists: original creation (`:30`), detailed creation (`:90`), and shared `private.credential_change_values` (`:178`). Number-aware create/update call the shared validator (`supabase/migrations/20261016221310_credential_record_numbers.sql:166`, `:226`). Consequently, a selector-only addition would still fail persistent validation.
- Number-aware creation saves metadata, coverage, initial-cycle dates, audit and retry receipt. Update uses `private.apply_credential_change` and optimistic credential/cycle/date tokens. Number-only edits do not dirty reminder scheduling; date changes and archive do (`supabase/migrations/20261016221310_credential_record_numbers.sql:43`, `:145`, `:152`).

### 4. Dates, workload views, and reminders

- Calendar-day strings avoid timezone shifting; either saved date can be unknown, and the action deadline must be strictly earlier when both dates exist (`src/lib/register/dates.ts:3`; `src/lib/register/schema.ts:34`).
- `trackingDate` prefers the action deadline, otherwise the end date. Its purpose is “coverage end” for malpractice and “expiration” for every other type (`src/lib/register/dates.ts:29`). `projectCalendar` independently repeats that purpose distinction (`src/lib/calendar/events.ts:39`, `:58`). Merely changing a form label would leave this terminology elsewhere.
- Calendar type-filter validation uses `typeLabels`; dashboard urgency uses the shared tracking date and excludes archived records (`src/lib/calendar/query.ts:48`; `src/lib/dashboard/summary.ts:54`). Missing-end-date items can overlap dated lists when only an action deadline is known.
- SQL reminder context likewise selects action deadline before end date, with generic `action-deadline`/`end-date` purposes and a `missing-date` blocked reason (`supabase/migrations/20261009175711_email_reminder_catch_up.sql:68`, `:80`, `:102`). The Gmail migration wraps that existing context rather than replacing its due-date semantics (`supabase/migrations/20261015181333_gmail_reminders.sql:111`). No directory-type scheduling branch exists there.
- Existing reminders are based on the ordinary sixty-day target and catch-up eligibility, not a directory attestation interval. An undated record can have a blocked `missing-date` job; it does not imply absence of all reminder rows (`tests/integration/practice-pci-certificates.test.ts:771`).

### 5. Completion, retained history, and evidence

- Completion requires explicit confirmation and a new end date; an optional new action deadline must precede it (`src/lib/renewals/schema.ts:45`). SQL also requires both supplied dates to be after today in the practice timezone, with no type-specific exception (`supabase/migrations/20261013172507_credential_renewal_completion.sql:331`, `:379`). An action-deadline-only successor is not supported by this API.
- SQL retains the completed predecessor and opens one successor cycle, preserves credential metadata, and records audit/receipt snapshots (`supabase/migrations/20261013172507_credential_renewal_completion.sql:392`). Completion UI obtains its date label from `detailLabels` (`src/components/renewals/completion-fields.tsx:28`).
- Cycle history projection uses the saved completion snapshot's type when present, otherwise the current credential type (`supabase/migrations/20261013172507_credential_renewal_completion.sql:312`). History is paginated at 20 cycles (`src/lib/renewals/history.ts:26`).
- Evidence pages compose the shared cycle schema and support bounded PDF/JPEG/PNG metadata (`src/lib/evidence/schema.ts:11`, `:16`, `:31`). SQL binds evidence to practice/credential/cycle; reads include retained cycles (`supabase/migrations/20261014002159_renewal_evidence.sql:2`, `:157`). This is attachment support, not payer attestation or document verification. Hosted feature availability was not inspected.

## Execution and data flow

1. Shared type and field maps render the add/edit form.
2. Server action extracts form values; the operation authenticates, resolves current practice authority, and validates input.
3. The repository chooses the appropriate API generation. SQL independently checks type, ownership, dates, references, and transactional retry/version rules.
4. SQL saves record/cycle state and audit/receipt data; application parsers validate the returned projection.
5. Register, calendar, dashboard, and reminder views derive from saved current-cycle data.
6. Explicit completion preserves the old cycle and opens a successor; history and evidence read their cycle-specific state.

There is currently no successful new directory-type path through this flow because both the application enum and persistent whitelists reject it.

## Existing tests and verification

The closest existing example is PCI support:

- `src/lib/register/pci.test.ts`: mixed-register parsing, API arguments, ownership rejection, history/completion/evidence contracts, filters, and urgency.
- `tests/unit/pci-record-forms.test.tsx`: ownership transitions, reset confirmation/cancellation, and display/completion labels.
- `supabase/tests/practice_pci_certificates.test.sql`: persistent acceptance, ownership/coverage rejection, and privileges.
- `tests/integration/practice-pci-certificates.test.ts:591`: all create/edit API generations; `:679`: concurrent renewal and retained evidence; `:771`: date/reminder lifecycle.
- `tests/e2e/practice-pci-certificates.spec.ts`: browser lifecycle example. This suite was located, not executed in this research.

Automated checks run:

```sh
npm test -- src/lib/register/pci.test.ts src/lib/register/dates.test.ts src/lib/register/numbers.test.ts src/lib/renewals/history.test.ts src/lib/calendar/query.test.ts tests/unit/pci-record-forms.test.tsx
PATH="$PWD/.tools/node-v24.21.0-darwin-arm64/bin:$PATH" npm test -- src/lib/register/pci.test.ts src/lib/register/dates.test.ts src/lib/register/numbers.test.ts src/lib/renewals/history.test.ts src/lib/calendar/query.test.ts tests/unit/pci-record-forms.test.tsx
```

Both runs passed: **6 files, 32 tests**. The second used the repository's pinned Node runtime. These checks verify existing behavior, not directory-type acceptance.

Source verification used `rg`, complete reads of the relevant application contracts/forms and latest type/number migrations, focused SQL lifecycle inspection, delegated SQL/test research, and `git log -5 --oneline`. No database, integration, browser, hosted deployment, or external payer-policy checks were run. Lint and type-check were not run for this research-only document; no runtime source changed.

Document formatting passed with `npx --no-install prettier --ignore-path /dev/null --check thoughts/shared/research/2026-10-21-insurance-payer-provider-directory-renewal-type.md` after targeted formatting. The explicit ignore override is necessary because `.prettierignore` excludes `thoughts/`. The new-document diff was reviewed with `git diff --no-index -- /dev/null thoughts/shared/research/2026-10-21-insurance-payer-provider-directory-renewal-type.md`; its exit code 1 denotes the expected added-file difference.

## Historical context

- The October 20 PCI research describes the earlier three-type implementation (`thoughts/shared/research/2026-10-20-pci-compliance-certificate-record.md`). Its statements that PCI is absent and history repeats its own enum are superseded by the inspected four-type source.
- The PCI migration provides a concrete additive type example while retaining legacy function signatures and payload shapes (`supabase/migrations/20261020210728_pci_compliance_certificate_records.sql:14`).
- Recent committed history ends at catch-up release documentation (`cca99a7`); newer PCI/number/history/evidence work is present in the working tree. Commit history alone does not establish the current application or hosted feature set.
- README includes insurance directory updates as intended scope but supplies no payer/provider model, date cadence, or acceptance criteria for this type.

## Open questions

1. Does a directory record belong to the practice, one clinician, or represent a payer plus several providers/locations? Current multi-clinician coverage is exclusive to malpractice policies.
2. Does the supplied date mean the next directory update, attestation deadline, revalidation, or an actual expiration? Is the existing mandatory future end date appropriate when recording completion?
3. Are dates always entered explicitly, or is a recurring cadence requested? No directory-specific interval is established by source or this request.
4. What should identify the payer and provider: the existing issuer/number/title fields, or distinct relationships and fields? Required labels and identifiers remain unspecified.
5. Is scope manual tracking with an optional portal link and evidence, or integration with a payer directory? No such external integration was found in the inspected implementation.

These are product questions, not inferred regulatory requirements. This research makes no claims about payer rules or legally required update intervals.
