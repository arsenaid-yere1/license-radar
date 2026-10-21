-- Recovery never removes the consumed cycle/recipient guard. Legacy callers stay nonretryable.
alter table private.reminder_message_attempts
add column recovery_state text not null default 'legacy' check (
    recovery_state in
    (
        'legacy',
        'submitting',
        'retry-pending',
        'accepted',
        'permanent',
        'uncertain',
        'canceled',
        'exhausted',
        'expired'
    )
),
add column recovery_version integer not null default 1 check (recovery_version > 0),
add column post_count integer not null default 0 check (post_count between 0 and 3),
add column retry_due timestamptz,
add column retry_expires timestamptz,
add column check_count integer not null default 0 check (check_count between 0 and 6),
add column check_due timestamptz,
add column last_check_reserved timestamptz,
add column app_origin text,
add column urgency text check (urgency in ('future', 'today', 'past-due'));
alter table private.reminder_delivery_events
add column cursor_id uuid not null default gen_random_uuid() unique;
create table private.reminder_email_submissions (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    attempt_id uuid not null,
    ordinal integer not null check (ordinal between 1 and 3),
    token uuid not null default gen_random_uuid(),
    reserved_at timestamptz not null, deadline timestamptz not null,
    result_cursor_id uuid not null default gen_random_uuid() unique,
    result jsonb, observed_at timestamptz, unique (attempt_id, ordinal),
    foreign key (practice_id, attempt_id) references private.reminder_message_attempts (
        practice_id, id
    ) on delete restrict,
    check ((result is null) = (observed_at is null))
);
create unique index reminder_submission_pending on private.reminder_email_submissions (
    attempt_id
) where result is null;
create index reminder_email_submissions_pending_expiry on private.reminder_email_submissions (
    deadline, id
) where result is null;
create table private.reminder_email_checks (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    attempt_id uuid not null,
    ordinal integer not null check (ordinal between 1 and 6),
    token uuid not null default gen_random_uuid(),
    reserved_at timestamptz not null,
    deadline timestamptz not null,
    result_cursor_id uuid not null default gen_random_uuid() unique,
    anomaly boolean not null default false,
    result jsonb,
    observed_at timestamptz,
    unique (attempt_id, ordinal),
    foreign key (practice_id, attempt_id) references private.reminder_message_attempts (
        practice_id, id
    ) on delete restrict,
    check ((result is null) = (observed_at is null))
);
create unique index reminder_check_pending on private.reminder_email_checks (
    attempt_id
) where result is null;
create index reminder_email_checks_pending_expiry on private.reminder_email_checks (
    deadline, id
) where result is null;
create table private.reminder_email_check_requests (
    practice_id uuid not null,
    request_id uuid not null,
    attempt_id uuid not null,
    actor_user_id uuid not null,
    expected_version integer not null, result jsonb not null, requested_at timestamptz not null,
    primary key (practice_id, request_id),
    foreign key (practice_id, attempt_id) references private.reminder_message_attempts (
        practice_id, id
    ) on delete restrict
);
create table private.reminder_recovery_scan_state (
    singleton boolean primary key default true check (singleton),
    rotation integer not null default 0 check (rotation between 0 and 2)
);
insert into private.reminder_recovery_scan_state default values;
alter table private.reminder_email_submissions enable row level security;
alter table private.reminder_email_checks enable row level security;
alter table private.reminder_email_check_requests enable row level security;
alter table private.reminder_recovery_scan_state enable row level security;
revoke all on private.reminder_email_submissions, private.reminder_email_checks,
private.reminder_email_check_requests,
private.reminder_recovery_scan_state from public,
anon,
authenticated,
service_role;

create index reminder_retry_due on private.reminder_message_attempts (
    provider_namespace, retry_due, id
)
where recovery_state = 'retry-pending';
create index reminder_check_due on private.reminder_message_attempts (
    provider_namespace, check_due, id
)
where provider_id is not null and check_count < 6 and check_due is not null;
create function private.email_recovery_disposition(p_state text, p_provider_id uuid) returns text
language sql immutable set search_path = '' as $$
    select case when p_state = 'uncertain' and p_provider_id is null then 'review-needed' else p_state end;
$$;
create function private.email_check_delay(p_count integer) returns interval
language sql immutable set search_path = '' as $$
    select case p_count when 1 then interval '15 minutes' when 2 then interval '1 hour'
        when 3 then interval '6 hours' when 4 then interval '24 hours' else interval '72 hours' end;
