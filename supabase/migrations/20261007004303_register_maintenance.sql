-- Archive is retained inventory; future calendar and dispatch reads must exclude it.
alter table public.credentials add column archived_at timestamptz;
create index credentials_active_practice_idx on public.credentials (
    practice_id,
    created_at,
    id
)
where archived_at is null;

create table private.register_change_requests (
    id uuid primary key default gen_random_uuid(),

    practice_id uuid not null references public.practices (id) on delete restrict,

    actor_user_id uuid not null references auth.users (id) on delete restrict,

    request_id uuid not null,

    credential_id uuid not null,

    operation text not null check (operation in (
        'credential-updated',
        'credential-archived'
    )),

    payload jsonb not null,

    result jsonb not null,

    created_at timestamptz not null default clock_timestamp(),

    unique (
        practice_id,
        actor_user_id,
        request_id
    ),

    constraint register_change_credential_fkey foreign key (
        practice_id,
        credential_id
    )
    references public.credentials (
        practice_id,
        id
    ) on delete restrict
);
create index register_change_actor_idx on private.register_change_requests (actor_user_id);
create index register_change_credential_idx on private.register_change_requests (
    practice_id,
    credential_id
);
alter table private.register_change_requests enable row level security;
revoke all on private.register_change_requests from public,
anon,
authenticated;

alter table private.register_audit_events
drop constraint register_audit_events_operation_check,

drop constraint register_audit_events_before_data_check,

drop constraint register_audit_events_check,

add constraint register_audit_events_operation_check check (
    operation in (
        'clinician-created',
        'credential-created',
        'credential-updated',
        'credential-archived'
    )
),

add constraint register_audit_events_before_data_check check (
    (operation in (
        'clinician-created',
        'credential-created'
    ) and before_data is null)
    or (operation in (
        'credential-updated',
        'credential-archived'
    ) and before_data is not null)
),

add constraint register_audit_events_check check (
    (operation = 'clinician-created' and clinician_id is not null and credential_id is null)
    or (operation in (
        'credential-created',
        'credential-updated',
        'credential-archived'
    )
    and credential_id is not null and clinician_id is null)
);

create function private.credential_maintenance_projection(p_record public.credentials) returns jsonb
language sql stable security invoker set search_path = '' as $$
    select private.credential_details_projection(p_record)
        || pg_catalog.jsonb_build_object('archived_at', p_record.archived_at);
$$;
create function private.duplicate_text(p_value text) returns text
language sql immutable security invoker set search_path = '' as $$
    select pg_catalog.translate(private.register_name(p_value),
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
$$;
create function private.credential_duplicate_ids(p_record public.credentials) returns jsonb
language sql stable security invoker set search_path = '' as $$
    select coalesce(pg_catalog.jsonb_agg(c.id order by c.id), '[]'::jsonb)
    from public.credentials c
    where p_record.archived_at is null and c.archived_at is null
        and c.practice_id = p_record.practice_id and c.id <> p_record.id
        and c.type = p_record.type and c.owner_kind = p_record.owner_kind
        and c.owner_clinician_id is not distinct from p_record.owner_clinician_id
        and private.duplicate_text(c.title) = private.duplicate_text(p_record.title)
        and private.duplicate_text(c.issuer) is not distinct from private.duplicate_text(p_record.issuer)
        and private.duplicate_text(c.jurisdiction) is not distinct from private.duplicate_text(p_record.jurisdiction);
$$;

create or replace function private.list_practice_register(p_practice_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform private.require_register_member(p_practice_id, false);
    return pg_catalog.jsonb_build_object(
        'clinicians', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', id, 'name', name, 'version', version) order by created_at, id)
            from public.clinicians where practice_id = p_practice_id), '[]'::jsonb),
        'credentials', coalesce((select pg_catalog.jsonb_agg(
            private.credential_details_projection(c) order by c.created_at, c.id)
            from public.credentials c where c.practice_id = p_practice_id and c.archived_at is null), '[]'::jsonb));
