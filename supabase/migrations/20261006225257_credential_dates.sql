-- Business dates are supplied by the practice; no regulatory dates are inferred.
alter table public.credentials
add column issuer text constraint credentials_issuer_check check (
    issuer is null
    or (issuer = private.register_name(issuer) and char_length(issuer) between 1 and 120)
),
add column jurisdiction text constraint credentials_jurisdiction_check check (
    jurisdiction is null
    or (
        jurisdiction = private.register_name(jurisdiction)
        and char_length(jurisdiction) between 1 and 120
    )
);

create table public.credential_cycles (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null references public.practices (id) on delete restrict,
    credential_id uuid not null,
    cycle_number integer not null default 1 check (cycle_number > 0),
    date_revision integer not null default 1 check (date_revision > 0),
    end_date date constraint credential_cycles_end_date_check check (
        end_date is null or end_date between date '0001-01-01' and date '9999-12-31'
    ),
    action_deadline date constraint credential_cycles_action_deadline_check check (
        action_deadline is null or action_deadline between date '0001-01-01' and date '9999-12-31'
    ),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    unique (practice_id, id),
    unique (practice_id, credential_id, cycle_number),
    constraint credential_cycles_credential_fkey foreign key (practice_id, credential_id)
    references public.credentials (practice_id, id) on delete restrict,
    constraint credential_cycles_order_check check (
        end_date is null or action_deadline is null or action_deadline < end_date
    )
);
create index credential_cycles_credential_idx on public.credential_cycles (
    practice_id, credential_id
);
alter table public.credential_cycles enable row level security;
revoke all on public.credential_cycles from public, anon, authenticated;
grant select on public.credential_cycles to authenticated;
create policy credential_cycles_select on public.credential_cycles for select to authenticated
using (practice_id = (select private.current_practice_id()));

-- Preserve all original credential values and immutable historical audit/receipt rows.
insert into public.credential_cycles (practice_id, credential_id)
select
    practice_id,
    id
from public.credentials;

create function private.initialize_credential_cycle() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
    insert into public.credential_cycles (practice_id, credential_id) values (new.practice_id, new.id);
    return new;
end;
$$;
revoke all on function private.initialize_credential_cycle() from public, anon, authenticated;
create trigger initialize_credential_cycle after insert on public.credentials
for each row execute function private.initialize_credential_cycle();

create function private.credential_date(p_value text) returns date
language plpgsql immutable security invoker set search_path = '' as $$
begin
    if p_value is null or p_value = '' then return null; end if;
    if char_length(p_value) <> 10 or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or substring(p_value from 1 for 4)::integer = 0 then
        raise exception 'invalid credential date' using errcode = '22008';
    end if;
    return pg_catalog.make_date(substring(p_value from 1 for 4)::integer,
        substring(p_value from 6 for 2)::integer, substring(p_value from 9 for 2)::integer);
end;
$$;
revoke all on function private.credential_date(text) from public, anon, authenticated;

create function private.credential_details_projection(p_record public.credentials) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
    cycle public.credential_cycles;
begin
    select * into cycle from public.credential_cycles
    where practice_id = p_record.practice_id and credential_id = p_record.id and cycle_number = 1;
    if not found then raise exception 'missing credential cycle'; end if;
    return private.credential_projection(p_record) || pg_catalog.jsonb_build_object(
        'issuer', p_record.issuer, 'jurisdiction', p_record.jurisdiction,
        'current_cycle', pg_catalog.jsonb_build_object('id', cycle.id,
            'cycle_number', cycle.cycle_number, 'date_revision', cycle.date_revision,
            'end_date', pg_catalog.to_char(cycle.end_date, 'YYYY-MM-DD'),
            'action_deadline', pg_catalog.to_char(cycle.action_deadline, 'YYYY-MM-DD')));
end;
$$;
revoke all on function private.credential_details_projection(public.credentials) from public,
anon,
authenticated;