$$;
create function private.email_check_open(a private.reminder_message_attempts) returns boolean
language sql stable set search_path = '' as $$
    select a.provider_id is not null and a.recovery_state<>'permanent'
        and not coalesce(a.delivery in ('delivered','bounced','complained','suppressed'),false)
        and not exists(select 1 from private.reminder_email_endpoints e where e.id=a.endpoint_id and e.suppressed);
$$;
create function private.email_recovery_summary(p_attempt_id uuid) returns jsonb
language sql stable set search_path = '' as $$
    select jsonb_build_object('disposition',private.email_recovery_disposition(a.recovery_state,a.provider_id),
        'version',a.recovery_version,'postCount',a.post_count,'retryDue',a.retry_due,'retryExpires',a.retry_expires,
        'checkCount',a.check_count,'checkDue',a.check_due,
        'canCheck',private.email_check_open(a) and a.check_count < 6 and
            (a.last_check_reserved is null or a.last_check_reserved <= clock_timestamp()-interval '15 minutes') and
            (a.check_due is null or a.check_due>clock_timestamp()) and
            not exists(select 1 from private.reminder_email_checks r where r.attempt_id=a.id and r.result is null))
    from private.reminder_message_attempts a where a.id=p_attempt_id;
$$;

create function private.begin_email_recovery_at(
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
        select * into job from private.reminder_jobs where id=p_job_id;
        if not found or not private.lock_email_recipient(job.practice_id) then return '{"status":"unavailable"}'; end if;
        select * into endpoint from private.reminder_email_endpoints where id=job.endpoint_id for update nowait;
        select * into job from private.reminder_jobs where id=p_job_id for update nowait;
        select * into a from private.reminder_message_attempts where job_id=p_job_id for update nowait;
        if not found or p_token is null or job.claim_token is null or job.claim_until is null
            or job.claim_token is distinct from p_token or job.claim_until<=p_now
            or a.recovery_state<>'retry-pending' or a.outcome='accepted' or a.provider_id is not null
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

create function private.record_email_submission_at(
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

create function private.expire_email_recovery_at(p_now timestamptz) returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare item record; changed integer:=0; attempt private.reminder_message_attempts;
begin
    for item in select s.id,s.attempt_id,a.job_id from private.reminder_email_submissions s
        join private.reminder_message_attempts a on a.id=s.attempt_id where s.result is null and s.deadline<=p_now order by s.deadline,s.id limit 100 loop
        perform 1 from private.reminder_jobs where id=item.job_id for update skip locked; if not found then continue; end if;
        perform 1 from private.reminder_message_attempts where id=item.attempt_id for update skip locked; if not found then continue; end if;
        perform 1 from private.reminder_email_submissions where id=item.id for update skip locked; if not found then continue; end if;
        update private.reminder_email_submissions set result='{"kind":"uncertain","reason":"expired"}',observed_at=p_now where id=item.id and result is null;
        if found then
            update private.reminder_message_attempts set recovery_state='uncertain',retry_due=null,outcome='uncertain',recovery_version=recovery_version+1
                where id=item.attempt_id and outcome<>'accepted'; changed:=changed+1;
        end if;
    end loop;
    for item in select r.id,r.attempt_id,a.job_id from private.reminder_email_checks r join private.reminder_message_attempts a on a.id=r.attempt_id
        where r.result is null and r.deadline<=p_now order by r.deadline,r.id limit 100 loop
        perform 1 from private.reminder_jobs where id=item.job_id for update skip locked; if not found then continue; end if;
        select * into attempt from private.reminder_message_attempts where id=item.attempt_id for update skip locked; if not found then continue; end if;
        update private.reminder_email_checks set result='{"matched":false,"status":null,"bounced":false}',observed_at=p_now where id=item.id and result is null;
        if found then
            update private.reminder_message_attempts set check_due=case when check_count<6 and private.email_check_open(reminder_message_attempts) then p_now+private.email_check_delay(check_count) end,
                recovery_version=recovery_version+1 where id=attempt.id; changed:=changed+1;
        end if;
    end loop;
    for item in select id,job_id from private.reminder_message_attempts
        where recovery_state='retry-pending' and retry_expires<=p_now order by retry_expires,id limit 100 loop
        perform 1 from private.reminder_jobs where id=item.job_id for update skip locked; if not found then continue; end if;
        perform 1 from private.reminder_message_attempts where id=item.id for update skip locked; if not found then continue; end if;
        update private.reminder_message_attempts set recovery_state='expired',retry_due=null,recovery_version=recovery_version+1
            where id=item.id and recovery_state='retry-pending' and retry_expires<=p_now;
        if found then changed:=changed+1; end if;
    end loop;
    return changed;
end;
$$;

create function private.claim_email_recovery_at(
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
            for a in select * from private.reminder_message_attempts where provider_namespace=p_namespace and recovery_state='retry-pending'
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
            for a in select * from private.reminder_message_attempts where provider_namespace=p_namespace and provider_id is not null
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

create function private.email_delivery_state(p_old text, p_new text) returns text
language sql immutable set search_path = '' as $$
    select case when p_old='complained' or p_new='complained' then 'complained'
        when p_old in ('bounced','suppressed') then p_old
        when p_new in ('bounced','complained','suppressed') then p_new
        when p_old in ('delivered','failed') then p_old else p_new end;
$$;
revoke all on function private.email_delivery_state(text, text) from public,
anon,
authenticated,
service_role;

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

create function private.record_email_check_at(
    p_check_id uuid, p_token uuid, p_result jsonb, p_now timestamptz
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare r private.reminder_email_checks; a private.reminder_message_attempts; endpoint private.reminder_email_endpoints; status text;
begin
    if jsonb_typeof(p_result) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_result))<>3
        or not(p_result ?& array['matched','status','bounced']) or jsonb_typeof(p_result->'matched')<>'boolean'
        or jsonb_typeof(p_result->'bounced')<>'boolean' or (p_result->>'status' is not null and p_result->>'status' not in
            ('sent','delivered','delayed','failed','complained','suppressed')) then return '{"status":"invalid"}'; end if;
    select * into r from private.reminder_email_checks where id=p_check_id;
    if not found or r.token is distinct from p_token then return '{"status":"stale"}'; end if;
    select * into a from private.reminder_message_attempts where id=r.attempt_id;
    if r.result is not null then return '{"status":"recorded"}'; end if;
    status:=case when (p_result->>'matched')::boolean then p_result->>'status' end;
    select * into endpoint from private.reminder_email_endpoints where id=a.endpoint_id for update;
    if status in ('complained','suppressed') then
        perform id from private.reminder_jobs where endpoint_id=endpoint.id order by id for update;
    else perform 1 from private.reminder_jobs where id=a.job_id for update; end if;
    select * into a from private.reminder_message_attempts where id=a.id for update;
    select * into r from private.reminder_email_checks where id=p_check_id for update;
    if r.result is not null then return '{"status":"recorded"}'; end if;
    update private.reminder_email_checks set result=p_result,observed_at=p_now,
        anomaly=coalesce(a.delivery in ('delivered','bounced','complained','failed','suppressed') and status is not null and a.delivery<>status,false) where id=r.id;
    if status is not null then
        update private.reminder_message_attempts set outcome='accepted',delivery=private.email_delivery_state(delivery,status) where id=a.id;
        update private.reminder_jobs set state='accepted',updated_at=p_now where id=a.job_id and state in ('submitting','uncertain');
        if status in ('complained','suppressed') then
            update private.reminder_email_endpoints set suppressed=true,epoch=epoch+case when suppressed then 0 else 1 end,
                reason=case when reason='complained' then reason else status end where id=endpoint.id;
            update private.reminder_message_attempts set check_due=null,recovery_version=recovery_version+1
                where endpoint_id=endpoint.id and check_due is not null;
            with canceled as (update private.reminder_jobs set state='suppressed',reason='email-suppressed',claim_token=null,
                claim_until=null,invalidated_at=p_now,updated_at=p_now where endpoint_id=endpoint.id and state in ('blocked','queued','claimed') returning practice_id,id)
            insert into private.reminder_job_events(practice_id,job_id,operation) select practice_id,id,'email-suppressed' from canceled;
        end if;
    end if;

    update private.reminder_message_attempts set check_due=case when check_count<6 and private.email_check_open(reminder_message_attempts) then p_now+private.email_check_delay(check_count) end,
        recovery_version=recovery_version+1 where id=a.id;
    return '{"status":"recorded"}';
end;
$$;

-- Authentic acceptance cancels a pending retry even if it precedes the submission result.
create function private.email_recovery_acceptance() returns trigger language plpgsql set search_path
= '' as $$
begin
    if new.outcome='accepted' and new.recovery_state<>'legacy' then
        new.recovery_state:='accepted';new.retry_due:=null;
        if old.outcome<>'accepted' then
            new.recovery_version:=new.recovery_version+1;
            if new.check_count=0 and new.check_due is null then new.check_due:=clock_timestamp()+interval '5 minutes'; end if;
        end if;
    end if;
    if not private.email_check_open(new) then new.check_due:=null; end if;
    return new;
end;
$$;
create trigger email_recovery_acceptance before update on private.reminder_message_attempts
for each row execute function private.email_recovery_acceptance();

create function private.request_email_reminder_check(
    p_practice_id uuid, p_attempt_id uuid, p_request_id uuid, p_expected_version integer
)
returns jsonb language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
declare a private.reminder_message_attempts; receipt private.reminder_email_check_requests; result jsonb; now timestamptz:=clock_timestamp();
begin
    perform private.require_recipient_member(p_practice_id,true);
    select * into a from private.reminder_message_attempts where id=p_attempt_id and practice_id=p_practice_id;
    if not found then return '{"status":"not-found"}'; end if;
    perform 1 from private.reminder_jobs where id=a.job_id for update;
    select * into a from private.reminder_message_attempts where id=p_attempt_id for update;
    select * into receipt from private.reminder_email_check_requests where practice_id=p_practice_id and request_id=p_request_id;
    if found then
        if receipt.attempt_id<>p_attempt_id or receipt.actor_user_id<>auth.uid() or receipt.expected_version<>p_expected_version then
            return '{"status":"request-conflict"}'; end if;
        return receipt.result;
    end if;
    result:=case when p_request_id is null or p_expected_version is null then '{"status":"invalid"}'::jsonb
        when a.recovery_version<>p_expected_version then '{"status":"conflict"}'::jsonb
        when a.provider_id is null then '{"status":"unknown-id"}'::jsonb
        when not private.email_check_open(a) then '{"status":"complete"}'::jsonb
        when a.check_count>=6 then '{"status":"exhausted"}'::jsonb
        when (a.last_check_reserved is not null and a.last_check_reserved>now-interval '15 minutes')
            or exists(select 1 from private.reminder_email_checks r where r.attempt_id=a.id and r.result is null)
            or a.check_due<=now then '{"status":"cooldown"}'::jsonb
        else '{"status":"queued"}'::jsonb end;
    if result->>'status'='queued' then
        update private.reminder_message_attempts set check_due=now,recovery_version=recovery_version+1 where id=a.id;
    end if;
    if p_request_id is not null and p_expected_version is not null then
        insert into private.reminder_email_check_requests values(p_practice_id,p_request_id,p_attempt_id,auth.uid(),p_expected_version,result,now);
    end if;
    return result;
end;
$$;

create function private.get_email_reminder_history(
    p_practice_id uuid, p_credential_id uuid, p_after uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' as $$
declare credential jsonb; rows jsonb; last_id uuid; more boolean;
begin
    perform private.require_recipient_member(p_practice_id,false);
    select jsonb_build_object('id',c.id,'title',c.title,'archived',c.archived_at is not null,
        'currentDueDate',coalesce(cy.action_deadline,cy.end_date),'currentTimezone',p.timezone) into credential
    from public.credentials c join public.practices p on p.id=c.practice_id
    join lateral(select * from public.credential_cycles where credential_id=c.id and practice_id=c.practice_id order by cycle_number desc limit 1) cy on true
    where c.id=p_credential_id and c.practice_id=p_practice_id;
    if credential is null then return '{"status":"not-found"}'; end if;
    if p_after is not null and not exists(select 1 from private.reminder_jobs where id=p_after and practice_id=p_practice_id and credential_id=p_credential_id) then
        return '{"status":"not-found"}'; end if;
    with page as(select j.*,a.id attempt_id,a.started_at,a.delivery,a.outcome,s.membership_id selected
        from private.reminder_jobs j left join private.reminder_message_attempts a on a.job_id=j.id and a.practice_id=j.practice_id
        left join private.practice_reminder_settings s on s.practice_id=j.practice_id
        where j.practice_id=p_practice_id and j.credential_id=p_credential_id and (p_after is null or j.id>p_after) order by j.id limit 50)
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'attemptId',attempt_id,
        'recipient',case when membership_id=selected then 'selected' else 'former' end,
        'dueDate',due_date,'timezone',timezone,'scheduleKind',schedule_kind,'nominalTarget',nominal_target,'dispatchTarget',dispatch_target,
        'state',coalesce(outcome,state),'delivery',delivery,'reason',reason,'startedAt',started_at,
        'recovery',private.email_recovery_summary(attempt_id)) order by id),'[]'::jsonb),
        (array_agg(id order by id desc))[1] into rows,last_id from page;
    select exists(select 1 from private.reminder_jobs where practice_id=p_practice_id and credential_id=p_credential_id and id>last_id) into more;
    return jsonb_build_object('status','success','credential',credential,'rows',rows,'nextCursor',case when more then last_id end);
