-- Progress is separate from business dates and notification eligibility.
create function private.renewal_url(p_value text) returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare normalized text; parts text[]; hostname text; suffix text; label text;
begin
    normalized := nullif(private.register_name(p_value), '');
    if normalized is null then return null; end if;
    parts := pg_catalog.regexp_match(normalized, '^https://([^/?#]+)(.*)$', 'i');
    if char_length(normalized) > 2048 or parts is null then
        raise exception 'invalid renewal URL' using errcode = '22023';
    end if;
    hostname := parts[1]; suffix := parts[2];
    if char_length(hostname) > 253
        or hostname !~ '^[a-zA-Z0-9-]+([.][a-zA-Z0-9-]+)+$'
        or hostname ~* '[.]([0-9]+|0x[0-9a-f]+)$'
        or suffix !~ '^([a-zA-Z0-9._~!$&()*+,;=:@/?#-]|%[0-9a-fA-F]{2})*$'
        or char_length(suffix) - char_length(pg_catalog.replace(suffix, '#', '')) > 1 then
        raise exception 'invalid renewal URL' using errcode = '22023';
    end if;
    foreach label in array pg_catalog.string_to_array(hostname, '.') loop
        if char_length(label) > 63 or label !~ '^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$' then
            raise exception 'invalid renewal URL' using errcode = '22023';
        end if;
    end loop;
    return 'https://' || pg_catalog.substring(normalized, 9);
end;
$$;
revoke all on function private.renewal_url(text) from public, anon, authenticated, service_role;

create table private.credential_renewal_links (
    practice_id uuid not null,
    credential_id uuid not null,
    url text check (url is null or coalesce(url = private.renewal_url(url), false)),
    version integer not null check (version > 0),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    primary key (practice_id, credential_id),
    constraint renewal_link_credential_fkey foreign key (practice_id, credential_id)
    references public.credentials (practice_id, id) on delete restrict
);
create table private.credential_renewal_workflows (
    practice_id uuid not null,
    cycle_id uuid not null,
    status text not null check (status in ('not-started', 'in-progress', 'awaiting-approval')),
    version integer not null check (version > 0),
    acknowledged_at timestamptz,
    acknowledged_by uuid references auth.users (id) on delete restrict,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    primary key (practice_id, cycle_id),
    constraint renewal_workflow_cycle_fkey foreign key (practice_id, cycle_id)
    references public.credential_cycles (practice_id, id) on delete restrict,
    constraint renewal_review_shape check ((acknowledged_at is null) = (acknowledged_by is null))
);
create table private.renewal_change_requests (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    request_id uuid not null,
    credential_id uuid not null,
    cycle_id uuid not null,
    intent text not null check (intent in ('link', 'progress', 'review')),
    payload jsonb not null,
    result jsonb not null,
    created_at timestamptz not null default clock_timestamp(),
    unique (practice_id, actor_user_id, request_id),
    constraint renewal_request_cycle_fkey foreign key (practice_id, credential_id, cycle_id)
    references public.credential_cycles (practice_id, credential_id, id) on delete restrict
);
create table private.renewal_audit_events (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    credential_id uuid not null,
    cycle_id uuid not null,
    operation text not null check (
        operation in ('link-changed', 'progress-changed', 'review-acknowledged')
    ),
    before_data jsonb not null,
    after_data jsonb not null,
    occurred_at timestamptz not null default clock_timestamp(),
    constraint renewal_audit_cycle_fkey foreign key (practice_id, credential_id, cycle_id)
    references public.credential_cycles (practice_id, credential_id, id) on delete restrict
);
create index renewal_link_credential_idx on private.credential_renewal_links (credential_id);
create index renewal_workflow_cycle_idx on private.credential_renewal_workflows (cycle_id);
create index renewal_workflow_actor_idx on private.credential_renewal_workflows (acknowledged_by);
create index renewal_request_actor_idx on private.renewal_change_requests (actor_user_id);
create index renewal_request_cycle_idx on private.renewal_change_requests (
    practice_id, credential_id, cycle_id
);
create index renewal_audit_actor_idx on private.renewal_audit_events (actor_user_id);
create index renewal_audit_cycle_idx on private.renewal_audit_events (
    practice_id, credential_id, cycle_id
);
alter table private.credential_renewal_links enable row level security;
alter table private.credential_renewal_workflows enable row level security;
alter table private.renewal_change_requests enable row level security;
alter table private.renewal_audit_events enable row level security;
revoke all on private.credential_renewal_links, private.credential_renewal_workflows,
private.renewal_change_requests,
private.renewal_audit_events from public,
anon,
authenticated,
service_role;

create function private.renewal_projection(p_record public.credentials) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare cycle public.credential_cycles; link private.credential_renewal_links;
    workflow private.credential_renewal_workflows;
begin
    select * into cycle from public.credential_cycles
    where practice_id = p_record.practice_id and credential_id = p_record.id and cycle_number = 1;
    if not found then raise exception 'missing credential cycle'; end if;
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
revoke all on function private.renewal_projection(public.credentials) from public,
anon,
authenticated,
service_role;

