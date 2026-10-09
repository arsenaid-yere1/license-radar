-- Email is primary. SMS enrollment/history is deliberately unchanged.
alter table public.credential_cycles add column completed_at timestamptz;
create unique index credential_cycles_one_incomplete on public.credential_cycles (credential_id)
where completed_at is null;
alter table public.credential_cycles add constraint credential_cycles_identity_key
unique (practice_id, credential_id, id);

alter table public.practice_memberships add constraint practice_memberships_email_identity_key
unique (practice_id, id, user_id);

create table private.reminder_email_account_state (
    user_id uuid primary key,
    email text,
    confirmed_at timestamptz,
    revision bigint not null default 1 check (revision > 0),
    eligible_since timestamptz not null default clock_timestamp(),
    dirty boolean not null default true
);
-- No Auth/domain FK: bookkeeping must not prevent account deletion or reverse lock order.
create function private.track_reminder_email_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if tg_op = 'UPDATE' and new.email is not distinct from old.email
        and new.email_confirmed_at is not distinct from old.email_confirmed_at then return new; end if;
    insert into private.reminder_email_account_state (user_id, email, confirmed_at)
    values (coalesce(new.id, old.id), case when tg_op <> 'DELETE' then new.email end,
        case when tg_op <> 'DELETE' then new.email_confirmed_at end)
    on conflict (user_id) do update set email = excluded.email, confirmed_at = excluded.confirmed_at,
        revision = reminder_email_account_state.revision + 1,
        eligible_since = clock_timestamp(), dirty = true;
    return coalesce(new, old);
end;
$$;
create trigger track_reminder_email_account after insert or update or delete on auth.users
for each row execute function private.track_reminder_email_account();
insert into private.reminder_email_account_state (user_id, email, confirmed_at, dirty)
select
    id,
    email,
    email_confirmed_at,
    false as dirty
from auth.users on conflict (user_id) do nothing;

create table private.reminder_email_preferences (
    practice_id uuid not null,
    user_id uuid not null,
    enabled boolean not null default true,
    version integer not null default 1 check (version > 0),
    eligible_since timestamptz not null default clock_timestamp(),
    primary key (practice_id, user_id),
    foreign key (practice_id, user_id) references public.practice_memberships (
        practice_id, user_id
    ) on delete restrict
);
insert into private.reminder_email_preferences (practice_id, user_id)
select
    practice_id,
    user_id
from public.practice_memberships;
create table private.reminder_email_preference_requests (
    practice_id uuid not null,
    user_id uuid not null,
    request_id uuid not null,
    payload jsonb not null,
    result jsonb not null,
    primary key (practice_id, user_id, request_id),
    foreign key (practice_id, user_id) references private.reminder_email_preferences (
        practice_id, user_id
    ) on delete restrict
);
create table private.reminder_email_preference_events (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    user_id uuid not null,
    enabled boolean not null,
    version integer not null check (version > 0),
    occurred_at timestamptz not null default clock_timestamp(),
    foreign key (practice_id, user_id) references private.reminder_email_preferences (
        practice_id, user_id
    ) on delete restrict
);
create table private.reminder_email_endpoints (
    id uuid primary key default gen_random_uuid(),
    provider_namespace text not null check (provider_namespace ~ '^[a-zA-Z0-9_-]{1,80}$'),
    email text not null check (email = lower(trim(email)) and char_length(email) between 3 and 254),
    suppressed boolean not null default false,
    epoch bigint not null default 1 check (epoch > 0),
    reason text check (reason in ('bounced', 'complained', 'suppressed')),
    unique (provider_namespace, email)
);
create table private.reminder_jobs (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    credential_id uuid not null,
    cycle_id uuid not null,
    date_revision integer not null check (date_revision > 0),
    membership_id uuid not null,
    user_id uuid not null,
    channel text not null default 'email' check (channel = 'email'),
    lead_days integer not null default 60 check (lead_days = 60),
    due_date date,
    timezone text not null,
    nominal_target timestamptz,
    next_send_at timestamptz,
    eligible_since timestamptz not null,
    selection_version integer not null,
    account_revision bigint not null,
    preference_version integer not null,
    endpoint_id uuid references private.reminder_email_endpoints (id) on delete restrict,
    endpoint_epoch bigint,
    state text not null check (
        state in (
            'blocked',
            'queued',
            'claimed',
            'submitting',
            'accepted',
            'failed',
            'suppressed',
            'canceled',
            'uncertain'
        )
    ),
    reason text,
    claim_token uuid,
    claim_until timestamptz,
    invalidated_at timestamptz,
    updated_at timestamptz not null default clock_timestamp(),
    unique (practice_id, id),
    unique (cycle_id, date_revision, membership_id, lead_days, channel),
    foreign key (practice_id, credential_id, cycle_id) references public.credential_cycles (
        practice_id, credential_id, id
    ) on delete restrict,
    foreign key (practice_id, membership_id, user_id) references public.practice_memberships (
        practice_id, id, user_id
    ) on delete restrict,
    foreign key (practice_id, user_id) references public.practice_memberships (
        practice_id, user_id
    ) on delete restrict
);
create index reminder_jobs_due on private.reminder_jobs (next_send_at, id) where state in (
    'queued', 'claimed'
);
create index reminder_jobs_endpoint on private.reminder_jobs (endpoint_id, id);
create index reminder_jobs_practice on private.reminder_jobs (practice_id, credential_id, id);
create table private.reminder_message_attempts (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    job_id uuid not null,
    cycle_id uuid not null,
    user_id uuid not null,
    channel text not null default 'email' check (channel = 'email'),
    token uuid not null default gen_random_uuid(),
    endpoint_id uuid not null references private.reminder_email_endpoints (id) on delete restrict,
    provider_namespace text not null,
    provider_id uuid,
    payload jsonb not null,
    started_at timestamptz not null default clock_timestamp(),
    deadline timestamptz not null,
    outcome text not null default 'submitting' check (
        outcome in ('submitting', 'accepted', 'failed', 'uncertain')
    ),
    delivery text,
    error_category text,
    unique (practice_id, id),
    unique (cycle_id, user_id, channel),
    unique (provider_namespace, provider_id),
    foreign key (practice_id, job_id) references private.reminder_jobs (
        practice_id, id
    ) on delete restrict
);
create index reminder_attempts_expiry on private.reminder_message_attempts (
    deadline, id
) where outcome
= 'submitting';
create table private.reminder_job_events (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    job_id uuid not null,
    operation text not null,
    actor_user_id uuid,
    occurred_at timestamptz not null default clock_timestamp(),
    foreign key (practice_id, job_id) references private.reminder_jobs (
        practice_id, id
    ) on delete restrict
);
-- Event writes reference only their already-locked private parent: no indirect practice locks.
create table private.reminder_delivery_events (
    provider_namespace text not null,
    event_id text not null check (char_length(event_id) between 1 and 256),
    practice_id uuid not null,
    attempt_id uuid not null,
    provider_id uuid not null,
    status text not null,
    anomaly boolean not null default false,
    occurred_at timestamptz not null default clock_timestamp(),
    primary key (provider_namespace, event_id),
    foreign key (practice_id, attempt_id) references private.reminder_message_attempts (
        practice_id, id
    ) on delete restrict
);
create table private.reminder_reconcile_outbox (
    practice_id uuid primary key references public.practices (id) on delete restrict,
    generation bigint not null default 1 check (generation > 0),
    cursor_id uuid,
    updated_at timestamptz not null default clock_timestamp()
);
insert into private.reminder_reconcile_outbox (practice_id) select id from public.practices;
create table private.reminder_account_scan_state (
    singleton boolean primary key default true check (singleton),
    cursor_id uuid,
    version bigint not null default 1
);
insert into private.reminder_account_scan_state default values;
create table private.reminder_worker_runs (
    id uuid primary key default gen_random_uuid(),
    started_at timestamptz not null default clock_timestamp(),
    finished_at timestamptz,
    success boolean not null default false,
    counts jsonb not null default '{}'::jsonb,
    oldest_due_at timestamptz
);

