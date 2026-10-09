-- Scheduling semantics are additive; consumed email permission remains cycle/user/channel.
alter table private.reminder_jobs
add column schedule_kind text not null default 'normal'
check (schedule_kind in ('normal', 'catch-up')),
add column dispatch_target timestamptz;
update private.reminder_jobs set dispatch_target = nominal_target;
alter table private.reminder_jobs add constraint reminder_jobs_dispatch_target
check (state not in ('queued', 'claimed') or dispatch_target is not null);

alter table private.reminder_message_attempts
add column schedule_kind text not null default 'normal'
check (schedule_kind in ('normal', 'catch-up')),
add column nominal_target timestamptz,
add column dispatch_target timestamptz;
update private.reminder_message_attempts as a
set nominal_target = j.nominal_target, dispatch_target = j.nominal_target
from private.reminder_jobs as j
where j.id = a.job_id;
alter table private.reminder_message_attempts add constraint reminder_attempts_schedule_snapshot
check (nominal_target is not null and dispatch_target is not null);

create function private.reminder_valid_window(
    p_target timestamptz, p_zone text, p_now timestamptz
) returns timestamptz
language plpgsql stable security invoker set search_path = '' as $$
declare anchor timestamptz; local_anchor timestamp; day date; local_candidate timestamp;
    candidate timestamptz; offset_day integer;
begin
    if p_target is null or p_now is null then return null; end if;
    anchor := greatest(p_target, p_now);
    local_anchor := anchor at time zone p_zone;
    if local_anchor::date < date '0001-01-01' or local_anchor::date > date '9999-12-31' then return null; end if;
    if local_anchor::time >= time '09:00' and local_anchor::time < time '17:00' then return anchor; end if;
    day := local_anchor::date + case when local_anchor::time >= time '17:00' then 1 else 0 end;
    for offset_day in 0..7 loop
        if day + offset_day > date '9999-12-31' then return null; end if;
        local_candidate := day + offset_day + time '09:00';
        candidate := local_candidate at time zone p_zone;
        if candidate >= anchor and candidate at time zone p_zone = local_candidate then return candidate; end if;
    end loop;
    return null;
end;
$$;
revoke all on function private.reminder_valid_window(timestamptz, text, timestamptz)
from public, anon, authenticated, service_role;

create or replace function private.reminder_next_window(
    p_target timestamptz, p_zone text, p_now timestamptz
) returns timestamptz
language sql stable security invoker set search_path = '' as $$
    select private.reminder_valid_window(p_target, p_zone, p_now);
$$;