end;
$$;
create function private.list_practice_register_with_maintenance(
    p_practice_id uuid,
    p_include_archived boolean
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
    perform private.require_register_member(p_practice_id, false);
    if p_include_archived is null then return '{"status":"invalid"}'::jsonb; end if;
    return pg_catalog.jsonb_build_object(
        'clinicians', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', id, 'name', name, 'version', version) order by created_at, id)
            from public.clinicians where practice_id = p_practice_id), '[]'::jsonb),
        'credentials', coalesce((select pg_catalog.jsonb_agg(
            private.credential_maintenance_projection(c) || pg_catalog.jsonb_build_object(
                'suspected_duplicate_ids', private.credential_duplicate_ids(c)) order by c.created_at, c.id)
            from public.credentials c where c.practice_id = p_practice_id
                and (p_include_archived or c.archived_at is null)), '[]'::jsonb));
end;
$$;
create function public.list_practice_register_with_maintenance(
    p_practice_id uuid,
    p_include_archived boolean
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.list_practice_register_with_maintenance(p_practice_id, p_include_archived);
$$;

-- Utilities are callable only from checked entries after the live practice lock.
create function private.credential_change_values(
    p_title text,
    p_type text,
    p_owner_kind text,
    p_owner_clinician_id uuid,
    p_covered_clinician_ids uuid[],
    p_issuer text,
    p_jurisdiction text,
    p_end_date text,
    p_action_deadline text
) returns jsonb
language plpgsql immutable security invoker set search_path = '' as $$
declare
    normalized text;
    issuer text;
    jurisdiction text;
    entered_end_date date;
    entered_action_deadline date;
    covered uuid[] := coalesce(p_covered_clinician_ids, '{}'::uuid[]);
    payload jsonb;
begin
    normalized := private.register_name(p_title);
    issuer := nullif(private.register_name(p_issuer), '');
    jurisdiction := nullif(private.register_name(p_jurisdiction), '');
    if normalized is null or char_length(normalized) not between 1 and 120
       or p_type is null or p_type not in ('state_license', 'dea_registration', 'malpractice_policy')
       or p_owner_kind is null or p_owner_kind not in ('clinician', 'practice')
       or (p_owner_kind = 'clinician' and p_owner_clinician_id is null)
       or (p_owner_kind = 'practice' and p_owner_clinician_id is not null)
       or coalesce(array_ndims(covered), 1) <> 1 then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if array_position(covered, null) is not null
       or cardinality(covered) <> (select count(distinct c) from unnest(covered) c)
       or (cardinality(covered) > 0 and (p_type <> 'malpractice_policy' or p_owner_kind <> 'practice')) then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if issuer is not null and char_length(issuer) > 120 then
        return '{"status":"invalid","errors":{"issuer":"Use 1 to 120 characters."}}'::jsonb;
    end if;
    if jurisdiction is not null and char_length(jurisdiction) > 120 then
        return '{"status":"invalid","errors":{"jurisdiction":"Use 1 to 120 characters."}}'::jsonb;
    end if;
    begin
        entered_end_date := private.credential_date(p_end_date);
    exception when datetime_field_overflow or invalid_datetime_format then
        return '{"status":"invalid","errors":{"endDate":"Enter a valid date (YYYY-MM-DD)."}}'::jsonb;
    end;
    begin
        entered_action_deadline := private.credential_date(p_action_deadline);
    exception when datetime_field_overflow or invalid_datetime_format then
        return '{"status":"invalid","errors":{"actionDeadline":"Enter a valid date (YYYY-MM-DD)."}}'::jsonb;
    end;
    if entered_end_date is not null and entered_action_deadline is not null and entered_action_deadline >= entered_end_date then
        return '{"status":"invalid","errors":{"actionDeadline":"The action deadline must be earlier than the end date."}}'::jsonb;
    end if;
    select coalesce(array_agg(c order by c), '{}'::uuid[]) into covered from unnest(covered) c;
    payload := pg_catalog.jsonb_build_object('title', normalized, 'type', p_type,
        'owner_kind', p_owner_kind, 'owner_clinician_id', p_owner_clinician_id,
        'covered_clinician_ids', covered, 'contract_version', 2, 'issuer', issuer,
        'jurisdiction', jurisdiction, 'end_date', pg_catalog.to_char(entered_end_date, 'YYYY-MM-DD'),
        'action_deadline', pg_catalog.to_char(entered_action_deadline, 'YYYY-MM-DD'));
    return payload;
end;
$$;

create function private.register_change_replay(
    p_practice_id uuid,
    p_request_id uuid,
    p_operation text,
    p_payload jsonb
)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare receipt private.register_change_requests;
begin
    select * into receipt from private.register_change_requests
    where practice_id = p_practice_id and actor_user_id = auth.uid() and request_id = p_request_id;
    if not found then return null; end if;
    if receipt.operation <> p_operation or receipt.payload <> p_payload then
        return '{"status":"request-conflict"}'::jsonb;
    end if;
    return receipt.result;
end;
$$;
create function private.finish_register_change(
    p_practice_id uuid,
    p_request_id uuid,
    p_credential_id uuid,
    p_operation text,

    p_payload jsonb,
    p_before jsonb,
    p_result jsonb
) returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
begin
    if (p_result->>'changed')::boolean then
        insert into private.register_audit_events
            (practice_id, actor_user_id, operation, credential_id, before_data, after_data)
        values (p_practice_id, auth.uid(), p_operation, p_credential_id, p_before, p_result->'credential');
    end if;
    insert into private.register_change_requests
        (practice_id, actor_user_id, request_id, credential_id, operation, payload, result)
    values (p_practice_id, auth.uid(), p_request_id, p_credential_id, p_operation, p_payload, p_result);
    return p_result;
end;
$$;
create function private.apply_credential_change(
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
    return private.finish_register_change(p_practice_id, p_request_id, credential.id, operation,
        payload, before_data, result);
end;
$$;

create function private.update_practice_credential(
    p_practice_id uuid,
    p_request_id uuid,
    p_credential_id uuid,
    p_expected_version integer,
    p_expected_cycle_id uuid,
    p_expected_date_revision integer,
    p_title text,
    p_type text,
    p_owner_kind text,
    p_owner_clinician_id uuid,
    p_covered_clinician_ids uuid[],
    p_issuer text,
    p_jurisdiction text,
    p_end_date text,
    p_action_deadline text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform private.require_register_member(p_practice_id, true);
    return private.apply_credential_change(p_practice_id, p_request_id, p_credential_id, p_expected_version, p_expected_cycle_id, p_expected_date_revision, private.credential_change_values(p_title, p_type, p_owner_kind, p_owner_clinician_id, p_covered_clinician_ids, p_issuer, p_jurisdiction, p_end_date, p_action_deadline));
end;
$$;
create function public.update_practice_credential(
    p_practice_id uuid,
    p_request_id uuid,
    p_credential_id uuid,
    p_expected_version integer,
    p_expected_cycle_id uuid,
    p_expected_date_revision integer,
    p_title text,
    p_type text,
    p_owner_kind text,
    p_owner_clinician_id uuid,
    p_covered_clinician_ids uuid[],
    p_issuer text,
    p_jurisdiction text,
    p_end_date text,
    p_action_deadline text
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.update_practice_credential(p_practice_id, p_request_id, p_credential_id, p_expected_version, p_expected_cycle_id, p_expected_date_revision, p_title, p_type, p_owner_kind, p_owner_clinician_id, p_covered_clinician_ids, p_issuer, p_jurisdiction, p_end_date, p_action_deadline);
$$;

create function private.archive_practice_credential(
    p_practice_id uuid,
    p_request_id uuid,
    p_credential_id uuid,
    p_expected_version integer,
    p_expected_cycle_id uuid,
    p_expected_date_revision integer
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform private.require_register_member(p_practice_id, true);
    return private.apply_credential_change(p_practice_id, p_request_id, p_credential_id, p_expected_version, p_expected_cycle_id, p_expected_date_revision, null);
end;
$$;
create function public.archive_practice_credential(
    p_practice_id uuid,
    p_request_id uuid,
    p_credential_id uuid,
    p_expected_version integer,
    p_expected_cycle_id uuid,
    p_expected_date_revision integer
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.archive_practice_credential(p_practice_id, p_request_id, p_credential_id, p_expected_version, p_expected_cycle_id, p_expected_date_revision);
$$;
revoke all on function private.credential_maintenance_projection(public.credentials) from public,
anon,
authenticated;
revoke all on function private.duplicate_text(text) from public,
anon,
authenticated;
revoke all on function private.credential_duplicate_ids(public.credentials) from public,
anon,
authenticated;
revoke all on function private.list_practice_register_with_maintenance(
    uuid,
    boolean
) from public,
anon,
authenticated;
grant execute on function private.list_practice_register_with_maintenance(
    uuid,
    boolean
) to authenticated;
revoke all on function public.list_practice_register_with_maintenance(
    uuid,
    boolean
) from public,
anon,
authenticated;
grant execute on function public.list_practice_register_with_maintenance(
    uuid,
    boolean
) to authenticated;
revoke all on function private.credential_change_values(
    text,
    text,
    text,
    uuid,
    uuid[],
    text,
    text,
    text,
    text
) from public,
anon,
authenticated;
revoke all on function private.register_change_replay(
    uuid,
    uuid,
    text,
    jsonb
) from public,
anon,
authenticated;
revoke all on function private.finish_register_change(
    uuid,
    uuid,
    uuid,
    text,
    jsonb,
    jsonb,
    jsonb
) from public,
anon,
authenticated;
revoke all on function private.apply_credential_change(
    uuid,
    uuid,
    uuid,
    integer,
    uuid,
    integer,
    jsonb
) from public,
anon,
authenticated;
revoke all on function private.update_practice_credential(
    uuid,
    uuid,
    uuid,
    integer,
    uuid,
    integer,
    text,
    text,
    text,
    uuid,
    uuid[],
    text,
    text,
    text,
    text
) from public,
anon,
authenticated;
grant execute on function private.update_practice_credential(
    uuid,
    uuid,
    uuid,
    integer,
    uuid,
    integer,
    text,
    text,
    text,
    uuid,
    uuid[],
    text,
    text,
    text,
    text
) to authenticated;
revoke all on function public.update_practice_credential(
    uuid,
    uuid,
    uuid,
    integer,
    uuid,
    integer,
    text,
    text,
    text,
    uuid,
    uuid[],
    text,
    text,
    text,
    text
) from public,
anon,
authenticated;
grant execute on function public.update_practice_credential(
    uuid,
    uuid,
    uuid,
    integer,
    uuid,
    integer,
    text,
    text,
    text,
    uuid,
    uuid[],
    text,
    text,
    text,
    text
) to authenticated;
revoke all on function private.archive_practice_credential(
    uuid,
    uuid,
    uuid,
    integer,
    uuid,
    integer
) from public,
anon,
authenticated;
grant execute on function private.archive_practice_credential(
    uuid,
    uuid,
    uuid,
    integer,
    uuid,
    integer
) to authenticated;
revoke all on function public.archive_practice_credential(
    uuid,
    uuid,
    uuid,
    integer,
    uuid,
    integer
) from public,
anon,
authenticated;
grant execute on function public.archive_practice_credential(
    uuid,
    uuid,
    uuid,
    integer,
    uuid,
    integer
) to authenticated;