create or replace function private.list_practice_register(p_practice_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform private.require_register_member(p_practice_id, false);
    return pg_catalog.jsonb_build_object(
        'clinicians', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', id, 'name', name, 'version', version) order by created_at, id)
            from public.clinicians where practice_id = p_practice_id
        ), '[]'::jsonb),
        'credentials', coalesce((
            select pg_catalog.jsonb_agg(private.credential_details_projection(c) order by c.created_at, c.id)
            from public.credentials c where c.practice_id = p_practice_id
        ), '[]'::jsonb));
end;
$$;

create function private.create_practice_credential_with_details(
    p_practice_id uuid, p_request_id uuid, p_title text, p_type text, p_owner_kind text,
    p_owner_clinician_id uuid, p_covered_clinician_ids uuid[],
    p_issuer text, p_jurisdiction text, p_end_date text, p_action_deadline text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    normalized text;
    issuer text;
    jurisdiction text;
    entered_end_date date;
    entered_action_deadline date;
    covered uuid[] := coalesce(p_covered_clinician_ids, '{}'::uuid[]);
    payload jsonb;
    result jsonb;
    credential public.credentials;
begin
    perform private.require_register_member(p_practice_id, true);
    normalized := private.register_name(p_title);
    issuer := nullif(private.register_name(p_issuer), '');
    jurisdiction := nullif(private.register_name(p_jurisdiction), '');
    if p_request_id is null or normalized is null or char_length(normalized) not between 1 and 120
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
    result := private.register_replay(p_practice_id, p_request_id, 'credential-created', payload);
    if result is not null then return result; end if;
    if (p_owner_clinician_id is not null and not exists (
        select 1 from public.clinicians where practice_id = p_practice_id and id = p_owner_clinician_id
    )) or exists (
        select 1 from unnest(covered) x where not exists (
            select 1 from public.clinicians where practice_id = p_practice_id and id = x
        )
    ) then return '{"status":"invalid-reference"}'::jsonb; end if;
    insert into public.credentials (practice_id, title, type, owner_kind, owner_clinician_id, issuer, jurisdiction)
    values (p_practice_id, normalized, p_type, p_owner_kind, p_owner_clinician_id, issuer, jurisdiction)
    returning * into credential;
    insert into public.policy_coverage (practice_id, credential_id, clinician_id)
    select p_practice_id, credential.id, x from unnest(covered) x;
    update public.credential_cycles cy set end_date = entered_end_date,
        action_deadline = entered_action_deadline,
        updated_at = pg_catalog.clock_timestamp()
    where cy.practice_id = p_practice_id and cy.credential_id = credential.id and cy.cycle_number = 1;
    result := pg_catalog.jsonb_build_object('status', 'success', 'credential',
        private.credential_details_projection(credential));
    return private.finish_register_create(p_practice_id, p_request_id, 'credential-created', payload,
        null, credential.id, result);
end;
$$;

create function public.create_practice_credential_with_details(
    p_practice_id uuid, p_request_id uuid, p_title text, p_type text, p_owner_kind text,
    p_owner_clinician_id uuid, p_covered_clinician_ids uuid[],
    p_issuer text, p_jurisdiction text, p_end_date text, p_action_deadline text
) returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.create_practice_credential_with_details(p_practice_id, p_request_id, p_title,
        p_type, p_owner_kind, p_owner_clinician_id, p_covered_clinician_ids,
        p_issuer, p_jurisdiction, p_end_date, p_action_deadline);
$$;
revoke all on function public.create_practice_credential_with_details(
    uuid, uuid, text, text, text, uuid, uuid[], text, text, text, text
),
private.create_practice_credential_with_details(
    uuid, uuid, text, text, text, uuid, uuid[], text, text, text, text
)
from public, anon, authenticated;
grant execute on function public.create_practice_credential_with_details(
    uuid, uuid, text, text, text, uuid, uuid[], text, text, text, text
),
private.create_practice_credential_with_details(
    uuid, uuid, text, text, text, uuid, uuid[], text, text, text, text
)
to authenticated;