end;
$$;
create function private.email_reminder_timeline_rows(p_attempt_id uuid)
returns table (id uuid, source text, observed_at timestamptz, operation text, anomaly boolean)
language sql stable set search_path = '' as $$
    select e.id,'job',e.occurred_at,e.operation,false from private.reminder_job_events e
        join private.reminder_message_attempts a on a.job_id=e.job_id and a.practice_id=e.practice_id where a.id=p_attempt_id
    union all select s.id,'submission',s.reserved_at,'reserved',false from private.reminder_email_submissions s where s.attempt_id=p_attempt_id
    union all select s.result_cursor_id,'submission',s.observed_at,s.result->>'kind',false
        from private.reminder_email_submissions s where s.attempt_id=p_attempt_id and s.observed_at is not null
    union all select e.cursor_id,'delivery',e.occurred_at,e.status,e.anomaly from private.reminder_delivery_events e where e.attempt_id=p_attempt_id
    union all select r.id,'check',r.reserved_at,'reserved',false from private.reminder_email_checks r where r.attempt_id=p_attempt_id
    union all select r.result_cursor_id,'check',r.observed_at,
        case when (r.result->>'matched')::boolean then coalesce(r.result->>'status','unknown-status') else 'unavailable' end,r.anomaly
        from private.reminder_email_checks r where r.attempt_id=p_attempt_id and r.observed_at is not null;