create function private.list_practice_register_with_renewal(
    p_practice_id uuid, p_include_archived boolean
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb; records jsonb;
begin
    perform private.require_register_member(p_practice_id, false);
    if p_include_archived is null then return '{"status":"invalid"}'::jsonb; end if;
    result := private.list_practice_register_with_maintenance(p_practice_id, p_include_archived);
    select coalesce(pg_catalog.jsonb_agg(item.value || pg_catalog.jsonb_build_object(
        'renewal', private.renewal_projection(c)) order by item.position), '[]'::jsonb) into records
    from pg_catalog.jsonb_array_elements(result->'credentials') with ordinality item(value, position)
    join public.credentials c on c.id = (item.value->>'id')::uuid and c.practice_id = p_practice_id;
    return pg_catalog.jsonb_set(result, '{credentials}', records);
end;
$$;
create function public.list_practice_register_with_renewal(
    p_practice_id uuid, p_include_archived boolean
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.list_practice_register_with_renewal(p_practice_id, p_include_archived);
$$;

-- Only checked entry points can invoke this transactional helper.
create function private.apply_renewal_change(
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
    select * into cycle from public.credential_cycles
    where practice_id = p_practice_id and credential_id = credential.id and cycle_number = 1;
    if not found then raise exception 'missing credential cycle'; end if;
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
revoke all on function private.apply_renewal_change(
    uuid, uuid, uuid, integer, uuid, integer, integer, text, text
)
from public, anon, authenticated, service_role;

create function private.set_credential_renewal_link(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid,
    p_expected_date_revision integer,
    p_expected_renewal_version integer,
    p_url text
) returns jsonb language sql volatile security definer set search_path = '' as $$
    select private.apply_renewal_change(p_practice_id, p_request_id, p_credential_id, p_expected_version,
        p_expected_cycle_id, p_expected_date_revision, p_expected_renewal_version, 'link', p_url);
$$;
create function public.set_credential_renewal_link(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid,
    p_expected_date_revision integer,
    p_expected_renewal_version integer,
    p_url text
) returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.set_credential_renewal_link(p_practice_id, p_request_id, p_credential_id, p_expected_version,
        p_expected_cycle_id, p_expected_date_revision, p_expected_renewal_version, p_url);
$$;
create function private.set_credential_renewal_progress(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid,
    p_expected_date_revision integer,
    p_expected_renewal_version integer,
    p_status text
) returns jsonb language sql volatile security definer set search_path = '' as $$
    select private.apply_renewal_change(p_practice_id, p_request_id, p_credential_id, p_expected_version,
        p_expected_cycle_id, p_expected_date_revision, p_expected_renewal_version, 'progress', p_status);
$$;
create function public.set_credential_renewal_progress(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid,
    p_expected_date_revision integer,
    p_expected_renewal_version integer,
    p_status text
) returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.set_credential_renewal_progress(p_practice_id, p_request_id, p_credential_id, p_expected_version,
        p_expected_cycle_id, p_expected_date_revision, p_expected_renewal_version, p_status);
$$;
create function private.acknowledge_credential_renewal(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid, p_expected_date_revision integer, p_expected_renewal_version integer
) returns jsonb language sql volatile security definer set search_path = '' as $$
    select private.apply_renewal_change(p_practice_id, p_request_id, p_credential_id, p_expected_version,
        p_expected_cycle_id, p_expected_date_revision, p_expected_renewal_version, 'review', null);
$$;
create function public.acknowledge_credential_renewal(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid, p_expected_date_revision integer, p_expected_renewal_version integer
) returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.acknowledge_credential_renewal(p_practice_id, p_request_id, p_credential_id, p_expected_version,
        p_expected_cycle_id, p_expected_date_revision, p_expected_renewal_version);
$$;
revoke all on function public.list_practice_register_with_renewal(uuid, boolean),
private.list_practice_register_with_renewal(uuid, boolean),
public.set_credential_renewal_link(uuid, uuid, uuid, integer, uuid, integer, integer, text),
private.set_credential_renewal_link(uuid, uuid, uuid, integer, uuid, integer, integer, text),
public.set_credential_renewal_progress(uuid, uuid, uuid, integer, uuid, integer, integer, text),
private.set_credential_renewal_progress(uuid, uuid, uuid, integer, uuid, integer, integer, text),
public.acknowledge_credential_renewal(uuid, uuid, uuid, integer, uuid, integer, integer),
private.acknowledge_credential_renewal(uuid, uuid, uuid, integer, uuid, integer, integer)
from public, anon, authenticated, service_role;
grant execute on function public.list_practice_register_with_renewal(uuid, boolean),
private.list_practice_register_with_renewal(uuid, boolean),
public.set_credential_renewal_link(uuid, uuid, uuid, integer, uuid, integer, integer, text),
private.set_credential_renewal_link(uuid, uuid, uuid, integer, uuid, integer, integer, text),
public.set_credential_renewal_progress(uuid, uuid, uuid, integer, uuid, integer, integer, text),
private.set_credential_renewal_progress(uuid, uuid, uuid, integer, uuid, integer, integer, text),
public.acknowledge_credential_renewal(uuid, uuid, uuid, integer, uuid, integer, integer),
private.acknowledge_credential_renewal(uuid, uuid, uuid, integer, uuid, integer, integer)
to authenticated;
