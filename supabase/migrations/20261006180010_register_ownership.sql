create function private.register_name(p_value text) returns text
language sql immutable security invoker set search_path = '' as $$
    select pg_catalog.btrim(p_value,
        U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
revoke all on function private.register_name(text) from public, anon, authenticated;

create table public.clinicians (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null references public.practices (id) on delete restrict,
    name text not null check (
        name = private.register_name(name) and char_length(name) between 1 and 120
    ),
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    unique (practice_id, id)
);
create table public.credentials (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null references public.practices (id) on delete restrict,
    title text not null check (
        title = private.register_name(title) and char_length(title) between 1 and 120
    ),
    type text not null check (type in ('state_license', 'dea_registration', 'malpractice_policy')),
    owner_kind text not null check (owner_kind in ('clinician', 'practice')),
    owner_clinician_id uuid,
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    unique (practice_id, id),
    unique (practice_id, id, type, owner_kind),
    constraint credentials_owner_shape check (
        (owner_kind = 'clinician' and owner_clinician_id is not null)
        or (owner_kind = 'practice' and owner_clinician_id is null)
    ),
    constraint credentials_owner_fkey foreign key (practice_id, owner_clinician_id)
    references public.clinicians (practice_id, id) on delete restrict
);
create table public.policy_coverage (
    practice_id uuid not null references public.practices (id) on delete restrict,
    credential_id uuid not null,
    clinician_id uuid not null,
    type text not null default 'malpractice_policy' check (type = 'malpractice_policy'),
    owner_kind text not null default 'practice' check (owner_kind = 'practice'),
    primary key (practice_id, credential_id, clinician_id),
    constraint policy_coverage_credential_fkey foreign key (
        practice_id, credential_id, type, owner_kind
    )
    references public.credentials (practice_id, id, type, owner_kind) on delete restrict,
    constraint policy_coverage_clinician_fkey foreign key (practice_id, clinician_id)
    references public.clinicians (practice_id, id) on delete restrict
);
create index clinicians_practice_idx on public.clinicians (practice_id, created_at, id);
create index credentials_practice_idx on public.credentials (practice_id, created_at, id);
create index credentials_owner_idx on public.credentials (practice_id, owner_clinician_id);
create index policy_coverage_clinician_idx on public.policy_coverage (practice_id, clinician_id);

create table private.register_create_requests (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null references public.practices (id) on delete restrict,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    request_id uuid not null,
    operation text not null check (operation in ('clinician-created', 'credential-created')),
    payload jsonb not null,
    result jsonb not null,
    created_at timestamptz not null default clock_timestamp(),
    unique (practice_id, actor_user_id, request_id)
);
create index register_create_requests_actor_idx on private.register_create_requests (actor_user_id);
create table private.register_audit_events (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null references public.practices (id) on delete restrict,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    operation text not null check (operation in ('clinician-created', 'credential-created')),
    clinician_id uuid,
    credential_id uuid,
    before_data jsonb check (before_data is null),
    after_data jsonb not null,
    occurred_at timestamptz not null default clock_timestamp(),
    check (
        (operation = 'clinician-created' and clinician_id is not null and credential_id is null)
        or (operation = 'credential-created' and credential_id is not null and clinician_id is null)
    ),
    constraint register_audit_clinician_fkey foreign key (practice_id, clinician_id)
    references public.clinicians (practice_id, id) on delete restrict,
    constraint register_audit_credential_fkey foreign key (practice_id, credential_id)
    references public.credentials (practice_id, id) on delete restrict
);
create index register_audit_practice_idx on private.register_audit_events (practice_id);
create index register_audit_actor_idx on private.register_audit_events (actor_user_id);
create index register_audit_clinician_idx on private.register_audit_events (
    practice_id, clinician_id
);
create index register_audit_credential_idx on private.register_audit_events (
    practice_id, credential_id
);

alter table public.clinicians enable row level security;
alter table public.credentials enable row level security;
alter table public.policy_coverage enable row level security;
alter table private.register_create_requests enable row level security;
alter table private.register_audit_events enable row level security;
revoke all on public.clinicians, public.credentials, public.policy_coverage,
private.register_create_requests, private.register_audit_events from public, anon, authenticated;
grant select on public.clinicians, public.credentials, public.policy_coverage to authenticated;
create policy clinicians_select on public.clinicians for select to authenticated
using (practice_id = (select private.current_practice_id()));
create policy credentials_select on public.credentials for select to authenticated
using (practice_id = (select private.current_practice_id()));
create policy policy_coverage_select on public.policy_coverage for select to authenticated
using (practice_id = (select private.current_practice_id()));

create function private.require_register_member(p_practice_id uuid, p_edit boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
    actor_role text;
begin
    perform 1 from public.practices where id = p_practice_id for update;
    select role into actor_role from public.practice_memberships
    where practice_id = p_practice_id and user_id = auth.uid() and state = 'active';
    if p_edit is null or actor_role is null
       or (p_edit and actor_role not in ('administrator', 'manager')) then
        raise exception 'forbidden' using errcode = '42501';
    end if;
end;
$$;

create function private.credential_projection(p_record public.credentials) returns jsonb
language sql stable security invoker set search_path = '' as $$
    select pg_catalog.jsonb_build_object(
        'id', p_record.id, 'title', p_record.title, 'type', p_record.type,
        'owner_kind', p_record.owner_kind, 'owner_clinician_id', p_record.owner_clinician_id,
        'version', p_record.version,
        'owner_name', case when p_record.owner_kind = 'practice' then
            (select name from public.practices where id = p_record.practice_id)
            else (select name from public.clinicians
                  where practice_id = p_record.practice_id and id = p_record.owner_clinician_id) end,
        'covered_clinicians', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'name', c.name)
                order by c.id)
            from public.policy_coverage pc join public.clinicians c
                on c.practice_id = pc.practice_id and c.id = pc.clinician_id
            where pc.practice_id = p_record.practice_id and pc.credential_id = p_record.id
        ), '[]'::jsonb));