create function private.reminder_target(p_date date, p_timezone text) returns timestamptz
language plpgsql stable security invoker set search_path = '' as $$
declare local_target timestamp; target timestamptz;
begin
    if p_date is null or p_date < date '0001-03-02' or p_date > date '9999-12-31' then return null; end if;
    local_target := p_date - 60 + time '09:00';
    target := local_target at time zone p_timezone;
    if target at time zone p_timezone <> local_target then return null; end if;
    return target;
end;
$$;
create function private.reminder_next_window(
    p_target timestamptz, p_zone text, p_now timestamptz
) returns timestamptz
language sql stable security invoker set search_path = '' as $$
    select case when p_target >= p_now then p_target
        when (p_now at time zone p_zone)::time < time '09:00' then
            ((p_now at time zone p_zone)::date + time '09:00') at time zone p_zone
        when (p_now at time zone p_zone)::time >= time '17:00' then
            ((p_now at time zone p_zone)::date + 1 + time '09:00') at time zone p_zone
        else p_now end;
$$;
create function private.dirty_email_reminders(
    p_practice_id uuid, p_reason text, p_credential_id uuid default null
) returns void
language plpgsql volatile security invoker set search_path = '' as $$
begin
    with canceled as (
        update private.reminder_jobs set state = case when state in ('blocked', 'queued', 'claimed') then 'canceled' else state end,
            reason = p_reason, claim_token = null, claim_until = null,
            invalidated_at = clock_timestamp(), updated_at = clock_timestamp()
        where practice_id = p_practice_id and (p_credential_id is null or credential_id = p_credential_id)
        returning practice_id, id
    ) insert into private.reminder_job_events (practice_id, job_id, operation, actor_user_id)
        select practice_id, id, p_reason, auth.uid() from canceled;
    insert into private.reminder_reconcile_outbox (practice_id) values (p_practice_id)
    on conflict (practice_id) do update set generation = reminder_reconcile_outbox.generation + 1,
        cursor_id = null, updated_at = clock_timestamp();
end;
$$;
-- New completion marker has no user writer yet. Future E5 must use practice authority.
create function private.invalidate_completed_email_cycle() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
    if new.completed_at is distinct from old.completed_at then
        perform private.dirty_email_reminders(new.practice_id, 'cycle-completed', new.credential_id);
    end if;
    return new;
end;
$$;
create trigger invalidate_completed_email_cycle
after update of completed_at on public.credential_cycles
for each row execute function private.invalidate_completed_email_cycle();

