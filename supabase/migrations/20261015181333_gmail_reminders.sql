-- Gmail is a send-only capability. The cycle/user/channel consumption key is unchanged.
alter table private.reminder_message_attempts
add column provider_kind text not null default 'resend' check (
    provider_kind in ('resend', 'gmail')
),
add column gmail_message_id text,
add column gmail_authority_version integer,
add column gmail_subject text,
add column gmail_result jsonb,
add constraint gmail_attempt_capability check (
    (
        provider_kind = 'resend'
        and gmail_message_id is null
        and gmail_authority_version is null
        and gmail_subject is null
        and gmail_result is null
    )
    or (
        provider_kind = 'gmail' and provider_id is null and delivery is null and post_count = 1
        and retry_due is null and retry_expires is null and check_due is null and check_count = 0
        and gmail_authority_version is not null
        and gmail_authority_version > 0
        and gmail_subject is not null
        and (gmail_message_id is null or gmail_message_id ~ '^[a-zA-Z0-9_-]{1,128}$')
        and ((outcome = 'accepted') = (gmail_message_id is not null))
    )
),
add unique (provider_namespace, gmail_message_id);

create table private.gmail_reminder_authority (
    namespace text primary key check (namespace ~ '^[a-zA-Z0-9_-]{1,80}$'),
    sender text not null check (
        sender = lower(sender) and sender ~ '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+$'
    ),
    subject text not null check (subject ~ '^[a-zA-Z0-9_-]{1,255}$'),
    allowed_recipient text not null check (allowed_recipient = sender),
    app_origin text not null check (
        app_origin ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$|^http://127[.]0[.]0[.]1:3000$'
    ),
    enabled boolean not null default false,
    version integer not null default 1 check (version > 0)
);
create unique index gmail_one_enabled_authority on private.gmail_reminder_authority (
    enabled
) where enabled;
alter table private.gmail_reminder_authority enable row level security;
revoke all on private.gmail_reminder_authority from public, anon, authenticated, service_role;

-- Operator-only transition, deliberately absent from the public/service API.
create function private.prepare_gmail_reminders(p_practice_id uuid, p_namespace text) returns jsonb
language plpgsql volatile security invoker set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
declare authority private.gmail_reminder_authority; changed integer;
begin
    if not private.lock_email_recipient(p_practice_id) then return '{"status":"busy"}'; end if;
    select * into authority from private.gmail_reminder_authority where namespace = p_namespace for share nowait;
    if not found or authority.enabled or exists(select 1 from private.reminder_message_attempts where outcome = 'submitting') then
        return '{"status":"unavailable"}';
    end if;
    with canceled as (
        update private.reminder_jobs j set state = 'canceled', reason = 'provider-changed',
            claim_token = null, claim_until = null, invalidated_at = clock_timestamp(), updated_at = clock_timestamp()
        where j.practice_id = p_practice_id and j.state in ('blocked', 'queued', 'claimed')
            and not exists(select 1 from private.reminder_message_attempts a where a.cycle_id = j.cycle_id and a.user_id = j.user_id and a.channel = j.channel)
        returning practice_id, id
    ) insert into private.reminder_job_events(practice_id, job_id, operation)
        select practice_id, id, 'provider-changed' from canceled;
    get diagnostics changed = row_count;
    insert into private.reminder_reconcile_outbox(practice_id) values(p_practice_id)
    on conflict(practice_id) do update set generation = reminder_reconcile_outbox.generation + 1, cursor_id = null, updated_at = clock_timestamp();
    return jsonb_build_object('status', 'prepared', 'invalidated', changed);
exception when lock_not_available then return '{"status":"busy"}';
end;
$$;
revoke all on function private.prepare_gmail_reminders(uuid, text) from public,
anon,
authenticated,
service_role;

create function private.protect_gmail_authority() returns trigger
language plpgsql set search_path = '' as $$
begin
    if tg_op = 'INSERT' then
        if exists(select 1 from private.reminder_message_attempts where provider_namespace = new.namespace) then
            raise exception 'Consumed provider namespace cannot be rebound';
        end if;
        return new;
    end if;
    if exists(select 1 from private.reminder_message_attempts where provider_namespace = old.namespace)
        and (tg_op = 'DELETE' or new.namespace is distinct from old.namespace
            or new.sender is distinct from old.sender or new.subject is distinct from old.subject) then
        raise exception 'Consumed Gmail namespace cannot be rebound';
    end if;
    if tg_op = 'UPDATE' and new is distinct from old then new.version := old.version + 1; end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;