$$;

create function private.register_replay(
    p_practice_id uuid, p_request_id uuid, p_operation text, p_payload jsonb
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
    receipt private.register_create_requests;
begin
    select * into receipt from private.register_create_requests
    where practice_id = p_practice_id and actor_user_id = auth.uid() and request_id = p_request_id;
    if not found then return null; end if;
    if receipt.operation <> p_operation or receipt.payload <> p_payload then
        return '{"status":"request-conflict"}'::jsonb;
    end if;
    return receipt.result;
end;
$$;

-- Called only by checked entry implementations while holding the practice lock.
create function private.finish_register_create(
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
    return p_result;
end;
$$;
revoke all on function private.require_register_member(uuid, boolean),
private.credential_projection(public.credentials), private.register_replay(uuid, uuid, text, jsonb),
private.finish_register_create(uuid, uuid, text, jsonb, uuid, uuid, jsonb)
from public, anon, authenticated;

create function private.list_practice_register(p_practice_id uuid) returns jsonb
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
            select pg_catalog.jsonb_agg(private.credential_projection(c) order by c.created_at, c.id)
            from public.credentials c where c.practice_id = p_practice_id
        ), '[]'::jsonb));
end;
$$;

create function private.create_practice_clinician(
    p_practice_id uuid, p_request_id uuid, p_name text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    normalized text;
    payload jsonb;
    result jsonb;
    clinician public.clinicians;
begin
    perform private.require_register_member(p_practice_id, true);
    normalized := private.register_name(p_name);
    if p_request_id is null or normalized is null or char_length(normalized) not between 1 and 120 then
        return '{"status":"invalid"}'::jsonb;
    end if;
    payload := pg_catalog.jsonb_build_object('name', normalized);
    result := private.register_replay(p_practice_id, p_request_id, 'clinician-created', payload);
    if result is not null then return result; end if;
    insert into public.clinicians (practice_id, name) values (p_practice_id, normalized)
    returning * into clinician;
    result := pg_catalog.jsonb_build_object('status', 'success', 'clinician',
        pg_catalog.jsonb_build_object('id', clinician.id, 'name', clinician.name,
            'version', clinician.version));
    return private.finish_register_create(p_practice_id, p_request_id, 'clinician-created', payload,
        clinician.id, null, result);
end;
$$;

create function private.create_practice_credential(
    p_practice_id uuid, p_request_id uuid, p_title text, p_type text, p_owner_kind text,
    p_owner_clinician_id uuid, p_covered_clinician_ids uuid[]
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    normalized text;
    covered uuid[] := coalesce(p_covered_clinician_ids, '{}'::uuid[]);
    payload jsonb;
    result jsonb;
    credential public.credentials;
begin
    perform private.require_register_member(p_practice_id, true);
    normalized := private.register_name(p_title);
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
    select coalesce(array_agg(c order by c), '{}'::uuid[]) into covered from unnest(covered) c;
    payload := pg_catalog.jsonb_build_object('title', normalized, 'type', p_type,
        'owner_kind', p_owner_kind, 'owner_clinician_id', p_owner_clinician_id,
        'covered_clinician_ids', covered);
    result := private.register_replay(p_practice_id, p_request_id, 'credential-created', payload);
    if result is not null then return result; end if;
    if (p_owner_clinician_id is not null and not exists (
        select 1 from public.clinicians where practice_id = p_practice_id and id = p_owner_clinician_id
    )) or exists (
        select 1 from unnest(covered) x where not exists (
            select 1 from public.clinicians where practice_id = p_practice_id and id = x
        )
    ) then return '{"status":"invalid-reference"}'::jsonb; end if;
    insert into public.credentials (practice_id, title, type, owner_kind, owner_clinician_id)
    values (p_practice_id, normalized, p_type, p_owner_kind, p_owner_clinician_id)
    returning * into credential;
    insert into public.policy_coverage (practice_id, credential_id, clinician_id)
    select p_practice_id, credential.id, x from unnest(covered) x;
    result := pg_catalog.jsonb_build_object('status', 'success', 'credential',
        private.credential_projection(credential));
    return private.finish_register_create(p_practice_id, p_request_id, 'credential-created', payload,
        null, credential.id, result);
end;
$$;

create function public.list_practice_register(p_practice_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.list_practice_register(p_practice_id);
$$;
create function public.create_practice_clinician(
    p_practice_id uuid, p_request_id uuid, p_name text
) returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.create_practice_clinician(p_practice_id, p_request_id, p_name);
$$;
create function public.create_practice_credential(
    p_practice_id uuid, p_request_id uuid, p_title text, p_type text, p_owner_kind text,
    p_owner_clinician_id uuid, p_covered_clinician_ids uuid[]
) returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.create_practice_credential(p_practice_id, p_request_id, p_title, p_type,
        p_owner_kind, p_owner_clinician_id, p_covered_clinician_ids);
$$;
revoke all on function public.list_practice_register(uuid), private.list_practice_register(uuid),
public.create_practice_clinician(uuid, uuid, text),
private.create_practice_clinician(uuid, uuid, text),
public.create_practice_credential(uuid, uuid, text, text, text, uuid, uuid[]),
private.create_practice_credential(uuid, uuid, text, text, text, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.list_practice_register(uuid), private.list_practice_register(uuid),
public.create_practice_clinician(uuid, uuid, text),
private.create_practice_clinician(uuid, uuid, text),
public.create_practice_credential(uuid, uuid, text, text, text, uuid, uuid[]),
private.create_practice_credential(uuid, uuid, text, text, text, uuid, uuid[])
to authenticated;