create function private.get_my_email_reminder_preference(p_practice_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pref private.reminder_email_preferences; can_edit boolean;
begin
    can_edit := private.require_recipient_member(p_practice_id, false);
    select * into pref from private.reminder_email_preferences where practice_id = p_practice_id and user_id = auth.uid();
    return jsonb_build_object('enabled', coalesce(pref.enabled, true), 'version', coalesce(pref.version, 1), 'canEnable', can_edit);
end;
$$;
create function private.set_my_email_reminder_preference(
    p_practice_id uuid, p_request_id uuid, p_enabled boolean, p_expected_version integer
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare pref private.reminder_email_preferences; request private.reminder_email_preference_requests;
    payload jsonb; result jsonb; can_edit boolean;
begin
    can_edit := private.require_recipient_member(p_practice_id, false);
    if p_request_id is null or p_enabled is null or p_expected_version is null or p_expected_version < 1 then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if p_enabled and not can_edit then raise exception 'forbidden' using errcode = '42501'; end if;
    payload := jsonb_build_object('enabled', p_enabled, 'version', p_expected_version);
    select * into request from private.reminder_email_preference_requests
    where practice_id = p_practice_id and user_id = auth.uid() and request_id = p_request_id;
    if found then
        if request.payload <> payload then return '{"status":"request-conflict"}'::jsonb; end if;
        return request.result;
    end if;
    insert into private.reminder_email_preferences (practice_id, user_id) values (p_practice_id, auth.uid()) on conflict do nothing;
    select * into pref from private.reminder_email_preferences where practice_id = p_practice_id and user_id = auth.uid() for update;
    if pref.version <> p_expected_version then return '{"status":"conflict"}'::jsonb; end if;
    if pref.enabled <> p_enabled then
        update private.reminder_email_preferences set enabled = p_enabled, version = version + 1,
            eligible_since = clock_timestamp() where practice_id = p_practice_id and user_id = auth.uid();
        insert into private.reminder_email_preference_events (practice_id, user_id, enabled, version)
        values (p_practice_id, auth.uid(), p_enabled, pref.version + 1);
        -- Cancel only this person's email jobs; assignment/SMS consent stay intact.
        with canceled as (
            update private.reminder_jobs set state = case when state in ('blocked', 'queued', 'claimed') then 'canceled' else state end,
                reason = 'email-preference-changed', claim_token = null, claim_until = null, invalidated_at = clock_timestamp()
            where practice_id = p_practice_id and user_id = auth.uid() returning practice_id, id
        ) insert into private.reminder_job_events (practice_id, job_id, operation, actor_user_id)
            select practice_id, id, 'email-preference-changed', auth.uid() from canceled;
        insert into private.reminder_reconcile_outbox (practice_id) values (p_practice_id)
        on conflict (practice_id) do update set generation = reminder_reconcile_outbox.generation + 1, cursor_id = null, updated_at = clock_timestamp();
    end if;
    result := jsonb_build_object('status', 'success', 'preference', private.get_my_email_reminder_preference(p_practice_id));
    insert into private.reminder_email_preference_requests values (p_practice_id, auth.uid(), p_request_id, payload, result);
    return result;
end;
$$;

-- Candidate discovery is unlocked; every domain operation takes practice first.
create function private.lock_email_recipient(
    p_practice_id uuid
) returns boolean
language plpgsql volatile security invoker set search_path = '' as $$
declare recipient_user uuid;
begin
    perform 1 from public.practices where id = p_practice_id for update nowait;
    if not found then return false; end if;
    select m.user_id into recipient_user from private.practice_reminder_settings s
    join public.practice_memberships m on m.practice_id = s.practice_id and m.id = s.membership_id
    where s.practice_id = p_practice_id;
    if recipient_user is not null then
        perform 1 from auth.users where id = recipient_user for share nowait;
        perform 1 from private.reminder_email_account_state where user_id = recipient_user for update nowait;
    end if;
    return true;
exception when lock_not_available then return false;
end;
$$;

create function private.email_reminder_context(
    p_practice_id uuid, p_credential_id uuid, p_namespace text, p_now timestamptz
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
    practice public.practices; credential public.credentials; cycle public.credential_cycles;
    settings private.practice_reminder_settings; member public.practice_memberships;
    account private.reminder_email_account_state; pref private.reminder_email_preferences;
    endpoint private.reminder_email_endpoints; confirmed timestamptz; address text;
    due date; target timestamptz; onset timestamptz; zone_changed timestamptz; reason text;
begin
    select * into practice from public.practices where id = p_practice_id;
    select * into credential from public.credentials where practice_id = p_practice_id and id = p_credential_id;
    select * into cycle from public.credential_cycles where practice_id = p_practice_id and credential_id = p_credential_id
    order by cycle_number desc limit 1;
    if credential.id is null or cycle.id is null then return null; end if;
    select * into settings from private.practice_reminder_settings where practice_id = p_practice_id;
    select * into member from public.practice_memberships where practice_id = p_practice_id and id = settings.membership_id;
    if member.id is null then return null; end if;
    select * into account from private.reminder_email_account_state where user_id = member.user_id;
    select lower(trim(email)), email_confirmed_at into address, confirmed from auth.users where id = member.user_id;
    select * into pref from private.reminder_email_preferences where practice_id = p_practice_id and user_id = member.user_id;
    select * into endpoint from private.reminder_email_endpoints where provider_namespace = p_namespace and email = address;
    select max(occurred_at) into zone_changed from private.practice_audit_events
    where practice_id = p_practice_id and before_timezone is distinct from after_timezone;
    due := coalesce(cycle.action_deadline, cycle.end_date);
    target := private.reminder_target(due, practice.timezone);
    onset := greatest(cycle.updated_at, settings.updated_at, account.eligible_since, pref.eligible_since, zone_changed);
    reason := case
        when credential.archived_at is not null then 'archived'
        when cycle.completed_at is not null then 'cycle-completed'
        when member.state <> 'active' or member.role not in ('administrator', 'manager') then 'member-unavailable'
        when confirmed is null or address is null or account.email is null then 'email-unconfirmed'
        when pref.enabled is false then 'email-disabled'
        when endpoint.suppressed then 'email-suppressed'
        when due is null then 'missing-date'
        when target is null then 'invalid-target'
        when exists (select 1 from private.reminder_message_attempts a
            where a.cycle_id = cycle.id and a.user_id = member.user_id and a.channel = 'email') then 'already-attempted'
        when onset > target then 'catch-up-unavailable'
        else null end;
    return jsonb_build_object('practiceId', p_practice_id, 'credentialId', p_credential_id, 'cycleId', cycle.id,
        'dateRevision', cycle.date_revision, 'membershipId', member.id, 'userId', member.user_id,
        'selectionVersion', settings.version, 'accountRevision', account.revision,
        'preferenceVersion', coalesce(pref.version, 1), 'email', address, 'timezone', practice.timezone,
        'dueDate', due, 'datePurpose', case when cycle.action_deadline is not null then 'action-deadline' else 'end-date' end,
        'target', target, 'eligibleSince', onset, 'endpointId', endpoint.id, 'endpointEpoch', endpoint.epoch,
        'nextSendAt', private.reminder_next_window(target, practice.timezone, p_now), 'reason', reason);
end;
$$;

create function private.drain_email_account_changes() returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare candidate record; account private.reminder_email_account_state; practice_id uuid; processed integer := 0;
    scan private.reminder_account_scan_state; last_id uuid;
begin
    select * into scan from private.reminder_account_scan_state;
    for candidate in select user_id, revision from private.reminder_email_account_state
        where dirty and (scan.cursor_id is null or user_id > scan.cursor_id) order by user_id limit 100 loop
        last_id := candidate.user_id;
        select m.practice_id into practice_id from public.practice_memberships m where m.user_id = candidate.user_id and m.state = 'active';
        begin
            if practice_id is not null then
                perform 1 from public.practices where id = practice_id for update nowait;
            end if;
            perform 1 from auth.users where id = candidate.user_id for share nowait;
            select * into account from private.reminder_email_account_state where user_id = candidate.user_id for update nowait;
            if account.revision <> candidate.revision then continue; end if;
            if practice_id is not null then
                perform private.dirty_email_reminders(practice_id, 'email-account-changed');
            end if;
            update private.reminder_email_account_state set dirty = false where user_id = candidate.user_id and revision = candidate.revision;
            processed := processed + 1;
        exception when lock_not_available then continue;
        end;
    end loop;
    if last_id is null or not exists (select 1 from private.reminder_email_account_state where dirty and user_id > last_id) then
        last_id := null;
    end if;
    -- Cursor is acquired last and acknowledged by observed version, never before practice/Auth.
    update private.reminder_account_scan_state set cursor_id = last_id, version = version + 1 where version = scan.version;
    return processed;
end;
$$;

create function private.reconcile_email_reminders_at(
    p_namespace text, p_now timestamptz
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare candidate record; outbox private.reminder_reconcile_outbox; row record; context jsonb;
    endpoint private.reminder_email_endpoints; last_id uuid; scanned integer := 0; account_count integer;
begin
    if p_namespace is null or p_namespace !~ '^[a-zA-Z0-9_-]{1,80}$' then raise exception 'invalid namespace'; end if;
    account_count := 0;
    for candidate in select practice_id from private.reminder_reconcile_outbox order by updated_at, practice_id limit 10 loop
        if not private.lock_email_recipient(candidate.practice_id) then continue; end if;
        select * into outbox from private.reminder_reconcile_outbox where practice_id = candidate.practice_id;
        if not found then continue; end if;
        last_id := outbox.cursor_id;
        for row in select id from public.credentials where practice_id = candidate.practice_id
            and (outbox.cursor_id is null or id > outbox.cursor_id) order by id limit 100 loop
            scanned := scanned + 1;
            last_id := row.id;
            context := private.email_reminder_context(candidate.practice_id, row.id, p_namespace, p_now);
            if context is null then continue; end if;
            if context->>'email' is not null then
                insert into private.reminder_email_endpoints (provider_namespace, email)
                values (p_namespace, context->>'email') on conflict do nothing;
                select * into endpoint from private.reminder_email_endpoints
                where provider_namespace = p_namespace and email = context->>'email' for update nowait;
                context := private.email_reminder_context(candidate.practice_id, row.id, p_namespace, p_now);
            else endpoint := null; end if;
            insert into private.reminder_jobs (practice_id, credential_id, cycle_id, date_revision, membership_id,
                user_id, due_date, timezone, nominal_target, next_send_at, eligible_since, selection_version,
                account_revision, preference_version, endpoint_id, endpoint_epoch, state, reason)
            values (candidate.practice_id, row.id, (context->>'cycleId')::uuid, (context->>'dateRevision')::integer,
                (context->>'membershipId')::uuid, (context->>'userId')::uuid, (context->>'dueDate')::date,
                context->>'timezone', (context->>'target')::timestamptz, (context->>'nextSendAt')::timestamptz,
                (context->>'eligibleSince')::timestamptz, (context->>'selectionVersion')::integer,
                (context->>'accountRevision')::bigint, (context->>'preferenceVersion')::integer,
                endpoint.id, endpoint.epoch, case when context->>'reason' is null then 'queued' else 'blocked' end, context->>'reason')
            on conflict (cycle_id, date_revision, membership_id, lead_days, channel) do update
            set due_date = excluded.due_date, timezone = excluded.timezone, nominal_target = excluded.nominal_target,
                next_send_at = excluded.next_send_at, eligible_since = excluded.eligible_since,
                selection_version = excluded.selection_version, account_revision = excluded.account_revision,
                preference_version = excluded.preference_version, endpoint_id = excluded.endpoint_id, endpoint_epoch = excluded.endpoint_epoch,
                state = excluded.state, reason = excluded.reason, claim_token = null, claim_until = null,
                invalidated_at = null, updated_at = p_now
            where reminder_jobs.state in ('blocked', 'queued', 'canceled')
                and not exists (select 1 from private.reminder_message_attempts a where a.cycle_id = excluded.cycle_id and a.user_id = excluded.user_id);
        end loop;
        -- Domain mutations hold the same practice lock and reset this cursor/generation.
        if exists (select 1 from public.credentials where practice_id = candidate.practice_id and id > last_id) then
            update private.reminder_reconcile_outbox set cursor_id = last_id, updated_at = p_now where practice_id = candidate.practice_id and generation = outbox.generation;
        else
            delete from private.reminder_reconcile_outbox where practice_id = candidate.practice_id and generation = outbox.generation;
        end if;
        return jsonb_build_object('scanned', scanned, 'accounts', account_count);
    end loop;
    return jsonb_build_object('scanned', 0, 'accounts', account_count);
exception when lock_not_available then return jsonb_build_object('scanned', 0, 'accounts', 0, 'busy', true);
end;
$$;

create function private.reconcile_email_reminders(p_namespace text) returns jsonb
language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
begin return private.reconcile_email_reminders_at(p_namespace, clock_timestamp()); end;
$$;

create function private.claim_email_reminder_at(p_now timestamptz) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare candidate record; job private.reminder_jobs; token uuid := gen_random_uuid();
begin
    for candidate in select id, practice_id, endpoint_id from private.reminder_jobs
        where state in ('queued', 'claimed') and next_send_at <= p_now
            and (state = 'queued' or claim_until <= p_now) order by next_send_at, id limit 100 loop
        if not private.lock_email_recipient(candidate.practice_id) then continue; end if;
        perform 1 from private.reminder_email_endpoints where id = candidate.endpoint_id for update nowait;
        select * into job from private.reminder_jobs where id = candidate.id for update skip locked;
        if not found or job.state not in ('queued', 'claimed') or job.next_send_at > p_now
            or (job.state = 'claimed' and job.claim_until > p_now) then continue; end if;
        if private.reminder_next_window(job.nominal_target, job.timezone, p_now) > p_now then
            update private.reminder_jobs set state = 'queued', claim_token = null, claim_until = null,
                next_send_at = private.reminder_next_window(job.nominal_target, job.timezone, p_now), updated_at = p_now where id = job.id;
            continue;
        end if;
        update private.reminder_jobs set state = 'claimed', claim_token = token, claim_until = p_now + interval '30 seconds', updated_at = p_now
        where id = job.id;
        return jsonb_build_object('jobId', job.id, 'token', token);
    end loop;
    return null;
exception when lock_not_available then return null;
end;
$$;
create function private.claim_email_reminder() returns jsonb
language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
begin return coalesce(private.claim_email_reminder_at(clock_timestamp()), '{"status":"idle"}'::jsonb); end;
$$;

create function private.begin_email_reminder_at(
    p_job_id uuid, p_claim_token uuid, p_config jsonb, p_now timestamptz
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare job private.reminder_jobs; context jsonb; endpoint private.reminder_email_endpoints;
    attempt private.reminder_message_attempts; namespace text := p_config->>'namespace'; payload jsonb; link text; body text;
begin
    -- No arbitrary destination/message input. Only constrained server configuration is accepted.
    if jsonb_typeof(p_config) is distinct from 'object' then return '{"status":"invalid"}'::jsonb; end if;
    if exists (select 1 from jsonb_each_text(p_config) where value is null or char_length(value) > 512)
        or (select count(*) from jsonb_object_keys(p_config)) <> 4
        or not (p_config ?& array['namespace','from','replyTo','appUrl'])
        or namespace !~ '^[a-zA-Z0-9_-]{1,80}$'
        or p_config->>'from' !~ '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+$'
        or p_config->>'replyTo' !~ '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+$'
        or p_config->>'appUrl' !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$|^http://127[.]0[.]0[.]1:3000$'
        then return '{"status":"invalid"}'::jsonb; end if;
    select * into job from private.reminder_jobs where id = p_job_id;
    if not found or not private.lock_email_recipient(job.practice_id) then return '{"status":"unavailable"}'::jsonb; end if;
    select * into endpoint from private.reminder_email_endpoints where id = job.endpoint_id for update nowait;
    select * into job from private.reminder_jobs where id = p_job_id for update nowait;
    if job.state <> 'claimed' or job.claim_token is distinct from p_claim_token or job.claim_until <= p_now then
        return '{"status":"stale"}'::jsonb;
    end if;
    context := private.email_reminder_context(job.practice_id, job.credential_id, namespace, p_now);
    if context is null or context->>'reason' is not null
        or (context->>'cycleId')::uuid <> job.cycle_id or (context->>'dateRevision')::integer <> job.date_revision
        or (context->>'membershipId')::uuid <> job.membership_id or (context->>'userId')::uuid <> job.user_id
        or (context->>'selectionVersion')::integer <> job.selection_version
        or (context->>'accountRevision')::bigint <> job.account_revision
        or (context->>'preferenceVersion')::integer <> job.preference_version
        or (context->>'endpointId')::uuid is distinct from job.endpoint_id
        or (context->>'endpointEpoch')::bigint is distinct from job.endpoint_epoch
        or endpoint.suppressed or endpoint.provider_namespace <> namespace
        or endpoint.email is distinct from context->>'email'
        or (context->>'target')::timestamptz is distinct from job.nominal_target
        or context->>'timezone' <> job.timezone
        or job.next_send_at > p_now then
        update private.reminder_jobs set state = 'canceled', reason = coalesce(context->>'reason', 'eligibility-changed'),
            claim_token = null, claim_until = null, invalidated_at = p_now, updated_at = p_now where id = job.id;
        return '{"status":"stale"}'::jsonb;
    end if;
    if private.reminder_next_window(job.nominal_target, job.timezone, p_now) > p_now then
        update private.reminder_jobs set state = 'queued', claim_token = null, claim_until = null,
            next_send_at = private.reminder_next_window(job.nominal_target, job.timezone, p_now), updated_at = p_now where id = job.id;
        return '{"status":"window-closed"}'::jsonb;
    end if;
    attempt.id := gen_random_uuid(); attempt.token := gen_random_uuid();
    link := (p_config->>'appUrl') || '/practice/register/' || job.credential_id::text;
    body := 'A credential renewal needs attention. This reminder was scheduled 60 days before its due date. ' ||
        case when context->>'datePurpose' = 'action-deadline' then 'Action deadline: ' else 'End date: ' end ||
        to_char(job.due_date, 'YYYY-MM-DD') || E'.\nSign in to review the record: ' || link ||
        E'\nThese dates were entered by your practice. Review requirements with the issuer.\nManage reminder emails: ' ||
        (p_config->>'appUrl') || '/practice/reminders';
    payload := jsonb_build_object('from', p_config->>'from', 'to', jsonb_build_array(endpoint.email),
        'reply_to', p_config->>'replyTo', 'subject', 'Credential renewal reminder: 60 days', 'text', body,
        'html', '<p>A credential renewal needs attention. This reminder was scheduled 60 days before its due date.</p><p>' ||
            case when context->>'datePurpose' = 'action-deadline' then 'Action deadline: ' else 'End date: ' end ||
            to_char(job.due_date, 'YYYY-MM-DD') || '.</p><p><a href="' || link || '">Sign in to review the record</a></p>' ||
            '<p>These dates were entered by your practice. Review requirements with the issuer.</p><p><a href="' ||
            (p_config->>'appUrl') || '/practice/reminders">Manage reminder emails</a></p>',
        'tags', jsonb_build_array(jsonb_build_object('name','reminder_attempt','value',attempt.id::text)));
    insert into private.reminder_message_attempts (id, practice_id, job_id, cycle_id, user_id, token,
        endpoint_id, provider_namespace, payload, started_at, deadline)
    values (attempt.id, job.practice_id, job.id, job.cycle_id, job.user_id, attempt.token,
        endpoint.id, namespace, payload, p_now, p_now + interval '30 seconds') on conflict (cycle_id, user_id, channel) do nothing;
    if not found then return '{"status":"consumed"}'::jsonb; end if;
    update private.reminder_jobs set state = 'submitting', claim_token = null, claim_until = null, updated_at = p_now where id = job.id;
    insert into private.reminder_job_events (practice_id, job_id, operation) values (job.practice_id, job.id, 'begin-submit');
    return jsonb_build_object('status','submit', 'attemptId', attempt.id, 'token', attempt.token,
        'payload', payload, 'key', 'reminder-email/' || attempt.id::text);
exception when lock_not_available then return '{"status":"busy"}'::jsonb;
end;
$$;
create function private.begin_email_reminder(
    p_job_id uuid, p_claim_token uuid, p_config jsonb
) returns jsonb
language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
begin return private.begin_email_reminder_at(p_job_id, p_claim_token, p_config, clock_timestamp()); end;
$$;

create function private.record_email_reminder(
    p_attempt_id uuid, p_token uuid, p_outcome text, p_provider_id uuid, p_error text
) returns jsonb
language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
declare attempt private.reminder_message_attempts;
begin
    if p_outcome is null or p_outcome not in ('accepted','failed','uncertain') or (p_outcome = 'accepted' and p_provider_id is null)
        or (p_outcome <> 'accepted' and p_provider_id is not null)
        or (p_error is not null and p_error not in ('provider-rejected','provider-unavailable','invalid-response','interrupted')) then
        return '{"status":"invalid"}'::jsonb;
    end if;
    select * into attempt from private.reminder_message_attempts where id = p_attempt_id;
    if not found or attempt.token is distinct from p_token then return '{"status":"stale"}'::jsonb; end if;
    perform 1 from private.reminder_jobs where id = attempt.job_id for update;
    select * into attempt from private.reminder_message_attempts where id = p_attempt_id for update;
    if attempt.provider_id is not null and attempt.provider_id is distinct from p_provider_id and p_outcome = 'accepted' then
        return '{"status":"conflict"}'::jsonb;
    end if;
    if attempt.outcome in ('accepted','failed') then return '{"status":"recorded"}'::jsonb; end if;
    update private.reminder_message_attempts set outcome = p_outcome, provider_id = p_provider_id, error_category = p_error where id = attempt.id;
    update private.reminder_jobs set state = p_outcome, updated_at = clock_timestamp() where id = attempt.job_id and state in ('submitting','uncertain');
    return '{"status":"recorded"}'::jsonb;
end;
$$;
create function private.expire_email_submissions_at(p_now timestamptz) returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare candidate record; changed integer := 0;
begin
    for candidate in select id, job_id from private.reminder_message_attempts
        where outcome = 'submitting' and deadline <= p_now order by deadline, id limit 100 loop
        perform 1 from private.reminder_jobs where id = candidate.job_id for update skip locked;
        if not found then continue; end if;
        perform 1 from private.reminder_message_attempts where id = candidate.id for update skip locked;
        if not found then continue; end if;
        update private.reminder_message_attempts set outcome = 'uncertain', error_category = 'interrupted'
        where id = candidate.id and outcome = 'submitting' and deadline <= p_now;
        if found then
            update private.reminder_jobs set state = 'uncertain', updated_at = p_now where id = candidate.job_id and state = 'submitting';
            changed := changed + 1;
        end if;
    end loop;
    return changed;
end;
$$;
create function private.expire_email_submissions() returns integer
language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
begin return private.expire_email_submissions_at(clock_timestamp()); end;
$$;

create function private.email_reminder_binding(
    p_namespace text, p_provider_id uuid, p_attempt_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
declare attempt private.reminder_message_attempts;
begin
    select * into attempt from private.reminder_message_attempts
    where provider_namespace = p_namespace and (provider_id = p_provider_id or (id = p_attempt_id and provider_id is null)) limit 1;
    if not found then return '{"status":"missing"}'::jsonb; end if;
    return jsonb_build_object('attemptId', attempt.id, 'providerId', attempt.provider_id,
        'from', attempt.payload->>'from', 'to', attempt.payload->'to');
end;
$$;

create function private.apply_email_reminder_event(
    p_namespace text, p_event_id text, p_provider_id uuid,
    p_attempt_id uuid, p_status text, p_from text, p_to text
) returns jsonb
language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
declare attempt private.reminder_message_attempts; endpoint private.reminder_email_endpoints;
    existing private.reminder_delivery_events; anomaly boolean; row record;
begin
    if p_status is null or p_status not in ('sent','delivered','delayed','bounced','complained','failed','suppressed')
        or p_event_id is null or char_length(p_event_id) not between 1 and 256 then return '{"status":"invalid"}'::jsonb; end if;
    select * into attempt from private.reminder_message_attempts where id = p_attempt_id and provider_namespace = p_namespace;
    if not found then return '{"status":"unavailable"}'::jsonb; end if;
    select * into endpoint from private.reminder_email_endpoints where id = attempt.endpoint_id for update;
    -- Suppression locks endpoint then matching jobs in a fixed order; no domain/Auth locks.
    if p_status in ('bounced','complained','suppressed') then
        perform id from private.reminder_jobs where endpoint_id = endpoint.id order by id for update;
    else perform 1 from private.reminder_jobs where id = attempt.job_id for update; end if;
    select * into attempt from private.reminder_message_attempts where id = p_attempt_id for update;
    if attempt.payload->>'from' is distinct from p_from or attempt.payload->'to' <> jsonb_build_array(p_to)
        or p_provider_id is null or (attempt.provider_id is not null and attempt.provider_id <> p_provider_id)
        or (attempt.provider_id is null and attempt.outcome not in ('submitting','uncertain')) then return '{"status":"conflict"}'::jsonb; end if;
    select * into existing from private.reminder_delivery_events where provider_namespace = p_namespace and event_id = p_event_id;
    if found then
        if existing.attempt_id <> attempt.id or existing.provider_id <> p_provider_id or existing.status <> p_status then
            return '{"status":"conflict"}'::jsonb;
        end if;
        return '{"status":"recorded"}'::jsonb;
    end if;
    anomaly := attempt.delivery in ('delivered','bounced','complained','failed','suppressed') and attempt.delivery <> p_status;
    insert into private.reminder_delivery_events (provider_namespace, event_id, practice_id, attempt_id, provider_id, status, anomaly)
    values (p_namespace, p_event_id, attempt.practice_id, attempt.id, p_provider_id, p_status, coalesce(anomaly, false));
    update private.reminder_message_attempts set provider_id = p_provider_id,
        outcome = case when outcome in ('submitting','uncertain') then 'accepted' else outcome end,
        delivery = case when delivery = 'complained' or p_status = 'complained' then 'complained'
            when delivery in ('bounced','suppressed') then delivery
            when p_status in ('bounced','complained','suppressed') then p_status
            when delivery in ('delivered','failed') then delivery else p_status end where id = attempt.id;
    update private.reminder_jobs set state = 'accepted', updated_at = clock_timestamp()
        where id = attempt.job_id and state in ('submitting','uncertain');
    if p_status in ('bounced','complained','suppressed') then
        update private.reminder_email_endpoints set suppressed = true,
            epoch = epoch + case when suppressed then 0 else 1 end,
            reason = case when reason = 'complained' then reason else p_status end where id = endpoint.id;
        with canceled as (
            update private.reminder_jobs set state = 'suppressed', reason = 'email-suppressed', claim_token = null,
                claim_until = null, invalidated_at = clock_timestamp(), updated_at = clock_timestamp()
            where endpoint_id = endpoint.id and state in ('blocked','queued','claimed') returning practice_id, id
        ) insert into private.reminder_job_events (practice_id, job_id, operation)
            select practice_id, id, 'email-suppressed' from canceled;
    end if;
    return '{"status":"recorded"}'::jsonb;
end;
$$;

create function private.drain_email_reminder_accounts() returns integer
language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
begin return private.drain_email_account_changes(); end;
$$;
create function private.start_email_reminder_run() returns uuid
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
declare run_id uuid;
begin insert into private.reminder_worker_runs default values returning id into run_id; return run_id; end;
$$;
create function private.finish_email_reminder_run(
    p_run_id uuid, p_success boolean, p_counts jsonb
) returns boolean
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
begin
    if p_success is null or p_counts is null or jsonb_typeof(p_counts) <> 'object'
        or exists (select 1 from jsonb_each(p_counts) e where e.key not in ('scanned','accounts','expired','submitted','accepted','failed','uncertain')
            or e.value::text !~ '^[0-9]{1,6}$') then return false; end if;
    update private.reminder_worker_runs set finished_at = clock_timestamp(), success = p_success, counts = p_counts,
        oldest_due_at = (select min(next_send_at) from private.reminder_jobs where state in ('queued','claimed'))
    where id = p_run_id and finished_at is null;
    return found;
end;
$$;
create function private.get_email_reminder_schedule(
    p_practice_id uuid, p_namespace text, p_after uuid default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
declare rows jsonb; last_id uuid; has_more boolean; health timestamptz; settings private.practice_reminder_settings;
    readiness text; selected_user uuid; pref private.reminder_email_preferences; selected_email text; confirmed timestamptz;
begin
    perform private.require_recipient_member(p_practice_id, false);
    select * into settings from private.practice_reminder_settings where practice_id = p_practice_id;
    select m.user_id into selected_user from public.practice_memberships m
    where m.practice_id = p_practice_id and m.id = settings.membership_id and m.state = 'active' and m.role in ('administrator','manager');
    select lower(trim(u.email)), u.email_confirmed_at into selected_email, confirmed from auth.users u where u.id = selected_user;
    select * into pref from private.reminder_email_preferences where practice_id = p_practice_id and user_id = selected_user;
    readiness := case when settings.membership_id is null then 'no-recipient'
        when selected_user is null then 'member-unavailable' when confirmed is null or selected_email is null then 'email-unconfirmed'
        when pref.enabled is false then 'email-disabled'
        when exists (select 1 from private.reminder_email_endpoints e where e.provider_namespace = p_namespace and e.email = selected_email and e.suppressed) then 'email-suppressed'
        else 'ready' end;
    with page as (
        select c.id, c.title, cy.id cycle_id, coalesce(cy.action_deadline,cy.end_date) due,
            case when cy.action_deadline is not null then 'action-deadline' else 'end-date' end purpose,
            p.timezone, private.reminder_target(coalesce(cy.action_deadline,cy.end_date),p.timezone) target,
            j.state, j.reason, j.next_send_at, a.delivery, a.outcome,
            c.archived_at, cy.completed_at
        from public.credentials c join public.practices p on p.id = c.practice_id
        join lateral (select * from public.credential_cycles where practice_id = c.practice_id and credential_id = c.id order by cycle_number desc limit 1) cy on true
        left join lateral (select * from private.reminder_jobs where practice_id = c.practice_id and credential_id = c.id
            and cycle_id = cy.id and membership_id = settings.membership_id order by date_revision desc limit 1) j on true
        left join private.reminder_message_attempts a on a.cycle_id = cy.id and a.user_id = selected_user and a.channel = 'email'
        where c.practice_id = p_practice_id and (p_after is null or c.id > p_after) order by c.id limit 100
    ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'cycleId',cycle_id,'dueDate',due,'datePurpose',purpose,
        'timezone',timezone,'target',target,'nextSendAt',next_send_at,'state',coalesce(outcome,state,'pending'),
        'delivery',delivery,'reason',case when archived_at is not null then 'archived' when completed_at is not null then 'cycle-completed'
            when readiness <> 'ready' then readiness when due is null then 'missing-date' else reason end) order by id),'[]'::jsonb),
        (array_agg(id order by id desc))[1] into rows,last_id from page;
    select exists (select 1 from public.credentials where practice_id = p_practice_id and id > last_id) into has_more;
    select max(finished_at) into health from private.reminder_worker_runs where success;
    return jsonb_build_object('rows',rows,'nextCursor',case when has_more then last_id end,'emailReadiness',readiness,
        'smsOptional',true,'lastSuccessAt',health,
        'oldestDueAt',(select min(next_send_at) from private.reminder_jobs where practice_id = p_practice_id and state in ('queued','claimed')),
        'preference',private.get_my_email_reminder_preference(p_practice_id));
end;
$$;

-- Existing mutation bodies retained; invalidation shares their transaction.
create or replace function private.finish_register_create(
    p_practice_id uuid, p_request_id uuid, p_operation text, p_payload jsonb,
    p_clinician_id uuid, p_credential_id uuid, p_result jsonb
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
    insert into private.register_audit_events
        (practice_id, actor_user_id, operation, clinician_id, credential_id, after_data)
    values (p_practice_id, auth.uid(), p_operation, p_clinician_id, p_credential_id,
        case when p_operation = 'clinician-created' then p_result->'clinician'
             else p_result->'credential' end);
    insert into private.register_create_requests
        (practice_id, actor_user_id, request_id, operation, payload, result)
    values (p_practice_id, auth.uid(), p_request_id, p_operation, p_payload, p_result);
    if p_credential_id is not null then
        perform private.dirty_email_reminders(p_practice_id, 'credential-created', p_credential_id);
    end if;
    return p_result;
end;
$$;

create or replace function private.apply_credential_change(
    p_practice_id uuid,
    p_request_id uuid,
    p_credential_id uuid,
    p_expected_version integer,
    p_expected_cycle_id uuid,
    p_expected_date_revision integer,
    p_values jsonb
)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
    credential public.credentials;
    cycle public.credential_cycles;
    operation text := case when p_values is null then 'credential-archived' else 'credential-updated' end;
    payload jsonb;
    result jsonb;
    before_data jsonb;
    covered uuid[];
    old_covered uuid[];
    date_changed boolean;
    changed boolean;
begin
    if p_request_id is null or p_credential_id is null or p_expected_cycle_id is null
       or p_expected_version is null or p_expected_version < 1
       or p_expected_date_revision is null or p_expected_date_revision < 1 then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if p_values ? 'status' then return p_values; end if;
    payload := pg_catalog.jsonb_build_object('contract_version', 1, 'operation', operation,
        'credential_id', p_credential_id, 'expected_version', p_expected_version,
        'expected_cycle_id', p_expected_cycle_id, 'expected_date_revision', p_expected_date_revision,
        'values', p_values);
    result := private.register_change_replay(p_practice_id, p_request_id, operation, payload);
    if result is not null then return result; end if;
    select * into credential from public.credentials
    where practice_id = p_practice_id and id = p_credential_id;
    if not found then return '{"status":"not-found"}'::jsonb; end if;
    select * into cycle from public.credential_cycles
    where practice_id = p_practice_id and credential_id = credential.id and cycle_number = 1;
    if not found then raise exception 'missing credential cycle'; end if;
    if credential.archived_at is not null then return '{"status":"archived"}'::jsonb; end if;
    before_data := private.credential_maintenance_projection(credential);
    if credential.version <> p_expected_version or cycle.id <> p_expected_cycle_id
       or cycle.date_revision <> p_expected_date_revision then
        return pg_catalog.jsonb_build_object('status', 'conflict', 'credential', before_data);
    end if;
    changed := true;
    date_changed := false;
    if p_values is not null then
        select coalesce(array_agg(x::uuid order by x::uuid), '{}'::uuid[]) into covered
        from pg_catalog.jsonb_array_elements_text(p_values->'covered_clinician_ids') x;
        if ((p_values->>'owner_clinician_id') is not null and not exists (
            select 1 from public.clinicians where practice_id = p_practice_id
                and id = (p_values->>'owner_clinician_id')::uuid
        )) or exists (select 1 from unnest(covered) x where not exists (
            select 1 from public.clinicians where practice_id = p_practice_id and id = x
        )) then return '{"status":"invalid-reference"}'::jsonb; end if;
        select coalesce(array_agg(clinician_id order by clinician_id), '{}'::uuid[]) into old_covered
        from public.policy_coverage where practice_id = p_practice_id and credential_id = credential.id;
        date_changed := cycle.end_date is distinct from (p_values->>'end_date')::date
            or cycle.action_deadline is distinct from (p_values->>'action_deadline')::date;
        changed := date_changed or credential.title is distinct from p_values->>'title'
            or credential.type is distinct from p_values->>'type'
            or credential.owner_kind is distinct from p_values->>'owner_kind'
            or credential.owner_clinician_id is distinct from (p_values->>'owner_clinician_id')::uuid
            or credential.issuer is distinct from p_values->>'issuer'
            or credential.jurisdiction is distinct from p_values->>'jurisdiction'
            or old_covered is distinct from covered;
    end if;
    if changed and (credential.version = 2147483647 or (date_changed and cycle.date_revision = 2147483647)) then
        return pg_catalog.jsonb_build_object('status', 'conflict', 'credential', before_data);
    end if;
    if changed then
        if p_values is null then
            update public.credentials set archived_at = pg_catalog.clock_timestamp(),
                version = version + 1, updated_at = pg_catalog.clock_timestamp()
            where practice_id = p_practice_id and id = credential.id returning * into credential;
        else
            delete from public.policy_coverage where practice_id = p_practice_id and credential_id = credential.id;
            update public.credentials set title = p_values->>'title', type = p_values->>'type',
                owner_kind = p_values->>'owner_kind', owner_clinician_id = (p_values->>'owner_clinician_id')::uuid,
                issuer = p_values->>'issuer', jurisdiction = p_values->>'jurisdiction',
                version = version + 1, updated_at = pg_catalog.clock_timestamp()
            where practice_id = p_practice_id and id = credential.id returning * into credential;
            insert into public.policy_coverage (practice_id, credential_id, clinician_id)
            select p_practice_id, credential.id, x from unnest(covered) x;
            if date_changed then
                update public.credential_cycles set end_date = (p_values->>'end_date')::date,
                    action_deadline = (p_values->>'action_deadline')::date,
                    date_revision = date_revision + 1, updated_at = pg_catalog.clock_timestamp()
                where practice_id = p_practice_id and id = cycle.id;
            end if;
        end if;
    end if;
    result := pg_catalog.jsonb_build_object('status', 'success', 'changed', changed,
        'credential', private.credential_maintenance_projection(credential));
    if changed and (date_changed or p_values is null) then
        perform private.dirty_email_reminders(p_practice_id, operation, p_credential_id);
    end if;
    return private.finish_register_change(p_practice_id, p_request_id, credential.id, operation,
        payload, before_data, result);
end;
$$;

create or replace function private.update_practice(
    p_practice_id uuid, p_name text, p_timezone text, p_expected_version integer
) returns public.practices
language plpgsql volatile security definer set search_path = '' as $$
declare
    result public.practices;
    before_timezone text;
begin
    perform private.require_administrator(p_practice_id);
    select timezone into before_timezone from public.practices where id = p_practice_id;
    if p_expected_version is null or p_expected_version < 1 then
        raise exception 'Invalid version' using errcode = '23514';
    end if;
    update public.practices set name = p_name, timezone = p_timezone
    where id = p_practice_id and version = p_expected_version returning * into result;
    if not found then raise exception 'conflict' using errcode = 'PT409'; end if;
    if before_timezone is distinct from p_timezone then
        perform private.dirty_email_reminders(p_practice_id, 'timezone-changed');
    end if;
    return result;
end;
$$;

create or replace function private.change_reminder_recipient(
    p_practice_id uuid, p_membership_id uuid, p_reason text
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
    settings private.practice_reminder_settings;
begin
    select * into settings from private.practice_reminder_settings
    where practice_id = p_practice_id for update;
    if not found then raise exception 'Recipient settings unavailable' using errcode = 'XX000'; end if;
    if settings.membership_id is not distinct from p_membership_id then return; end if;
    update private.practice_reminder_settings set membership_id = p_membership_id,
        version = version + 1, updated_at = pg_catalog.clock_timestamp() where practice_id = p_practice_id;
    insert into private.practice_recipient_events
        (practice_id, actor_user_id, operation, before_membership_id, after_membership_id,
         before_version, after_version, reason)
    values (p_practice_id, auth.uid(),
        case when p_reason is not null then 'member-invalidated'
             when settings.membership_id is null then 'assigned'
             when p_membership_id is null then 'cleared' else 'replaced' end,
        settings.membership_id, p_membership_id, settings.version, settings.version + 1, p_reason);
    if p_membership_id is not null then
        insert into private.reminder_email_preferences (practice_id, user_id)
        select practice_id, user_id from public.practice_memberships where practice_id = p_practice_id and id = p_membership_id
        on conflict do nothing;
    end if;
    perform private.dirty_email_reminders(p_practice_id, 'recipient-changed');
end;
$$;

create function public.get_my_email_reminder_preference(p_practice_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.get_my_email_reminder_preference(p_practice_id);
$$;
revoke all on function public.get_my_email_reminder_preference(uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.get_my_email_reminder_preference(uuid) to authenticated;
revoke all on function private.get_my_email_reminder_preference(uuid) from public,
anon,
authenticated,
service_role;
grant execute on function private.get_my_email_reminder_preference(uuid) to authenticated;

create function public.set_my_email_reminder_preference(
    p_practice_id uuid, p_request_id uuid, p_enabled boolean, p_expected_version integer
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.set_my_email_reminder_preference(p_practice_id, p_request_id, p_enabled, p_expected_version);
$$;
revoke all on function public.set_my_email_reminder_preference(
    uuid, uuid, boolean, integer
) from public,
anon,
authenticated,
service_role;
grant execute on function public.set_my_email_reminder_preference(
    uuid, uuid, boolean, integer
) to authenticated;
revoke all on function private.set_my_email_reminder_preference(
    uuid, uuid, boolean, integer
) from public,
anon,
authenticated,
service_role;
grant execute on function private.set_my_email_reminder_preference(
    uuid, uuid, boolean, integer
) to authenticated;

create function public.get_email_reminder_schedule(
    p_practice_id uuid, p_namespace text, p_after uuid default null
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.get_email_reminder_schedule(p_practice_id, p_namespace, p_after);
$$;
revoke all on function public.get_email_reminder_schedule(uuid, text, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.get_email_reminder_schedule(uuid, text, uuid) to authenticated;
revoke all on function private.get_email_reminder_schedule(uuid, text, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function private.get_email_reminder_schedule(uuid, text, uuid) to authenticated;

create function public.drain_email_reminder_accounts() returns integer
language sql volatile security invoker set search_path = '' as $$
    select private.drain_email_reminder_accounts();
$$;
revoke all on function public.drain_email_reminder_accounts() from public,
anon,
authenticated,
service_role;
grant execute on function public.drain_email_reminder_accounts() to service_role;
revoke all on function private.drain_email_reminder_accounts() from public,
anon,
authenticated,
service_role;
grant execute on function private.drain_email_reminder_accounts() to service_role;

create function public.reconcile_email_reminders(p_namespace text) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.reconcile_email_reminders(p_namespace);
$$;
revoke all on function public.reconcile_email_reminders(text) from public,
anon,
authenticated,
service_role;
grant execute on function public.reconcile_email_reminders(text) to service_role;
revoke all on function private.reconcile_email_reminders(text) from public,
anon,
authenticated,
service_role;
grant execute on function private.reconcile_email_reminders(text) to service_role;

create function public.claim_email_reminder() returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.claim_email_reminder();
$$;
revoke all on function public.claim_email_reminder() from public, anon, authenticated, service_role;
grant execute on function public.claim_email_reminder() to service_role;
revoke all on function private.claim_email_reminder() from public,
anon,
authenticated,
service_role;
grant execute on function private.claim_email_reminder() to service_role;

create function public.begin_email_reminder(
    p_job_id uuid, p_claim_token uuid, p_config jsonb
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.begin_email_reminder(p_job_id, p_claim_token, p_config);
$$;
revoke all on function public.begin_email_reminder(uuid, uuid, jsonb) from public,
anon,
authenticated,
service_role;
grant execute on function public.begin_email_reminder(uuid, uuid, jsonb) to service_role;
revoke all on function private.begin_email_reminder(uuid, uuid, jsonb) from public,
anon,
authenticated,
service_role;
grant execute on function private.begin_email_reminder(uuid, uuid, jsonb) to service_role;

create function public.record_email_reminder(
    p_attempt_id uuid, p_token uuid, p_outcome text, p_provider_id uuid, p_error text
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.record_email_reminder(p_attempt_id, p_token, p_outcome, p_provider_id, p_error);
$$;
revoke all on function public.record_email_reminder(uuid, uuid, text, uuid, text) from public,
anon,
authenticated,
service_role;
grant execute on function public.record_email_reminder(
    uuid, uuid, text, uuid, text
) to service_role;
revoke all on function private.record_email_reminder(uuid, uuid, text, uuid, text) from public,
anon,
authenticated,
service_role;
grant execute on function private.record_email_reminder(
    uuid, uuid, text, uuid, text
) to service_role;

create function public.expire_email_submissions() returns integer
language sql volatile security invoker set search_path = '' as $$
    select private.expire_email_submissions();
$$;
revoke all on function public.expire_email_submissions() from public,
anon,
authenticated,
service_role;
grant execute on function public.expire_email_submissions() to service_role;
revoke all on function private.expire_email_submissions() from public,
anon,
authenticated,
service_role;
grant execute on function private.expire_email_submissions() to service_role;

create function public.email_reminder_binding(
    p_namespace text, p_provider_id uuid, p_attempt_id uuid
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.email_reminder_binding(p_namespace, p_provider_id, p_attempt_id);
$$;
revoke all on function public.email_reminder_binding(text, uuid, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.email_reminder_binding(text, uuid, uuid) to service_role;
revoke all on function private.email_reminder_binding(text, uuid, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function private.email_reminder_binding(text, uuid, uuid) to service_role;

create function public.apply_email_reminder_event(
    p_namespace text,
    p_event_id text,
    p_provider_id uuid,
    p_attempt_id uuid,
    p_status text,
    p_from text,
    p_to text
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.apply_email_reminder_event(p_namespace, p_event_id, p_provider_id, p_attempt_id, p_status, p_from, p_to);
$$;
revoke all on function public.apply_email_reminder_event(
    text, text, uuid, uuid, text, text, text
) from public,
anon,
authenticated,
service_role;
grant execute on function public.apply_email_reminder_event(
    text, text, uuid, uuid, text, text, text
) to service_role;
revoke all on function private.apply_email_reminder_event(
    text, text, uuid, uuid, text, text, text
) from public,
anon,
authenticated,
service_role;
grant execute on function private.apply_email_reminder_event(
    text, text, uuid, uuid, text, text, text
) to service_role;

create function public.start_email_reminder_run() returns uuid
language sql volatile security invoker set search_path = '' as $$
    select private.start_email_reminder_run();
$$;
revoke all on function public.start_email_reminder_run() from public,
anon,
authenticated,
service_role;
grant execute on function public.start_email_reminder_run() to service_role;
revoke all on function private.start_email_reminder_run() from public,
anon,
authenticated,
service_role;
grant execute on function private.start_email_reminder_run() to service_role;

create function public.finish_email_reminder_run(
    p_run_id uuid, p_success boolean, p_counts jsonb
) returns boolean
language sql volatile security invoker set search_path = '' as $$
    select private.finish_email_reminder_run(p_run_id, p_success, p_counts);
$$;
revoke all on function public.finish_email_reminder_run(uuid, boolean, jsonb) from public,
anon,
authenticated,
service_role;
grant execute on function public.finish_email_reminder_run(uuid, boolean, jsonb) to service_role;
revoke all on function private.finish_email_reminder_run(uuid, boolean, jsonb) from public,
anon,
authenticated,
service_role;
grant execute on function private.finish_email_reminder_run(uuid, boolean, jsonb) to service_role;

alter table private.reminder_email_account_state enable row level security;
revoke all on private.reminder_email_account_state from public, anon, authenticated, service_role;

alter table private.reminder_email_preferences enable row level security;
revoke all on private.reminder_email_preferences from public, anon, authenticated, service_role;

alter table private.reminder_email_preference_requests enable row level security;
revoke all on private.reminder_email_preference_requests from public,
anon,
authenticated,
service_role;

alter table private.reminder_email_preference_events enable row level security;
revoke all on private.reminder_email_preference_events from public,
anon,
authenticated,
service_role;

alter table private.reminder_email_endpoints enable row level security;
revoke all on private.reminder_email_endpoints from public, anon, authenticated, service_role;

alter table private.reminder_jobs enable row level security;
revoke all on private.reminder_jobs from public, anon, authenticated, service_role;

alter table private.reminder_message_attempts enable row level security;
revoke all on private.reminder_message_attempts from public, anon, authenticated, service_role;

alter table private.reminder_job_events enable row level security;
revoke all on private.reminder_job_events from public, anon, authenticated, service_role;

alter table private.reminder_delivery_events enable row level security;
revoke all on private.reminder_delivery_events from public, anon, authenticated, service_role;

alter table private.reminder_reconcile_outbox enable row level security;
revoke all on private.reminder_reconcile_outbox from public, anon, authenticated, service_role;

alter table private.reminder_worker_runs enable row level security;
revoke all on private.reminder_worker_runs from public, anon, authenticated, service_role;
revoke all on function private.track_reminder_email_account() from public,
anon,
authenticated,
service_role;
revoke all on function private.reminder_target(date, text) from public,
anon,
authenticated,
service_role;
revoke all on function private.reminder_next_window(timestamptz, text, timestamptz) from public,
anon,
authenticated,
service_role;
revoke all on function private.dirty_email_reminders(uuid, text, uuid) from public,
anon,
authenticated,
service_role;
revoke all on function private.invalidate_completed_email_cycle() from public,
anon,
authenticated,
service_role;
revoke all on function private.lock_email_recipient(uuid) from public,
anon,
authenticated,
service_role;
revoke all on function private.email_reminder_context(uuid, uuid, text, timestamptz) from public,
anon,
authenticated,
service_role;
revoke all on function private.drain_email_account_changes() from public,
anon,
authenticated,
service_role;
revoke all on function private.reconcile_email_reminders_at(text, timestamptz) from public,
anon,
authenticated,
service_role;
revoke all on function private.claim_email_reminder_at(timestamptz) from public,
anon,
authenticated,
service_role;
revoke all on function private.begin_email_reminder_at(uuid, uuid, jsonb, timestamptz) from public,
anon,
authenticated,
service_role;
revoke all on function private.expire_email_submissions_at(timestamptz) from public,
anon,
authenticated,
service_role;

alter table private.reminder_account_scan_state enable row level security;
revoke all on private.reminder_account_scan_state from public, anon, authenticated, service_role;