create trigger gmail_authority_binding
before insert or update or delete on private.gmail_reminder_authority
for each row execute function private.protect_gmail_authority();
revoke all on function private.protect_gmail_authority() from public,
anon,
authenticated,
service_role;

-- Keep original contracts callable, while all entry points check stored capability.
alter function private.email_reminder_context(
    uuid, uuid, text, timestamptz
) rename to resend_reminder_context;
create function private.email_reminder_context(
    p_practice_id uuid, p_credential_id uuid, p_namespace text, p_now timestamptz
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb; authority private.gmail_reminder_authority;
begin
    result := private.resend_reminder_context(p_practice_id, p_credential_id, p_namespace, p_now);
    select * into authority from private.gmail_reminder_authority where namespace = p_namespace;
    if found and result->>'reason' is null then
        if not authority.enabled then result := jsonb_set(result, '{reason}', '"gmail-unavailable"');
        elsif result->>'email' is distinct from authority.allowed_recipient then
            result := jsonb_set(result, '{reason}', '"gmail-recipient-blocked"');
        end if;
    end if;
    return result;
end;
$$;
revoke all on function private.email_reminder_context(uuid, uuid, text, timestamptz) from public,
anon,
authenticated,
service_role;

alter function private.begin_email_reminder_at(
    uuid, uuid, jsonb, timestamptz
) rename to begin_resend_reminder_at;
create function private.begin_email_reminder_at(
    p_job_id uuid, p_claim_token uuid, p_config jsonb, p_now timestamptz
)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
begin
    if exists(select 1 from private.gmail_reminder_authority where enabled or namespace = p_config->>'namespace') then
        return '{"status":"unavailable"}';
    end if;
    return private.begin_resend_reminder_at(p_job_id, p_claim_token, p_config, p_now);
end;
$$;
revoke all on function private.begin_email_reminder_at(uuid, uuid, jsonb, timestamptz) from public,
anon,
authenticated,
service_role;

create function private.begin_gmail_reminder_at(
    p_job_id uuid,
    p_claim_token uuid,
    p_config jsonb,
    p_subject text,
    p_authority_version integer,
    p_now timestamptz
)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare job private.reminder_jobs; authority private.gmail_reminder_authority; permission jsonb; attempt private.reminder_message_attempts;
begin
    select * into job from private.reminder_jobs where id = p_job_id;
    if not found or not private.lock_email_recipient(job.practice_id) then return '{"status":"unavailable"}'; end if;
    select * into authority from private.gmail_reminder_authority where namespace = p_config->>'namespace' for share nowait;
    if not found or not authority.enabled or authority.version is distinct from p_authority_version
        or authority.subject is distinct from p_subject or authority.sender is distinct from p_config->>'from'
        or authority.sender is distinct from p_config->>'replyTo' or authority.app_origin is distinct from p_config->>'appUrl'
        or exists(select 1 from private.reminder_message_attempts where provider_kind = 'resend' and outcome = 'submitting')
        then return '{"status":"unavailable"}'; end if;
    -- The existing begin rechecks every eligibility snapshot under this same practice lock.
    permission := private.begin_resend_reminder_at(p_job_id, p_claim_token, p_config, p_now);
    if permission->>'status' <> 'submit' then return permission; end if;
    update private.reminder_message_attempts set provider_kind = 'gmail', post_count = 1,
        gmail_authority_version = authority.version, gmail_subject = authority.subject,
        app_origin = authority.app_origin where id = (permission->>'attemptId')::uuid returning * into attempt;
    return permission || jsonb_build_object('deadline', attempt.deadline);
exception when lock_not_available then return '{"status":"busy"}';
end;
$$;

create function private.gmail_reminder_readiness(
    p_namespace text, p_subject text, p_sender text, p_allowed_recipient text, p_app_origin text
)
returns integer language sql stable security definer set search_path
= '' set statement_timeout
= '5s' as $$
    select version from private.gmail_reminder_authority
    where enabled and namespace = p_namespace and subject = p_subject and sender = p_sender
        and allowed_recipient = p_allowed_recipient and app_origin = p_app_origin
        and not exists(select 1 from private.reminder_message_attempts where provider_kind = 'resend' and outcome = 'submitting');
$$;
create function public.gmail_reminder_readiness(
    p_namespace text, p_subject text, p_sender text, p_allowed_recipient text, p_app_origin text
)
returns integer language sql stable security invoker set search_path = '' as $$
    select private.gmail_reminder_readiness(p_namespace, p_subject, p_sender, p_allowed_recipient, p_app_origin);
$$;
revoke all on function private.gmail_reminder_readiness(text, text, text, text, text),
public.gmail_reminder_readiness(text, text, text, text, text) from public,
anon,
authenticated,
service_role;
grant execute on function private.gmail_reminder_readiness(text, text, text, text, text),
public.gmail_reminder_readiness(text, text, text, text, text) to service_role;

create function private.record_gmail_reminder_at(
    p_attempt_id uuid,
    p_token uuid,
    p_outcome text,
    p_message_id text,
    p_error text,
    p_now timestamptz
)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare attempt private.reminder_message_attempts; result jsonb;
begin
    if p_outcome is null or p_outcome not in ('accepted', 'failed', 'uncertain')
        or (p_outcome = 'accepted') is distinct from (p_message_id is not null)
        or (p_message_id is not null and p_message_id !~ '^[a-zA-Z0-9_-]{1,128}$')
        or (p_error is not null and p_error not in ('provider-rejected', 'provider-unavailable', 'invalid-response', 'interrupted'))
        or (p_outcome = 'accepted' and p_error is not null) then return '{"status":"invalid"}'; end if;
    select * into attempt from private.reminder_message_attempts where id = p_attempt_id;
    if not found or attempt.provider_kind <> 'gmail' or attempt.token is distinct from p_token then return '{"status":"stale"}'; end if;
    perform 1 from private.reminder_jobs where id = attempt.job_id for update;
    select * into attempt from private.reminder_message_attempts where id = p_attempt_id for update;
    result := jsonb_build_object('outcome', p_outcome, 'messageId', p_message_id, 'error', p_error);
    if attempt.gmail_result is not null then
        if attempt.gmail_result = result then return '{"status":"recorded"}'; end if;
        return '{"status":"conflict"}';
    end if;
    update private.reminder_message_attempts set outcome = p_outcome, gmail_message_id = p_message_id,
        error_category = p_error, gmail_result = result where id = attempt.id;
    update private.reminder_jobs set state = p_outcome, updated_at = p_now where id = attempt.job_id;
    insert into private.reminder_job_events(practice_id, job_id, operation, occurred_at)
        values(attempt.practice_id, attempt.job_id, 'gmail-result-' || p_outcome, p_now);
    return '{"status":"recorded"}';
exception when unique_violation then return '{"status":"conflict"}';
end;
$$;

create function private.expire_gmail_reminders_at(p_now timestamptz) returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare item record; changed integer := 0;
begin
    for item in select id, job_id, practice_id from private.reminder_message_attempts
        where provider_kind = 'gmail' and outcome = 'submitting' and deadline <= p_now order by deadline, id limit 100 loop
        perform 1 from private.reminder_jobs where id = item.job_id for update skip locked;
        if not found then continue; end if;
        update private.reminder_message_attempts set outcome = 'uncertain', error_category = 'interrupted'
            where id = item.id and outcome = 'submitting' and deadline <= p_now;
        if found then
            update private.reminder_jobs set state = 'uncertain', updated_at = p_now where id = item.job_id;
            insert into private.reminder_job_events(practice_id, job_id, operation, occurred_at)
                values(item.practice_id, item.job_id, 'gmail-permission-expired', p_now);
            changed := changed + 1;
        end if;
    end loop;
    return changed;
end;
$$;

-- Resend ID/callback/retry functions must never attach their semantics to Gmail.
create or replace function private.email_check_open(
    a private.reminder_message_attempts
) returns boolean
language sql stable set search_path = '' as $$
    select a.provider_kind = 'resend' and a.provider_id is not null and a.recovery_state <> 'permanent'
        and not coalesce(a.delivery in ('delivered','bounced','complained','suppressed'),false)
        and not exists(select 1 from private.reminder_email_endpoints e where e.id = a.endpoint_id and e.suppressed);
$$;
create or replace function private.email_recovery_acceptance() returns trigger
language plpgsql set search_path = '' as $$
begin
    if new.provider_kind = 'resend' and new.outcome = 'accepted' and new.recovery_state <> 'legacy' then
        new.recovery_state := 'accepted'; new.retry_due := null;
        if old.outcome <> 'accepted' then
            new.recovery_version := new.recovery_version + 1;
            if new.check_count = 0 and new.check_due is null then new.check_due := clock_timestamp() + interval '5 minutes'; end if;
        end if;
    end if;
    if not private.email_check_open(new) then new.check_due := null; end if;
    return new;
end;
$$;

create function private.reminder_provider_capability(p_attempt_id uuid) returns jsonb
language sql stable set search_path = '' as $$
    select jsonb_build_object('kind', a.provider_kind, 'maxPosts', case when a.provider_kind = 'gmail' then 1 else 3 end,
        'deliveryChecks', a.provider_kind = 'resend', 'automaticResend', a.provider_kind = 'resend')
    from private.reminder_message_attempts a where a.id = p_attempt_id;
$$;
create function private.get_email_reminder_schedule_v4(
    p_practice_id uuid, p_namespace text, p_after uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' as $$
declare result jsonb; rows jsonb; authority private.gmail_reminder_authority; address text; blocked text;
begin
    result := private.get_email_reminder_schedule_v3(p_practice_id, p_namespace, p_after);
    select * into authority from private.gmail_reminder_authority where namespace = p_namespace;
    if found then
        select lower(trim(u.email)) into address from private.practice_reminder_settings s
            join public.practice_memberships m on m.id = s.membership_id and m.practice_id = s.practice_id
            join auth.users u on u.id = m.user_id where s.practice_id = p_practice_id;
        blocked := case when not authority.enabled then 'gmail-unavailable'
            when address is distinct from authority.allowed_recipient then 'gmail-recipient-blocked' end;
        if blocked is not null and result->>'emailReadiness' = 'ready' then
            result := jsonb_set(result, '{emailReadiness}', to_jsonb(blocked));
        end if;
    end if;
    select coalesce(jsonb_agg(item.value || jsonb_build_object('provider', private.reminder_provider_capability(a.id)) ||
        case when a.id is null and blocked is not null and item.value->>'reason' is null then jsonb_build_object('reason', blocked) else '{}'::jsonb end
        order by item.ordinality), '[]'::jsonb) into rows
    from jsonb_array_elements(result->'rows') with ordinality item(value, ordinality)
    left join private.practice_reminder_settings s on s.practice_id = p_practice_id
    left join public.practice_memberships m on m.id = s.membership_id and m.practice_id = p_practice_id
    left join private.reminder_message_attempts a on a.cycle_id = (item.value->>'cycleId')::uuid and a.user_id = m.user_id;
    return jsonb_set(result, '{rows}', rows);
end;
$$;
create function private.get_email_reminder_history_v2(
    p_practice_id uuid, p_credential_id uuid, p_after uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' as $$
declare result jsonb; rows jsonb;
begin
    result := private.get_email_reminder_history(p_practice_id, p_credential_id, p_after);
    if result->>'status' <> 'success' then return result; end if;
    select coalesce(jsonb_agg(item.value || jsonb_build_object('provider', private.reminder_provider_capability((item.value->>'attemptId')::uuid)) order by item.ordinality), '[]'::jsonb)
        into rows from jsonb_array_elements(result->'rows') with ordinality item(value, ordinality);
    return jsonb_set(result, '{rows}', rows);
end;
$$;
create function private.get_email_reminder_timeline_v2(
    p_practice_id uuid,
    p_attempt_id uuid,
    p_after jsonb default null,
    p_credential_id uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' as $$
declare result jsonb;
begin
    result := private.get_email_reminder_timeline(p_practice_id, p_attempt_id, p_after, p_credential_id);
    if result->>'status' <> 'success' then return result; end if;
    return result || jsonb_build_object('provider', private.reminder_provider_capability(p_attempt_id));
end;
$$;

create or replace function private.record_email_reminder(
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
    if not found or attempt.provider_kind <> 'resend' or attempt.token is distinct from p_token then return '{"status":"stale"}'::jsonb; end if;
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

create or replace function private.email_reminder_binding(
    p_namespace text, p_provider_id uuid, p_attempt_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
declare attempt private.reminder_message_attempts;
begin
    select * into attempt from private.reminder_message_attempts
    where provider_kind = 'resend' and provider_namespace = p_namespace and (provider_id = p_provider_id or (id = p_attempt_id and provider_id is null)) limit 1;
    if not found then return '{"status":"missing"}'::jsonb; end if;
    return jsonb_build_object('attemptId', attempt.id, 'providerId', attempt.provider_id,
        'from', attempt.payload->>'from', 'to', attempt.payload->'to');
end;
$$;

create or replace function private.apply_email_reminder_event(
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
    select * into attempt from private.reminder_message_attempts where id = p_attempt_id and provider_kind = 'resend' and provider_namespace = p_namespace;
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
        delivery = private.email_delivery_state(delivery,p_status) where id = attempt.id;
    update private.reminder_jobs set state = 'accepted', updated_at = clock_timestamp()
        where id = attempt.job_id and state in ('submitting','uncertain');
    if p_status in ('bounced','complained','suppressed') then
        update private.reminder_email_endpoints set suppressed = true,
            epoch = epoch + case when suppressed then 0 else 1 end,
            reason = case when reason = 'complained' then reason else p_status end where id = endpoint.id;
        update private.reminder_message_attempts set check_due=null,recovery_version=recovery_version+1
            where endpoint_id=endpoint.id and check_due is not null;
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

create or replace function private.begin_email_recovery_at(
    p_job_id uuid, p_token uuid, p_config jsonb, p_kind text, p_now timestamptz
) returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare job private.reminder_jobs; a private.reminder_message_attempts; endpoint private.reminder_email_endpoints;
    context jsonb; permission jsonb; reservation private.reminder_email_submissions; urgency text;
begin
    if p_kind='fresh' then
        permission:=private.begin_email_reminder_at(p_job_id,p_token,p_config,p_now);
        if permission->>'status'<>'submit' then return permission; end if;
        select * into a from private.reminder_message_attempts where id=(permission->>'attemptId')::uuid for update;
        select * into job from private.reminder_jobs where id=p_job_id;
        update private.reminder_message_attempts set recovery_state='submitting',post_count=1,
            retry_expires=p_now+interval '23 hours',app_origin=p_config->>'appUrl',
            urgency=case when job.due_date < (p_now at time zone job.timezone)::date then 'past-due'
                when job.due_date = (p_now at time zone job.timezone)::date then 'today' else 'future' end
        where id=a.id returning * into a;
    elsif p_kind='retry' then
        if exists(select 1 from private.gmail_reminder_authority where enabled) then return '{"status":"unavailable"}'; end if;
        select * into job from private.reminder_jobs where id=p_job_id;
        if not found or not private.lock_email_recipient(job.practice_id) then return '{"status":"unavailable"}'; end if;
        select * into endpoint from private.reminder_email_endpoints where id=job.endpoint_id for update nowait;
        select * into job from private.reminder_jobs where id=p_job_id for update nowait;
        select * into a from private.reminder_message_attempts where job_id=p_job_id for update nowait;
        if not found or p_token is null or job.claim_token is null or job.claim_until is null
            or job.claim_token is distinct from p_token or job.claim_until<=p_now
            or a.provider_kind <> 'resend' or a.recovery_state<>'retry-pending' or a.outcome='accepted' or a.provider_id is not null
            or a.post_count>=3 or a.retry_due>p_now then return '{"status":"stale"}'; end if;
        context:=private.email_reminder_context(job.practice_id,job.credential_id,a.provider_namespace,p_now);
        urgency:=case when job.due_date < (p_now at time zone job.timezone)::date then 'past-due'
            when job.due_date = (p_now at time zone job.timezone)::date then 'today' else 'future' end;
        if job.invalidated_at is not null or context is null or context->>'reason' is distinct from 'already-attempted'
            or (context->>'cycleId')::uuid is distinct from job.cycle_id
            or (context->>'dateRevision')::integer is distinct from job.date_revision
            or (context->>'membershipId')::uuid is distinct from job.membership_id
            or (context->>'userId')::uuid is distinct from job.user_id
            or (context->>'selectionVersion')::integer is distinct from job.selection_version
            or (context->>'accountRevision')::bigint is distinct from job.account_revision
            or (context->>'preferenceVersion')::integer is distinct from job.preference_version
            or (context->>'endpointId')::uuid is distinct from job.endpoint_id
            or (context->>'endpointEpoch')::bigint is distinct from job.endpoint_epoch
            or context->>'timezone' is distinct from job.timezone
            or (context->>'dueDate')::date is distinct from job.due_date
            or endpoint.suppressed or endpoint.email is distinct from a.payload->'to'->>0
            or p_config is distinct from jsonb_build_object('namespace',a.provider_namespace,'from',a.payload->>'from',
                'replyTo',a.payload->>'reply_to','appUrl',a.app_origin) or urgency is distinct from a.urgency then
            update private.reminder_message_attempts set recovery_state='canceled',retry_due=null,recovery_version=recovery_version+1 where id=a.id;
            update private.reminder_jobs set invalidated_at=coalesce(invalidated_at,p_now),claim_token=null,claim_until=null where id=job.id;
            return '{"status":"stale"}';
        end if;
        if p_now+interval '30 seconds'>=a.retry_expires then
            update private.reminder_message_attempts set recovery_state='expired',retry_due=null,recovery_version=recovery_version+1 where id=a.id;
            return '{"status":"stale"}';
        end if;
        if private.reminder_next_window(p_now,job.timezone,p_now)>p_now then return '{"status":"window-closed"}'; end if;
        update private.reminder_message_attempts set recovery_state='submitting',post_count=post_count+1,
            retry_due=null,recovery_version=recovery_version+1 where id=a.id returning * into a;
    else return '{"status":"invalid"}'; end if;
    insert into private.reminder_email_submissions(practice_id,attempt_id,ordinal,reserved_at,deadline)
        values(a.practice_id,a.id,a.post_count,p_now,least(p_now+interval '30 seconds',a.retry_expires)) returning * into reservation;
    update private.reminder_jobs set claim_token=null,claim_until=null where id=a.job_id;
    return jsonb_build_object('status','submit','attemptId',a.id,'token',reservation.token,'payload',a.payload,
        'key','reminder-email/'||a.id::text,'submissionId',reservation.id,'ordinal',reservation.ordinal,
        'deadline',reservation.deadline,'expiresAt',a.retry_expires);
exception when lock_not_available then return '{"status":"busy"}';
end;
$$;

create or replace function private.record_email_submission_at(
    p_submission_id uuid, p_token uuid, p_result jsonb, p_now timestamptz
)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare r private.reminder_email_submissions; a private.reminder_message_attempts; j private.reminder_jobs; kind text; due timestamptz;
begin
    if jsonb_typeof(p_result) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_result))<>4
        or not(p_result ?& array['kind','providerId','errorCode','retryAfterSeconds'])
        or p_result->>'kind' is null or p_result->>'kind' not in ('accepted','rate-limited','permanent','uncertain')
        or (p_result->>'errorCode' is not null and p_result->>'errorCode' !~ '^[a-z0-9_-]{1,64}$')
        or (p_result->>'kind'='accepted') is distinct from (p_result->>'providerId' is not null)
        or (p_result->>'retryAfterSeconds' is not null and p_result->>'retryAfterSeconds' !~ '^[0-9]{1,10}$')
        or (p_result->>'retryAfterSeconds')::bigint > 2147483647
        or (p_result->>'kind'='rate-limited' and p_result->>'errorCode' is distinct from 'rate_limit_exceeded') then return '{"status":"invalid"}'; end if;
    select * into r from private.reminder_email_submissions where id=p_submission_id;
    if not found or r.token is distinct from p_token then return '{"status":"stale"}'; end if;
    select * into a from private.reminder_message_attempts where id=r.attempt_id;
    if a.provider_kind <> 'resend' then return '{"status":"stale"}'; end if;
    select * into j from private.reminder_jobs where id=a.job_id for update;
    select * into a from private.reminder_message_attempts where id=a.id for update;
    select * into r from private.reminder_email_submissions where id=r.id for update;
    if r.result is not null then
        if r.result->>'reason'='expired' and p_result->>'kind'='accepted' and a.outcome='uncertain' then
            perform private.record_email_reminder(a.id,a.token,'accepted',(p_result->>'providerId')::uuid,null);
            insert into private.reminder_job_events(practice_id,job_id,operation,occurred_at)
                values(a.practice_id,a.job_id,'late-acceptance-recorded',p_now);
        end if;
        return '{"status":"recorded"}';
    end if;
    update private.reminder_email_submissions set result=p_result,observed_at=p_now where id=r.id;
    if a.outcome='accepted' then return '{"status":"recorded"}'; end if;
    kind:=p_result->>'kind';
    if kind='rate-limited' then
        due:=private.reminder_next_window(p_now,j.timezone,p_now+greatest(
            case when r.ordinal=1 then interval '1 minute' else interval '5 minutes' end,
            coalesce((p_result->>'retryAfterSeconds')::integer,0)*interval '1 second'));
        update private.reminder_message_attempts set outcome='uncertain',
            recovery_state=case when post_count>=3 then 'exhausted' when due+interval '30 seconds'>=retry_expires then 'expired'
                when j.invalidated_at is not null then 'canceled' else 'retry-pending' end,
            retry_due=case when post_count<3 and due+interval '30 seconds'<retry_expires and j.invalidated_at is null then due end,
            recovery_version=recovery_version+1 where id=a.id;
    else
        update private.reminder_message_attempts set outcome=case kind when 'accepted' then 'accepted' when 'permanent' then 'failed' else 'uncertain' end,
            provider_id=case when kind='accepted' then (p_result->>'providerId')::uuid else provider_id end,
            recovery_state=kind,retry_due=null,recovery_version=recovery_version+1,
            check_due=case when kind='accepted' and check_count=0 then p_now+interval '5 minutes' else check_due end where id=a.id;
    end if;
    update private.reminder_jobs set state=case kind when 'accepted' then 'accepted' when 'permanent' then 'failed' else 'uncertain' end,
        updated_at=p_now where id=j.id and state in ('submitting','uncertain');
    return '{"status":"recorded"}';
end;
$$;

create or replace function private.claim_email_recovery_at(
    p_namespace text, p_sending boolean, p_now timestamptz
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare rotation integer; slot integer; i integer; a private.reminder_message_attempts; check_reservation private.reminder_email_checks; lease jsonb; token uuid;
begin
    select s.rotation into rotation from private.reminder_recovery_scan_state s where singleton for update;
    for i in 0..2 loop
        slot:=(rotation+i)%3;
        if slot=0 and p_sending then
            lease:=private.claim_email_reminder_at(p_now);
            if lease is not null then
                update private.reminder_recovery_scan_state set rotation=1 where singleton;
                return lease||'{"kind":"fresh"}'::jsonb;
            end if;
        elsif slot=1 and p_sending then
            for a in select * from private.reminder_message_attempts where provider_kind='resend' and provider_namespace=p_namespace and recovery_state='retry-pending'
                and retry_due<=p_now and (select claim_until is null or claim_until<=p_now from private.reminder_jobs where id=job_id)
                order by retry_due,id limit 100 loop
                perform 1 from private.reminder_jobs where id=a.job_id for update skip locked; if not found then continue; end if;
                select * into a from private.reminder_message_attempts where id=a.id for update skip locked; if not found then continue; end if;
                if a.recovery_state<>'retry-pending' or a.outcome='accepted' then continue; end if;
                token:=gen_random_uuid();
                update private.reminder_jobs set claim_token=token,claim_until=p_now+interval '30 seconds' where id=a.job_id;
                update private.reminder_recovery_scan_state set rotation=2 where singleton;
                return jsonb_build_object('kind','retry','jobId',a.job_id,'token',token);
            end loop;
        elsif slot=2 then
            for a in select * from private.reminder_message_attempts where provider_kind='resend' and provider_namespace=p_namespace and provider_id is not null
                and private.email_check_open(reminder_message_attempts) and check_count<6 and check_due<=p_now and not exists(select 1 from private.reminder_email_checks r where r.attempt_id=reminder_message_attempts.id and r.result is null)
                order by check_due,id limit 100 loop
                perform 1 from private.reminder_jobs where id=a.job_id for update skip locked; if not found then continue; end if;
                select * into a from private.reminder_message_attempts where id=a.id for update skip locked; if not found then continue; end if;
                if not private.email_check_open(a) or a.check_count>=6 or a.check_due is null or a.check_due>p_now or exists(select 1 from private.reminder_email_checks r where r.attempt_id=a.id and r.result is null) then continue; end if;
                update private.reminder_message_attempts set check_count=check_count+1,check_due=null,last_check_reserved=p_now,
                    recovery_version=recovery_version+1 where id=a.id returning * into a;
                insert into private.reminder_email_checks(practice_id,attempt_id,ordinal,reserved_at,deadline)
                    values(a.practice_id,a.id,a.check_count,p_now,p_now+interval '30 seconds') returning * into check_reservation;
                update private.reminder_recovery_scan_state set rotation=0 where singleton;
                return jsonb_build_object('kind','check','attemptId',a.id,'checkId',check_reservation.id,'token',check_reservation.token,'providerId',a.provider_id,
                    'from',a.payload->>'from','to',a.payload->'to'->>0,'deadline',check_reservation.deadline);
            end loop;
        end if;
    end loop;
    return '{"status":"idle"}';
end;
$$;

create or replace function private.expire_email_submissions_at(p_now timestamptz) returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare candidate record; changed integer := 0;
begin
    for candidate in select id, job_id from private.reminder_message_attempts
        where provider_kind = 'resend' and outcome = 'submitting' and deadline <= p_now order by deadline, id limit 100 loop
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

create function private.begin_gmail_reminder(
    p_job_id uuid, p_claim_token uuid, p_config jsonb, p_subject text, p_authority_version integer
) returns jsonb
language sql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
    select private.begin_gmail_reminder_at(p_job_id,
        p_claim_token,
        p_config,
        p_subject,
        p_authority_version,
        clock_timestamp());
$$;

create function public.begin_gmail_reminder(
    p_job_id uuid, p_claim_token uuid, p_config jsonb, p_subject text, p_authority_version integer
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$
    select private.begin_gmail_reminder(p_job_id,
        p_claim_token,
        p_config,
        p_subject,
        p_authority_version);
$$;
revoke all on function public.begin_gmail_reminder(uuid, uuid, jsonb, text, integer),
private.begin_gmail_reminder(uuid, uuid, jsonb, text, integer) from public,
anon,
authenticated,
service_role;
grant execute on function public.begin_gmail_reminder(uuid, uuid, jsonb, text, integer),
private.begin_gmail_reminder(uuid, uuid, jsonb, text, integer) to service_role;

create function private.record_gmail_reminder(
    p_attempt_id uuid, p_token uuid, p_outcome text, p_message_id text, p_error text
) returns jsonb
language sql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
    select private.record_gmail_reminder_at(p_attempt_id,
        p_token,
        p_outcome,
        p_message_id,
        p_error,
        clock_timestamp());
$$;

create function public.record_gmail_reminder(
    p_attempt_id uuid, p_token uuid, p_outcome text, p_message_id text, p_error text
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$
    select private.record_gmail_reminder(p_attempt_id,
        p_token,
        p_outcome,
        p_message_id,
        p_error);
$$;
revoke all on function public.record_gmail_reminder(uuid, uuid, text, text, text),
private.record_gmail_reminder(uuid, uuid, text, text, text) from public,
anon,
authenticated,
service_role;
grant execute on function public.record_gmail_reminder(uuid, uuid, text, text, text),
private.record_gmail_reminder(uuid, uuid, text, text, text) to service_role;

create function private.expire_gmail_reminders() returns integer
language sql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
    select private.expire_gmail_reminders_at(clock_timestamp());
$$;

create function public.expire_gmail_reminders() returns integer
language sql volatile security invoker set search_path
= '' as $$
    select private.expire_gmail_reminders();
$$;
revoke all on function public.expire_gmail_reminders(),
private.expire_gmail_reminders() from public,
anon,
authenticated,
service_role;
grant execute on function public.expire_gmail_reminders(),
private.expire_gmail_reminders() to service_role;

create function public.get_email_reminder_schedule_v4(
    p_practice_id uuid, p_namespace text, p_after uuid default null
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$
    select private.get_email_reminder_schedule_v4(p_practice_id,
        p_namespace,
        p_after);
$$;
revoke all on function public.get_email_reminder_schedule_v4(uuid, text, uuid),
private.get_email_reminder_schedule_v4(uuid, text, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.get_email_reminder_schedule_v4(uuid, text, uuid),
private.get_email_reminder_schedule_v4(uuid, text, uuid) to authenticated;

create function public.get_email_reminder_history_v2(
    p_practice_id uuid, p_credential_id uuid, p_after uuid default null
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$
    select private.get_email_reminder_history_v2(p_practice_id,
        p_credential_id,
        p_after);
$$;
revoke all on function public.get_email_reminder_history_v2(uuid, uuid, uuid),
private.get_email_reminder_history_v2(uuid, uuid, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.get_email_reminder_history_v2(uuid, uuid, uuid),
private.get_email_reminder_history_v2(uuid, uuid, uuid) to authenticated;

create function public.get_email_reminder_timeline_v2(
    p_practice_id uuid,
    p_attempt_id uuid,
    p_after jsonb default null,
    p_credential_id uuid default null
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$
    select private.get_email_reminder_timeline_v2(p_practice_id,
        p_attempt_id,
        p_after,
        p_credential_id);
$$;
revoke all on function public.get_email_reminder_timeline_v2(uuid, uuid, jsonb, uuid),
private.get_email_reminder_timeline_v2(uuid, uuid, jsonb, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.get_email_reminder_timeline_v2(uuid, uuid, jsonb, uuid),
private.get_email_reminder_timeline_v2(uuid, uuid, jsonb, uuid) to authenticated;

revoke all on function private.begin_gmail_reminder_at(
    uuid, uuid, jsonb, text, integer, timestamptz
) from public,
anon,
authenticated,
service_role;

revoke all on function private.record_gmail_reminder_at(
    uuid, uuid, text, text, text, timestamptz
) from public,
anon,
authenticated,
service_role;

revoke all on function private.expire_gmail_reminders_at(timestamptz) from public,
anon,
authenticated,
service_role;

revoke all on function private.reminder_provider_capability(uuid) from public,
anon,
authenticated,
service_role;