$$;
create function private.get_email_reminder_timeline(
    p_practice_id uuid,
    p_attempt_id uuid,
    p_after jsonb default null,
    p_credential_id uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' as $$
declare rows jsonb; anchor record; last_row record; cursor jsonb;
begin
    perform private.require_recipient_member(p_practice_id,false);
    if not exists(select 1 from private.reminder_message_attempts where id=p_attempt_id and practice_id=p_practice_id) then return '{"status":"not-found"}'; end if;
    if p_credential_id is not null and not exists(select 1 from private.reminder_message_attempts a join private.reminder_jobs j on j.id=a.job_id and j.practice_id=a.practice_id where a.id=p_attempt_id and j.credential_id=p_credential_id and j.practice_id=p_practice_id) then return '{"status":"not-found"}'; end if;
    if p_after is not null then
        if jsonb_typeof(p_after)<>'object' or (select count(*) from jsonb_object_keys(p_after))<>3 or not(p_after ?& array['id','source','observedAt']) then return '{"status":"not-found"}'; end if;
        select * into anchor from private.email_reminder_timeline_rows(p_attempt_id)
            where id=(p_after->>'id')::uuid and source=p_after->>'source' and observed_at=(p_after->>'observedAt')::timestamptz;
        if not found then return '{"status":"not-found"}'; end if;
    end if;
    with page as(select * from private.email_reminder_timeline_rows(p_attempt_id)
        where p_after is null or (observed_at,source,id)<((p_after->>'observedAt')::timestamptz,p_after->>'source',(p_after->>'id')::uuid)
        order by observed_at desc,source desc,id desc limit 50)
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'observedAt',observed_at,'operation',operation,'anomaly',anomaly)
        order by observed_at desc,source desc,id desc),'[]'::jsonb) into rows from page;
    if jsonb_array_length(rows)=50 then
        cursor:=rows->49;cursor:=jsonb_build_object('id',cursor->>'id','source',cursor->>'source','observedAt',cursor->>'observedAt');
        if not exists(select 1 from private.email_reminder_timeline_rows(p_attempt_id) where (observed_at,source,id)<
            ((cursor->>'observedAt')::timestamptz,cursor->>'source',(cursor->>'id')::uuid)) then cursor:=null; end if;
    end if;
    return jsonb_build_object('status','success','rows',rows,'nextCursor',cursor);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return '{"status":"not-found"}';
