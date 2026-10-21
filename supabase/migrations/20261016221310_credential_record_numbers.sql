-- Issuer numbers are credential metadata; internal IDs and scheduling stay separate.
alter table public.credentials add column record_number text
constraint credentials_record_number_check check (
    record_number is null or (
        record_number = private.register_name(record_number)
        and char_length(record_number) between 1 and 120
        and record_number !~ U&'[\0001-\001F\007F-\009F]'
    )
);

create function private.credential_record_number(p_value text) returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare normalized text := nullif(private.register_name(p_value), '');
begin
    if normalized is not null and (char_length(normalized) > 120
        or normalized ~ U&'[\0001-\001F\007F-\009F]') then
        raise exception 'invalid record number' using errcode = '22023';
    end if;
    return normalized;
end;
$$;
revoke all on function private.credential_record_number(text)
from public, anon, authenticated, service_role;

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
        'record_number', p_record.record_number,
        'current_cycle', pg_catalog.jsonb_build_object('id', cycle.id,
            'cycle_number', cycle.cycle_number, 'date_revision', cycle.date_revision,
            'end_date', pg_catalog.to_char(cycle.end_date, 'YYYY-MM-DD'),
            'action_deadline', pg_catalog.to_char(cycle.action_deadline, 'YYYY-MM-DD')));
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
    next_record_number text;
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
        next_record_number := case when p_values ? 'record_number' then p_values->>'record_number'
            when credential.type is distinct from p_values->>'type' then null
            else credential.record_number end;
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
            or old_covered is distinct from covered
            or credential.record_number is distinct from next_record_number;
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
                record_number = next_record_number,
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