create or replace function private.email_reminder_context(
    p_practice_id uuid, p_credential_id uuid, p_namespace text, p_now timestamptz
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
    practice public.practices; credential public.credentials; cycle public.credential_cycles;
    settings private.practice_reminder_settings; member public.practice_memberships;
    account private.reminder_email_account_state; pref private.reminder_email_preferences;
    endpoint private.reminder_email_endpoints; confirmed timestamptz; address text;
    due date; target timestamptz; onset timestamptz; zone_changed timestamptz; reason text; kind text; dispatch timestamptz; next_send timestamptz;
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
    kind := case when onset > target then 'catch-up' else 'normal' end;
    dispatch := case when kind = 'catch-up' then private.reminder_next_window(onset, practice.timezone, onset) else target end;
    next_send := private.reminder_next_window(dispatch, practice.timezone, p_now);
    reason := case
        when credential.archived_at is not null then 'archived'
        when cycle.completed_at is not null then 'cycle-completed'
        when member.state <> 'active' or member.role not in ('administrator', 'manager') then 'member-unavailable'
        when confirmed is null or address is null or account.email is null then 'email-unconfirmed'
        when pref.enabled is false then 'email-disabled'
        when endpoint.suppressed then 'email-suppressed'
        when due is null then 'missing-date'
        when target is null or dispatch is null or next_send is null then 'invalid-target'
        when exists (select 1 from private.reminder_message_attempts a
            where a.cycle_id = cycle.id and a.user_id = member.user_id and a.channel = 'email') then 'already-attempted'
        else null end;
    return jsonb_build_object('practiceId', p_practice_id, 'credentialId', p_credential_id, 'cycleId', cycle.id,
        'dateRevision', cycle.date_revision, 'membershipId', member.id, 'userId', member.user_id,
        'selectionVersion', settings.version, 'accountRevision', account.revision,
        'preferenceVersion', coalesce(pref.version, 1), 'email', address, 'timezone', practice.timezone,
        'dueDate', due, 'datePurpose', case when cycle.action_deadline is not null then 'action-deadline' else 'end-date' end,
        'target', target, 'eligibleSince', onset, 'endpointId', endpoint.id, 'endpointEpoch', endpoint.epoch,
        'scheduleKind', kind, 'dispatchTarget', dispatch, 'nextSendAt', next_send, 'reason', reason);
end;
$$;

create or replace function private.reconcile_email_reminders_at(
    p_namespace text, p_now timestamptz
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare candidate record; outbox private.reminder_reconcile_outbox; row record; context jsonb;
    endpoint private.reminder_email_endpoints; last_id uuid; scanned integer := 0; account_count integer; previous private.reminder_jobs; scheduled_job_id uuid; announce boolean;
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
            select * into previous from private.reminder_jobs
            where cycle_id = (context->>'cycleId')::uuid and date_revision = (context->>'dateRevision')::integer
                and membership_id = (context->>'membershipId')::uuid and lead_days = 60 and channel = 'email';
            announce := context->>'scheduleKind' = 'catch-up' and context->>'reason' is null
                and (previous.id is null or previous.schedule_kind <> 'catch-up'
                    or previous.dispatch_target is distinct from (context->>'dispatchTarget')::timestamptz
                    or previous.selection_version is distinct from (context->>'selectionVersion')::integer
                    or previous.account_revision is distinct from (context->>'accountRevision')::bigint
                    or previous.preference_version is distinct from (context->>'preferenceVersion')::integer
                    or previous.timezone is distinct from context->>'timezone');
            insert into private.reminder_jobs (practice_id, credential_id, cycle_id, date_revision, membership_id,
                user_id, due_date, timezone, nominal_target, next_send_at, eligible_since, selection_version,
                account_revision, preference_version, endpoint_id, endpoint_epoch, schedule_kind, dispatch_target, state, reason)
            values (candidate.practice_id, row.id, (context->>'cycleId')::uuid, (context->>'dateRevision')::integer,
                (context->>'membershipId')::uuid, (context->>'userId')::uuid, (context->>'dueDate')::date,
                context->>'timezone', (context->>'target')::timestamptz, (context->>'nextSendAt')::timestamptz,
                (context->>'eligibleSince')::timestamptz, (context->>'selectionVersion')::integer,
                (context->>'accountRevision')::bigint, (context->>'preferenceVersion')::integer,
                endpoint.id, endpoint.epoch, context->>'scheduleKind', (context->>'dispatchTarget')::timestamptz, case when context->>'reason' is null then 'queued' else 'blocked' end, context->>'reason')
            on conflict (cycle_id, date_revision, membership_id, lead_days, channel) do update
            set due_date = excluded.due_date, timezone = excluded.timezone, nominal_target = excluded.nominal_target,
                next_send_at = excluded.next_send_at, eligible_since = excluded.eligible_since,
                schedule_kind = excluded.schedule_kind, dispatch_target = excluded.dispatch_target,
                selection_version = excluded.selection_version, account_revision = excluded.account_revision,
                preference_version = excluded.preference_version, endpoint_id = excluded.endpoint_id, endpoint_epoch = excluded.endpoint_epoch,
                state = excluded.state, reason = excluded.reason, claim_token = null, claim_until = null,
                invalidated_at = null, updated_at = p_now
            where reminder_jobs.state in ('blocked', 'queued', 'canceled')
                and not exists (select 1 from private.reminder_message_attempts a where a.cycle_id = excluded.cycle_id and a.user_id = excluded.user_id)
            returning id into scheduled_job_id;
            if scheduled_job_id is not null and announce then
                insert into private.reminder_job_events (practice_id, job_id, operation)
                values (candidate.practice_id, scheduled_job_id, 'catch-up-scheduled');
            end if;
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

create or replace function private.claim_email_reminder_at(p_now timestamptz) returns jsonb
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
        if private.reminder_next_window(job.dispatch_target, job.timezone, p_now) is null then
            update private.reminder_jobs set state = 'blocked', reason = 'invalid-target', claim_token = null, claim_until = null where id = job.id;
            continue;
        end if;
        if private.reminder_next_window(job.dispatch_target, job.timezone, p_now) > p_now then
            update private.reminder_jobs set state = 'queued', claim_token = null, claim_until = null,
                next_send_at = private.reminder_next_window(job.dispatch_target, job.timezone, p_now), updated_at = p_now where id = job.id;
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

create or replace function private.begin_email_reminder_at(
    p_job_id uuid, p_claim_token uuid, p_config jsonb, p_now timestamptz
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare job private.reminder_jobs; context jsonb; endpoint private.reminder_email_endpoints;
    attempt private.reminder_message_attempts; namespace text := p_config->>'namespace'; payload jsonb; link text; body text; introduction text; urgency text; subject text;
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
        or context->>'scheduleKind' is distinct from job.schedule_kind
        or (context->>'dispatchTarget')::timestamptz is distinct from job.dispatch_target
        or context->>'timezone' <> job.timezone
        or job.next_send_at > p_now then
        update private.reminder_jobs set state = 'canceled', reason = coalesce(context->>'reason', 'eligibility-changed'),
            claim_token = null, claim_until = null, invalidated_at = p_now, updated_at = p_now where id = job.id;
        return '{"status":"stale"}'::jsonb;
    end if;
    if private.reminder_next_window(job.dispatch_target, job.timezone, p_now) > p_now then
        update private.reminder_jobs set state = 'queued', claim_token = null, claim_until = null,
            next_send_at = private.reminder_next_window(job.dispatch_target, job.timezone, p_now), updated_at = p_now where id = job.id;
        return '{"status":"window-closed"}'::jsonb;
    end if;
    attempt.id := gen_random_uuid(); attempt.token := gen_random_uuid();
    link := (p_config->>'appUrl') || '/practice/register/' || job.credential_id::text;
    introduction := case when job.schedule_kind = 'catch-up' then
        'A credential renewal needs attention. Record details or reminder setup became eligible after the ordinary reminder target.'
        else 'A credential renewal needs attention. This reminder was scheduled 60 days before its due date.' end;
    subject := case when job.schedule_kind = 'catch-up' then 'Credential renewal catch-up reminder'
        else 'Credential renewal reminder: 60 days' end;
    urgency := case when job.due_date < (p_now at time zone job.timezone)::date then 'This renewal is past due.'
        when job.due_date = (p_now at time zone job.timezone)::date then 'This renewal is due today.'
        else 'This renewal is due on ' || to_char(job.due_date, 'YYYY-MM-DD') || '.' end;
    body := introduction || ' ' || urgency || ' ' ||
        case when context->>'datePurpose' = 'action-deadline' then 'Action deadline: ' else 'End date: ' end ||
        to_char(job.due_date, 'YYYY-MM-DD') || E'.\nSign in to review the record: ' || link ||
        E'\nThese dates were entered by your practice. Review requirements with the issuer.\nManage reminder emails: ' ||
        (p_config->>'appUrl') || '/practice/reminders';
    payload := jsonb_build_object('from', p_config->>'from', 'to', jsonb_build_array(endpoint.email),
        'reply_to', p_config->>'replyTo', 'subject', subject, 'text', body,
        'html', '<p>' || introduction || '</p><p>' || urgency || '</p><p>' ||
            case when context->>'datePurpose' = 'action-deadline' then 'Action deadline: ' else 'End date: ' end ||
            to_char(job.due_date, 'YYYY-MM-DD') || '.</p><p><a href="' || link || '">Sign in to review the record</a></p>' ||
            '<p>These dates were entered by your practice. Review requirements with the issuer.</p><p><a href="' ||
            (p_config->>'appUrl') || '/practice/reminders">Manage reminder emails</a></p>',
        'tags', jsonb_build_array(jsonb_build_object('name','reminder_attempt','value',attempt.id::text)));
    insert into private.reminder_message_attempts (id, practice_id, job_id, cycle_id, user_id, token,
        endpoint_id, provider_namespace, payload, started_at, deadline, schedule_kind, nominal_target, dispatch_target)
    values (attempt.id, job.practice_id, job.id, job.cycle_id, job.user_id, attempt.token,
        endpoint.id, namespace, payload, p_now, p_now + interval '30 seconds', job.schedule_kind, job.nominal_target, job.dispatch_target) on conflict (cycle_id, user_id, channel) do nothing;
    if not found then return '{"status":"consumed"}'::jsonb; end if;
    update private.reminder_jobs set state = 'submitting', claim_token = null, claim_until = null, updated_at = p_now where id = job.id;
    insert into private.reminder_job_events (practice_id, job_id, operation) values (job.practice_id, job.id, 'begin-submit');
    return jsonb_build_object('status','submit', 'attemptId', attempt.id, 'token', attempt.token,
        'payload', payload, 'key', 'reminder-email/' || attempt.id::text);
exception when lock_not_available then return '{"status":"busy"}'::jsonb;
end;
$$;

create or replace function private.get_email_reminder_schedule_v2(
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
            coalesce(sent.timezone, p.timezone) timezone, coalesce(a.nominal_target, private.reminder_target(coalesce(cy.action_deadline,cy.end_date),p.timezone)) target,
            coalesce(a.schedule_kind, j.schedule_kind) schedule_kind, coalesce(a.dispatch_target, j.dispatch_target) dispatch_target,
            j.state, j.reason, j.next_send_at, a.delivery, a.outcome,
            c.archived_at, cy.completed_at
        from public.credentials c join public.practices p on p.id = c.practice_id
        join lateral (select * from public.credential_cycles where practice_id = c.practice_id and credential_id = c.id order by cycle_number desc limit 1) cy on true
        left join lateral (select * from private.reminder_jobs where practice_id = c.practice_id and credential_id = c.id
            and cycle_id = cy.id and date_revision = cy.date_revision and invalidated_at is null
            and membership_id = settings.membership_id order by date_revision desc limit 1) j on true
        left join private.reminder_message_attempts a on a.cycle_id = cy.id and a.user_id = selected_user and a.channel = 'email'
        left join private.reminder_jobs sent on sent.id = a.job_id and sent.practice_id = c.practice_id
        where c.practice_id = p_practice_id and (p_after is null or c.id > p_after) order by c.id limit 100
    ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'cycleId',cycle_id,'dueDate',due,'datePurpose',purpose,
        'timezone',timezone,'target',target,'scheduleKind',schedule_kind,'dispatchTarget',dispatch_target,'nextSendAt',next_send_at,'state',coalesce(outcome,state,'pending'),
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


create function public.get_email_reminder_schedule_v2(
    p_practice_id uuid, p_namespace text, p_after uuid default null
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.get_email_reminder_schedule_v2(p_practice_id, p_namespace, p_after);
$$;
revoke all on function public.get_email_reminder_schedule_v2(uuid, text, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_email_reminder_schedule_v2(uuid, text, uuid) to authenticated;
revoke all on function private.get_email_reminder_schedule_v2(uuid, text, uuid)
from public, anon, authenticated, service_role;
grant execute on function private.get_email_reminder_schedule_v2(uuid, text, uuid) to authenticated;

-- Enqueue a re-evaluation without creating or consuming jobs, attempts or consent.
insert into private.reminder_reconcile_outbox (practice_id) select id from public.practices
on conflict (practice_id) do update
    set
        generation = reminder_reconcile_outbox.generation + 1,
        cursor_id = null, updated_at = clock_timestamp();