end;
$$;
create function private.get_email_reminder_schedule_v3(
    p_practice_id uuid, p_namespace text, p_after uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path
= '' set statement_timeout
= '5s' as $$
declare result jsonb; rows jsonb;
begin
    result:=private.get_email_reminder_schedule_v2(p_practice_id,p_namespace,p_after);
    select coalesce(jsonb_agg(item.value||jsonb_build_object('historyAvailable',true,
        'activeLinkAvailable',c.archived_at is null,'recovery',private.email_recovery_summary(a.id)) order by item.ordinality),'[]'::jsonb) into rows
    from jsonb_array_elements(result->'rows') with ordinality item(value,ordinality)
    join public.credentials c on c.id=(item.value->>'id')::uuid and c.practice_id=p_practice_id
    left join private.practice_reminder_settings s on s.practice_id=p_practice_id
    left join public.practice_memberships m on m.id=s.membership_id and m.practice_id=p_practice_id
    left join private.reminder_message_attempts a on a.cycle_id=(item.value->>'cycleId')::uuid and a.user_id=m.user_id;
    return jsonb_set(result,'{rows}',rows);
end;
$$;

create function private.begin_email_recovery(
    p_job_id uuid, p_token uuid, p_config jsonb, p_kind text
) returns jsonb
language sql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
    select private.begin_email_recovery_at(p_job_id,p_token,p_config,p_kind,clock_timestamp());
$$;
create function private.record_email_submission(
    p_submission_id uuid, p_token uuid, p_result jsonb
) returns jsonb
language sql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
    select private.record_email_submission_at(p_submission_id,p_token,p_result,clock_timestamp());
$$;
create function private.record_email_check(
    p_check_id uuid, p_token uuid, p_result jsonb
) returns jsonb
language sql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
    select private.record_email_check_at(p_check_id,p_token,p_result,clock_timestamp());
$$;
create function private.claim_email_recovery(p_namespace text, p_sending boolean) returns jsonb
language sql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
    select private.claim_email_recovery_at(p_namespace,p_sending,clock_timestamp());
$$;
create function private.expire_email_recovery() returns integer
language sql volatile security definer set search_path
= '' set statement_timeout
= '5s' set lock_timeout
= '1s' as $$
    select private.expire_email_recovery_at(clock_timestamp());
$$;

create function public.begin_email_recovery(
    p_job_id uuid, p_token uuid, p_config jsonb, p_kind text
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$ select private.begin_email_recovery(p_job_id,p_token,p_config,p_kind); $$;
revoke all on function public.begin_email_recovery(uuid, uuid, jsonb, text) from public,
anon,
authenticated,
service_role;
revoke all on function private.begin_email_recovery(uuid, uuid, jsonb, text) from public,
anon,
authenticated,
service_role;
grant execute on function public.begin_email_recovery(uuid, uuid, jsonb, text),
private.begin_email_recovery(uuid, uuid, jsonb, text) to service_role;

create function public.record_email_submission(
    p_submission_id uuid, p_token uuid, p_result jsonb
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$ select private.record_email_submission(p_submission_id,p_token,p_result); $$;
revoke all on function public.record_email_submission(uuid, uuid, jsonb) from public,
anon,
authenticated,
service_role;
revoke all on function private.record_email_submission(uuid, uuid, jsonb) from public,
anon,
authenticated,
service_role;
grant execute on function public.record_email_submission(uuid, uuid, jsonb),
private.record_email_submission(uuid, uuid, jsonb) to service_role;

create function public.record_email_check(
    p_check_id uuid, p_token uuid, p_result jsonb
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$ select private.record_email_check(p_check_id,p_token,p_result); $$;
revoke all on function public.record_email_check(uuid, uuid, jsonb) from public,
anon,
authenticated,
service_role;
revoke all on function private.record_email_check(uuid, uuid, jsonb) from public,
anon,
authenticated,
service_role;
grant execute on function public.record_email_check(uuid, uuid, jsonb),
private.record_email_check(uuid, uuid, jsonb) to service_role;

create function public.claim_email_recovery(p_namespace text, p_sending boolean) returns jsonb
language sql volatile security invoker set search_path
= '' as $$ select private.claim_email_recovery(p_namespace,p_sending); $$;
revoke all on function public.claim_email_recovery(text, boolean) from public,
anon,
authenticated,
service_role;
revoke all on function private.claim_email_recovery(text, boolean) from public,
anon,
authenticated,
service_role;
grant execute on function public.claim_email_recovery(text, boolean),
private.claim_email_recovery(text, boolean) to service_role;

create function public.expire_email_recovery() returns integer
language sql volatile security invoker set search_path
= '' as $$ select private.expire_email_recovery(); $$;
revoke all on function public.expire_email_recovery() from public,
anon,
authenticated,
service_role;
revoke all on function private.expire_email_recovery() from public,
anon,
authenticated,
service_role;
grant execute on function public.expire_email_recovery(),
private.expire_email_recovery() to service_role;

create function public.get_email_reminder_history(
    p_practice_id uuid, p_credential_id uuid, p_after uuid default null
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$ select private.get_email_reminder_history(p_practice_id,p_credential_id,p_after); $$;
revoke all on function public.get_email_reminder_history(uuid, uuid, uuid) from public,
anon,
authenticated,
service_role;
revoke all on function private.get_email_reminder_history(uuid, uuid, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.get_email_reminder_history(uuid, uuid, uuid),
private.get_email_reminder_history(uuid, uuid, uuid) to authenticated;

create function public.get_email_reminder_timeline(
    p_practice_id uuid,
    p_attempt_id uuid,
    p_after jsonb default null,
    p_credential_id uuid default null
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$
    select private.get_email_reminder_timeline(p_practice_id,p_attempt_id,p_after,p_credential_id);
$$;
revoke all on function public.get_email_reminder_timeline(uuid, uuid, jsonb, uuid) from public,
anon,
authenticated,
service_role;
revoke all on function private.get_email_reminder_timeline(uuid, uuid, jsonb, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.get_email_reminder_timeline(uuid, uuid, jsonb, uuid),
private.get_email_reminder_timeline(uuid, uuid, jsonb, uuid) to authenticated;

create function public.get_email_reminder_schedule_v3(
    p_practice_id uuid, p_namespace text, p_after uuid default null
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$ select private.get_email_reminder_schedule_v3(p_practice_id,p_namespace,p_after); $$;
revoke all on function public.get_email_reminder_schedule_v3(uuid, text, uuid) from public,
anon,
authenticated,
service_role;
revoke all on function private.get_email_reminder_schedule_v3(uuid, text, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.get_email_reminder_schedule_v3(uuid, text, uuid),
private.get_email_reminder_schedule_v3(uuid, text, uuid) to authenticated;

create function public.request_email_reminder_check(
    p_practice_id uuid, p_attempt_id uuid, p_request_id uuid, p_expected_version integer
) returns jsonb
language sql volatile security invoker set search_path
= '' as $$
    select private.request_email_reminder_check(p_practice_id,p_attempt_id,p_request_id,p_expected_version);
$$;
revoke all on function public.request_email_reminder_check(uuid, uuid, uuid, integer) from public,
anon,
authenticated,
service_role;
revoke all on function private.request_email_reminder_check(uuid, uuid, uuid, integer) from public,
anon,
authenticated,
service_role;
grant execute on function public.request_email_reminder_check(uuid, uuid, uuid, integer),
private.request_email_reminder_check(uuid, uuid, uuid, integer) to authenticated;
revoke all on function private.email_recovery_disposition(text, uuid) from public,
anon,
authenticated,
service_role;
revoke all on function private.email_check_delay(integer) from public,
anon,
authenticated,
service_role;
revoke all on function private.email_check_open(private.reminder_message_attempts) from public,
anon,
authenticated,
service_role;
revoke all on function private.email_recovery_summary(uuid) from public,
anon,
authenticated,
service_role;
revoke all on function private.begin_email_recovery_at(
    uuid, uuid, jsonb, text, timestamptz
) from public,
anon,
authenticated,
service_role;
revoke all on function private.record_email_submission_at(
    uuid, uuid, jsonb, timestamptz
) from public,
anon,
authenticated,
service_role;
revoke all on function private.record_email_check_at(uuid, uuid, jsonb, timestamptz) from public,
anon,
authenticated,
service_role;
revoke all on function private.claim_email_recovery_at(text, boolean, timestamptz) from public,
anon,
authenticated,
service_role;
revoke all on function private.expire_email_recovery_at(timestamptz) from public,
anon,
authenticated,
service_role;
revoke all on function private.email_recovery_acceptance() from public,
anon,
authenticated,
service_role;
revoke all on function private.email_reminder_timeline_rows(uuid) from public,
anon,
authenticated,
service_role;