create function private.create_practice_credential_with_number(
    p_practice_id uuid, p_request_id uuid, p_title text, p_type text, p_owner_kind text,
    p_owner_clinician_id uuid, p_covered_clinician_ids uuid[],
    p_issuer text,
    p_jurisdiction text,
    p_end_date text,
    p_action_deadline text,
    p_record_number text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare values_json jsonb; normalized_number text; result jsonb;
    credential public.credentials; covered uuid[];
begin
    perform private.require_register_member(p_practice_id, true);
    if p_request_id is null then return '{"status":"invalid"}'::jsonb; end if;
    values_json := private.credential_change_values(p_title, p_type, p_owner_kind,
        p_owner_clinician_id, p_covered_clinician_ids, p_issuer, p_jurisdiction,
        p_end_date, p_action_deadline);
    if values_json ? 'status' then return values_json; end if;
    begin normalized_number := private.credential_record_number(p_record_number);
    exception when invalid_parameter_value then
        return '{"status":"invalid","errors":{"recordNumber":"Use up to 120 characters without control characters."}}'::jsonb;
    end;
    values_json := values_json || pg_catalog.jsonb_build_object(
        'contract_version', 3, 'record_number', normalized_number);
    result := private.register_replay(p_practice_id, p_request_id, 'credential-created', values_json);
    if result is not null then return result; end if;
    select coalesce(array_agg(x::uuid order by x::uuid), '{}'::uuid[]) into covered
    from pg_catalog.jsonb_array_elements_text(values_json->'covered_clinician_ids') x;
    if (p_owner_clinician_id is not null and not exists (
        select 1 from public.clinicians where practice_id = p_practice_id and id = p_owner_clinician_id
    )) or exists (select 1 from unnest(covered) x where not exists (
        select 1 from public.clinicians where practice_id = p_practice_id and id = x
    )) then return '{"status":"invalid-reference"}'::jsonb; end if;
    insert into public.credentials (practice_id, title, type, owner_kind, owner_clinician_id,
        issuer, jurisdiction, record_number)
    values (p_practice_id, values_json->>'title', p_type, p_owner_kind, p_owner_clinician_id,
        values_json->>'issuer', values_json->>'jurisdiction', normalized_number)
    returning * into credential;
    insert into public.policy_coverage (practice_id, credential_id, clinician_id)
    select p_practice_id, credential.id, x from unnest(covered) x;
    update public.credential_cycles set end_date = (values_json->>'end_date')::date,
        action_deadline = (values_json->>'action_deadline')::date,
        updated_at = pg_catalog.clock_timestamp()
    where practice_id = p_practice_id and credential_id = credential.id and cycle_number = 1;
    result := pg_catalog.jsonb_build_object('status', 'success', 'credential',
        private.credential_details_projection(credential));
    return private.finish_register_create(p_practice_id, p_request_id, 'credential-created',
        values_json, null, credential.id, result);
end;
$$;
create function public.create_practice_credential_with_number(
    p_practice_id uuid, p_request_id uuid, p_title text, p_type text, p_owner_kind text,
    p_owner_clinician_id uuid, p_covered_clinician_ids uuid[],
    p_issuer text,
    p_jurisdiction text,
    p_end_date text,
    p_action_deadline text,
    p_record_number text
) returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.create_practice_credential_with_number(p_practice_id, p_request_id, p_title,
        p_type, p_owner_kind, p_owner_clinician_id, p_covered_clinician_ids, p_issuer, p_jurisdiction,
        p_end_date, p_action_deadline, p_record_number);
$$;

create function private.update_practice_credential_with_number(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid, p_expected_date_revision integer,
    p_title text, p_type text, p_owner_kind text, p_owner_clinician_id uuid,
    p_covered_clinician_ids uuid[], p_issuer text, p_jurisdiction text,
    p_end_date text, p_action_deadline text, p_record_number text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare values_json jsonb; normalized_number text;
begin
    perform private.require_register_member(p_practice_id, true);
    values_json := private.credential_change_values(p_title, p_type, p_owner_kind,
        p_owner_clinician_id, p_covered_clinician_ids, p_issuer, p_jurisdiction,
        p_end_date, p_action_deadline);
    if values_json ? 'status' then return values_json; end if;
    begin normalized_number := private.credential_record_number(p_record_number);
    exception when invalid_parameter_value then
        return '{"status":"invalid","errors":{"recordNumber":"Use up to 120 characters without control characters."}}'::jsonb;
    end;
    values_json := values_json || pg_catalog.jsonb_build_object(
        'contract_version', 3, 'record_number', normalized_number);
    return private.apply_credential_change(p_practice_id, p_request_id, p_credential_id,
        p_expected_version, p_expected_cycle_id, p_expected_date_revision, values_json);
end;
$$;
create function public.update_practice_credential_with_number(
    p_practice_id uuid, p_request_id uuid, p_credential_id uuid, p_expected_version integer,
    p_expected_cycle_id uuid, p_expected_date_revision integer,
    p_title text, p_type text, p_owner_kind text, p_owner_clinician_id uuid,
    p_covered_clinician_ids uuid[], p_issuer text, p_jurisdiction text,
    p_end_date text, p_action_deadline text, p_record_number text
) returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.update_practice_credential_with_number(p_practice_id, p_request_id,
        p_credential_id, p_expected_version, p_expected_cycle_id, p_expected_date_revision,
        p_title, p_type, p_owner_kind, p_owner_clinician_id, p_covered_clinician_ids,
        p_issuer, p_jurisdiction, p_end_date, p_action_deadline, p_record_number);
$$;
revoke all on function private.create_practice_credential_with_number(
    uuid, uuid, text, text, text, uuid, uuid[], text, text, text, text, text
)
from public, anon, authenticated, service_role;
grant execute on function private.create_practice_credential_with_number(
    uuid, uuid, text, text, text, uuid, uuid[], text, text, text, text, text
)
to authenticated;
revoke all on function public.create_practice_credential_with_number(
    uuid, uuid, text, text, text, uuid, uuid[], text, text, text, text, text
)
from public, anon, authenticated, service_role;
grant execute on function public.create_practice_credential_with_number(
    uuid, uuid, text, text, text, uuid, uuid[], text, text, text, text, text
)
to authenticated;
revoke all on function private.update_practice_credential_with_number(
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
    text,
    text
)
from public, anon, authenticated, service_role;
grant execute on function private.update_practice_credential_with_number(
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
    text,
    text
)
to authenticated;
revoke all on function public.update_practice_credential_with_number(
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
    text,
    text
)
from public, anon, authenticated, service_role;
grant execute on function public.update_practice_credential_with_number(
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
    text,
    text
)
to authenticated;
