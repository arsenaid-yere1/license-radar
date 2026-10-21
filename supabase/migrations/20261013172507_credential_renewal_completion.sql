-- Complete one retained cycle before opening its explicit successor.
create function private.current_credential_cycle(p_practice_id uuid, p_credential_id uuid)
returns public.credential_cycles language plpgsql stable security invoker set search_path = '' as $$
declare result public.credential_cycles;
begin
    select * into result from public.credential_cycles
    where practice_id = p_practice_id and credential_id = p_credential_id
    order by cycle_number desc limit 1;
    if not found then raise exception 'missing credential cycle'; end if;
    return result;
end;
$$;
create function private.renewal_completion_clock() returns timestamptz
language sql volatile security invoker set search_path = '' as $$
    select pg_catalog.clock_timestamp();
$$;
revoke all on function private.current_credential_cycle(uuid, uuid),
private.renewal_completion_clock() from public, anon, authenticated, service_role;

create or replace function private.credential_details_projection(
    p_record public.credentials
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
    cycle public.credential_cycles;
begin
    cycle := private.current_credential_cycle(p_record.practice_id, p_record.id);
    return private.credential_projection(p_record) || pg_catalog.jsonb_build_object(
        'issuer', p_record.issuer, 'jurisdiction', p_record.jurisdiction,
        'current_cycle', pg_catalog.jsonb_build_object('id', cycle.id,
            'cycle_number', cycle.cycle_number, 'date_revision', cycle.date_revision,
            'end_date', pg_catalog.to_char(cycle.end_date, 'YYYY-MM-DD'),
            'action_deadline', pg_catalog.to_char(cycle.action_deadline, 'YYYY-MM-DD')));
end;
$$;

create or replace function private.renewal_projection(p_record public.credentials) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare cycle public.credential_cycles; link private.credential_renewal_links;
    workflow private.credential_renewal_workflows;
begin
    cycle := private.current_credential_cycle(p_record.practice_id, p_record.id);
    select * into link from private.credential_renewal_links
    where practice_id = p_record.practice_id and credential_id = p_record.id;
    select * into workflow from private.credential_renewal_workflows
    where practice_id = p_record.practice_id and cycle_id = cycle.id;
    return pg_catalog.jsonb_build_object('link', pg_catalog.jsonb_build_object('url', link.url,
        'version', coalesce(link.version, 1)), 'workflow', pg_catalog.jsonb_build_object(
        'cycleId', cycle.id, 'status', coalesce(workflow.status, 'not-started'),
        'version', coalesce(workflow.version, 1), 'acknowledgedAt', workflow.acknowledged_at));
end;
$$;

create or replace function private.apply_renewal_change(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid, p_expected_date_revision integer, p_expected_renewal_version integer,
    p_intent text, p_value text
) returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare credential public.credentials; cycle public.credential_cycles;
    link private.credential_renewal_links; workflow private.credential_renewal_workflows;
    receipt private.renewal_change_requests; payload jsonb; result jsonb; before_data jsonb;
    current_data jsonb; normalized text; resource_version integer; changed boolean;
    occurred timestamptz; next_status text; next_ack timestamptz; next_actor uuid;
begin
    perform private.require_register_member(p_practice_id, true);
    if p_request_id is null or p_credential_id is null or p_expected_cycle_id is null
        or p_expected_version is null or p_expected_version < 1
        or p_expected_date_revision is null or p_expected_date_revision < 1
        or p_expected_renewal_version is null or p_expected_renewal_version < 1
        or p_intent is null or p_intent not in ('link', 'progress', 'review') then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if p_intent = 'link' then
        begin normalized := private.renewal_url(p_value);
        exception when invalid_parameter_value then
            return '{"status":"invalid","errors":{"url":"Enter a valid HTTPS renewal link (up to 2,048 characters)."}}'::jsonb;
        end;
    elsif p_intent = 'progress' then
        if p_value is null or p_value not in ('not-started', 'in-progress', 'awaiting-approval') then
            return '{"status":"invalid","errors":{"progress":"Choose a renewal progress status."}}'::jsonb;
        end if;
        normalized := p_value;
    end if;
    payload := pg_catalog.jsonb_build_object('intent', p_intent, 'credentialId', p_credential_id,
        'expectedVersion', p_expected_version, 'expectedCycleId', p_expected_cycle_id,
        'expectedDateRevision', p_expected_date_revision,
        'expectedRenewalVersion', p_expected_renewal_version, 'value', normalized);
    select * into receipt from private.renewal_change_requests
    where practice_id = p_practice_id and actor_user_id = auth.uid() and request_id = p_request_id;
    if found then
        if receipt.intent <> p_intent or receipt.payload <> payload then
            return '{"status":"request-conflict"}'::jsonb;
        end if;
        return receipt.result;
    end if;
    select * into credential from public.credentials where practice_id = p_practice_id and id = p_credential_id;
    if not found then return '{"status":"not-found"}'::jsonb; end if;
    cycle := private.current_credential_cycle(p_practice_id, credential.id);
    if credential.archived_at is not null then return '{"status":"archived"}'::jsonb; end if;
    if cycle.completed_at is not null then return '{"status":"completed"}'::jsonb; end if;
    before_data := private.renewal_projection(credential);
    current_data := private.credential_maintenance_projection(credential)
        || pg_catalog.jsonb_build_object('renewal', before_data);
    resource_version := (before_data->case when p_intent = 'link' then 'link' else 'workflow' end->>'version')::integer;
    if credential.version <> p_expected_version or cycle.id <> p_expected_cycle_id
        or cycle.date_revision <> p_expected_date_revision or resource_version <> p_expected_renewal_version then
        return pg_catalog.jsonb_build_object('status', 'conflict', 'credential', current_data);
    end if;
    select * into link from private.credential_renewal_links
    where practice_id = p_practice_id and credential_id = credential.id;
    select * into workflow from private.credential_renewal_workflows
    where practice_id = p_practice_id and cycle_id = cycle.id;
    changed := case when p_intent = 'link' then link.url is distinct from normalized
        when p_intent = 'progress' then coalesce(workflow.status, 'not-started') <> normalized
        else workflow.acknowledged_at is null end;
    if changed and resource_version = 2147483647 then
        return pg_catalog.jsonb_build_object('status', 'conflict', 'credential', current_data);
    end if;
    if changed then
        occurred := pg_catalog.clock_timestamp();
        if p_intent = 'link' then
            insert into private.credential_renewal_links (practice_id, credential_id, url, version, created_at, updated_at)
            values (p_practice_id, credential.id, normalized, resource_version + 1, occurred, occurred)
            on conflict (practice_id, credential_id) do update
                set url = excluded.url, version = excluded.version, updated_at = excluded.updated_at;
        else
            next_status := case when p_intent = 'progress' then normalized else coalesce(workflow.status, 'not-started') end;
            next_ack := case when p_intent = 'review' then occurred else workflow.acknowledged_at end;
            next_actor := case when p_intent = 'review' then auth.uid() else workflow.acknowledged_by end;
            insert into private.credential_renewal_workflows
                (practice_id, cycle_id, status, version, acknowledged_at, acknowledged_by, created_at, updated_at)
            values (p_practice_id, cycle.id, next_status, resource_version + 1, next_ack, next_actor, occurred, occurred)
            on conflict (practice_id, cycle_id) do update set status = excluded.status,
                version = excluded.version, acknowledged_at = excluded.acknowledged_at,
                acknowledged_by = excluded.acknowledged_by, updated_at = excluded.updated_at;
        end if;
        insert into private.renewal_audit_events
            (practice_id, actor_user_id, credential_id, cycle_id, operation, before_data, after_data, occurred_at)
        values (p_practice_id, auth.uid(), credential.id, cycle.id,
            case when p_intent = 'link' then 'link-changed' when p_intent = 'progress' then 'progress-changed' else 'review-acknowledged' end,
            before_data, private.renewal_projection(credential), occurred);
    end if;
    result := pg_catalog.jsonb_build_object('status', 'success', 'changed', changed,
        'credential', private.credential_maintenance_projection(credential)
            || pg_catalog.jsonb_build_object('renewal', private.renewal_projection(credential)));
    insert into private.renewal_change_requests
        (practice_id, actor_user_id, request_id, credential_id, cycle_id, intent, payload, result)
    values (p_practice_id, auth.uid(), p_request_id, credential.id, cycle.id, p_intent, payload, result);
    return result;
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
    cycle := private.current_credential_cycle(p_practice_id, credential.id);
    if credential.archived_at is not null then return '{"status":"archived"}'::jsonb; end if;
    if p_values is not null and cycle.completed_at is not null then return '{"status":"completed"}'::jsonb; end if;
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

create table private.credential_renewal_completions (
    practice_id uuid not null,
    credential_id uuid not null,
    predecessor_id uuid not null,
    successor_id uuid not null,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    completed_at timestamptz not null,
    before_data jsonb not null,
    after_data jsonb not null,
    primary key (practice_id, predecessor_id),
    unique (practice_id, successor_id),
    check (predecessor_id <> successor_id),
    foreign key (practice_id, credential_id, predecessor_id)
    references public.credential_cycles (practice_id, credential_id, id) on delete restrict,
    foreign key (practice_id, credential_id, successor_id)
    references public.credential_cycles (practice_id, credential_id, id) on delete restrict
);
create table private.renewal_completion_requests (
    practice_id uuid not null,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    request_id uuid not null,
    credential_id uuid not null,
    predecessor_id uuid not null,
    successor_id uuid not null,
    payload jsonb not null,
    result jsonb not null,
    created_at timestamptz not null default clock_timestamp(),
    primary key (practice_id, actor_user_id, request_id),
    foreign key (practice_id, credential_id, predecessor_id)
    references public.credential_cycles (practice_id, credential_id, id) on delete restrict,
    foreign key (practice_id, credential_id, successor_id)
    references public.credential_cycles (practice_id, credential_id, id) on delete restrict,
    check (predecessor_id <> successor_id)
);
create index renewal_completion_actor_idx on private.credential_renewal_completions (actor_user_id);
create index renewal_completion_credential_idx on private.credential_renewal_completions (
    practice_id, credential_id
);
create index renewal_completion_request_actor_idx on private.renewal_completion_requests (
    actor_user_id
);
create index renewal_completion_request_predecessor_idx on private.renewal_completion_requests (
    practice_id, credential_id, predecessor_id
);
create index renewal_completion_request_successor_idx on private.renewal_completion_requests (
    practice_id, credential_id, successor_id
);
alter table private.credential_renewal_completions enable row level security;
alter table private.renewal_completion_requests enable row level security;
revoke all on private.credential_renewal_completions, private.renewal_completion_requests
from public, anon, authenticated, service_role;
alter table private.renewal_audit_events drop constraint renewal_audit_events_operation_check,
add constraint renewal_audit_events_operation_check check (
    operation in ('link-changed', 'progress-changed', 'review-acknowledged', 'renewal-confirmed')
);

create function private.renewal_cycle_history(p_cycle public.credential_cycles, p_type text)
returns jsonb language sql stable security invoker set search_path = '' as $$
    select pg_catalog.jsonb_build_object(
        'id', p_cycle.id, 'cycleNumber', p_cycle.cycle_number, 'dateRevision', p_cycle.date_revision,
        'type', coalesce(done.before_data->>'type', p_type),
        'endDate', pg_catalog.to_char(p_cycle.end_date, 'YYYY-MM-DD'),
        'actionDeadline', pg_catalog.to_char(p_cycle.action_deadline, 'YYYY-MM-DD'),
        'completedAt', p_cycle.completed_at, 'successorId', done.successor_id,
        'progress', coalesce(done.before_data->'renewal'->'workflow'->>'status', work.status, 'not-started'),
        'acknowledgedAt', coalesce(done.before_data->'renewal'->'workflow'->>'acknowledgedAt', pg_catalog.to_jsonb(work.acknowledged_at) #>> '{}')
    ) from (select 1) base
    left join private.credential_renewal_completions done
        on done.practice_id = p_cycle.practice_id and done.predecessor_id = p_cycle.id
    left join private.credential_renewal_workflows work
        on work.practice_id = p_cycle.practice_id and work.cycle_id = p_cycle.id;
$$;
revoke all on function private.renewal_cycle_history(public.credential_cycles, text)
from public, anon, authenticated, service_role;

create function private.complete_credential_renewal(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid, p_expected_date_revision integer, p_expected_renewal_version integer,
    p_end_date text, p_action_deadline text, p_confirmed boolean
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare credential public.credentials; cycle public.credential_cycles; successor public.credential_cycles;
    receipt private.renewal_completion_requests; entered_end date; entered_action date;
    payload jsonb; current_data jsonb; before_data jsonb; after_data jsonb; result jsonb;
    occurred timestamptz; today date; zone text; completed_data jsonb;
begin
    perform private.require_register_member(p_practice_id, true);
    if p_confirmed is distinct from true or p_request_id is null or p_credential_id is null
        or p_expected_cycle_id is null or p_expected_version is null or p_expected_version < 1
        or p_expected_date_revision is null or p_expected_date_revision < 1
        or p_expected_renewal_version is null or p_expected_renewal_version < 1 then
        return '{"status":"invalid"}'::jsonb;
    end if;
    begin entered_end := private.credential_date(p_end_date);
    exception when datetime_field_overflow or invalid_datetime_format then
        return '{"status":"invalid","errors":{"endDate":"Enter a valid date (YYYY-MM-DD)."}}'::jsonb;
    end;
    begin entered_action := private.credential_date(p_action_deadline);
    exception when datetime_field_overflow or invalid_datetime_format then
        return '{"status":"invalid","errors":{"actionDeadline":"Enter a valid date (YYYY-MM-DD)."}}'::jsonb;
    end;
    payload := pg_catalog.jsonb_build_object('credentialId', p_credential_id, 'expectedVersion', p_expected_version,
        'expectedCycleId', p_expected_cycle_id, 'expectedDateRevision', p_expected_date_revision,
        'expectedRenewalVersion', p_expected_renewal_version, 'endDate', entered_end,
        'actionDeadline', entered_action, 'confirmed', p_confirmed);
    select * into receipt from private.renewal_completion_requests
    where practice_id = p_practice_id and actor_user_id = auth.uid() and request_id = p_request_id;
    if found then
        if receipt.payload <> payload then return '{"status":"request-conflict"}'::jsonb; end if;
        return receipt.result;
    end if;
    select * into credential from public.credentials where practice_id = p_practice_id and id = p_credential_id;
    if not found then return '{"status":"not-found"}'::jsonb; end if;
    cycle := private.current_credential_cycle(p_practice_id, credential.id);
    if credential.archived_at is not null then return '{"status":"archived"}'::jsonb; end if;
    if cycle.completed_at is not null then return '{"status":"completed"}'::jsonb; end if;
    current_data := private.credential_maintenance_projection(credential)
        || pg_catalog.jsonb_build_object('renewal', private.renewal_projection(credential));
    if credential.version <> p_expected_version or cycle.id <> p_expected_cycle_id
        or cycle.date_revision <> p_expected_date_revision
        or (current_data->'renewal'->'workflow'->>'version')::integer <> p_expected_renewal_version
        or credential.version = 2147483647 or cycle.cycle_number = 2147483647 then
        return pg_catalog.jsonb_build_object('status', 'conflict', 'credential', current_data);
    end if;
    occurred := private.renewal_completion_clock();
    select timezone into zone from public.practices where id = p_practice_id;
    today := (occurred at time zone zone)::date;
    if entered_end is null or entered_end <= today then
        return '{"status":"invalid","errors":{"endDate":"Enter an end date after today in the practice timezone."}}'::jsonb;
    end if;
    if entered_action is not null and entered_action <= today then
        return '{"status":"invalid","errors":{"actionDeadline":"Enter an action deadline after today in the practice timezone."}}'::jsonb;
    end if;
    if entered_action is not null and entered_action >= entered_end then
        return '{"status":"invalid","errors":{"actionDeadline":"The action deadline must be earlier than the end date."}}'::jsonb;
    end if;
    before_data := current_data;
    update public.credential_cycles set completed_at = occurred, updated_at = occurred
    where practice_id = p_practice_id and id = cycle.id returning * into cycle;
    insert into public.credential_cycles (practice_id, credential_id, cycle_number, date_revision,
        end_date, action_deadline, created_at, updated_at)
    values (p_practice_id, credential.id, cycle.cycle_number + 1, 1, entered_end, entered_action, occurred, occurred)
    returning * into successor;
    update public.credentials set version = version + 1, updated_at = occurred
    where practice_id = p_practice_id and id = credential.id returning * into credential;
    after_data := private.credential_maintenance_projection(credential)
        || pg_catalog.jsonb_build_object('renewal', private.renewal_projection(credential));
    insert into private.credential_renewal_completions
        (practice_id, credential_id, predecessor_id, successor_id, actor_user_id, completed_at, before_data, after_data)
    values (p_practice_id, credential.id, cycle.id, successor.id, auth.uid(), occurred, before_data, after_data);
    completed_data := private.renewal_cycle_history(cycle, credential.type);
    insert into private.renewal_audit_events (practice_id, actor_user_id, credential_id, cycle_id,
        operation, before_data, after_data, occurred_at)
    values (p_practice_id, auth.uid(), credential.id, cycle.id, 'renewal-confirmed', before_data,
        pg_catalog.jsonb_build_object('completedCycle', completed_data, 'credential', after_data), occurred);
    result := pg_catalog.jsonb_build_object('status', 'success', 'changed', true,
        'completedCycle', completed_data, 'credential', after_data);
    insert into private.renewal_completion_requests (practice_id, actor_user_id, request_id,
        credential_id, predecessor_id, successor_id, payload, result, created_at)
    values (p_practice_id, auth.uid(), p_request_id, credential.id, cycle.id, successor.id, payload, result, occurred);
    return result;
end;
$$;
create function public.complete_credential_renewal(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid, p_expected_date_revision integer, p_expected_renewal_version integer,
    p_end_date text, p_action_deadline text, p_confirmed boolean
) returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.complete_credential_renewal(p_practice_id, p_request_id, p_credential_id,
        p_expected_version, p_expected_cycle_id, p_expected_date_revision, p_expected_renewal_version,
        p_end_date, p_action_deadline, p_confirmed);
$$;
create function private.get_credential_renewal_history(
    p_practice_id uuid, p_credential_id uuid, p_before_cycle_number integer
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare credential public.credentials; cycle public.credential_cycles; items jsonb; next_cursor integer;
begin
    perform private.require_register_member(p_practice_id, false);
    if p_credential_id is null or (p_before_cycle_number is not null and p_before_cycle_number < 1) then
        return '{"status":"invalid"}'::jsonb;
    end if;
    select * into credential from public.credentials where practice_id = p_practice_id and id = p_credential_id;
    if not found then return '{"status":"not-found"}'::jsonb; end if;
    cycle := private.current_credential_cycle(p_practice_id, credential.id);
    with page as (
        select cy.*, row_number() over (order by cycle_number desc) position
        from public.credential_cycles cy where practice_id = p_practice_id and credential_id = credential.id
            and (p_before_cycle_number is null or cycle_number < p_before_cycle_number)
        order by cycle_number desc limit 21
    ) select coalesce(jsonb_agg(private.renewal_cycle_history(cy, credential.type) order by cy.cycle_number desc)
            filter (where page.position <= 20), '[]'::jsonb),
        case when count(*) > 20 then min(page.cycle_number) filter (where page.position <= 20) end
    into items, next_cursor from page
    join public.credential_cycles cy on cy.id = page.id and cy.practice_id = p_practice_id;
    return pg_catalog.jsonb_build_object('status', 'success', 'credentialId', credential.id,
        'title', credential.title, 'archivedAt', credential.archived_at, 'currentCycleId', cycle.id,
        'cycles', items, 'nextBeforeCycleNumber', next_cursor);
end;
$$;
create function public.get_credential_renewal_history(
    p_practice_id uuid, p_credential_id uuid, p_before_cycle_number integer
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.get_credential_renewal_history(p_practice_id, p_credential_id, p_before_cycle_number);
$$;
revoke all on function private.complete_credential_renewal(
    uuid, uuid, uuid, integer, uuid, integer, integer, text, text, boolean
),
public.complete_credential_renewal(
    uuid, uuid, uuid, integer, uuid, integer, integer, text, text, boolean
),
private.get_credential_renewal_history(uuid, uuid, integer),
public.get_credential_renewal_history(uuid, uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function private.complete_credential_renewal(
    uuid, uuid, uuid, integer, uuid, integer, integer, text, text, boolean
),
public.complete_credential_renewal(
    uuid, uuid, uuid, integer, uuid, integer, integer, text, text, boolean
),
private.get_credential_renewal_history(uuid, uuid, integer),
public.get_credential_renewal_history(uuid, uuid, integer)
to authenticated;
