-- Metadata and object bytes have separate, recoverable lifecycles.
create table private.renewal_evidence (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    credential_id uuid not null,
    cycle_id uuid not null,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    request_id uuid not null,
    filename text,
    mime text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
    file_extension text not null check (file_extension in ('pdf', 'jpg', 'png')),
    byte_count integer not null check (byte_count between 1 and 3145728),
    digest text not null check (digest ~ '^[a-f0-9]{64}$'),
    state text not null default 'pending' check (
        state in ('pending', 'available', 'deleting', 'deleted', 'abandoned')
    ),
    version integer not null default 1 check (version > 0),
    charged boolean not null default true,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    unique (practice_id, credential_id, cycle_id, id),
    unique (practice_id, id),
    unique (practice_id, actor_user_id, request_id),
    foreign key (practice_id, credential_id, cycle_id)
    references public.credential_cycles (practice_id, credential_id, id) on delete restrict,
    check (filename is null or (
        char_length(filename) between 1 and 120
        and filename !~ '[[:cntrl:]/\\]'
    )),
    check (filename is not null or state in ('deleted', 'abandoned')),
    check (
        (mime = 'application/pdf' and file_extension = 'pdf')
        or (mime = 'image/jpeg' and file_extension = 'jpg')
        or (mime = 'image/png' and file_extension = 'png')
    )
);
create index renewal_evidence_cycle_idx on private.renewal_evidence (
    practice_id, credential_id, cycle_id, created_at, id
);
create index renewal_evidence_actor_idx on private.renewal_evidence (actor_user_id);

create table private.renewal_evidence_requests (
    practice_id uuid not null,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    request_id uuid not null,
    evidence_id uuid not null,
    operation text not null check (operation in ('upload', 'remove')),
    payload jsonb not null,
    result jsonb not null,
    created_at timestamptz not null default clock_timestamp(),
    primary key (practice_id, actor_user_id, request_id),
    foreign key (practice_id, evidence_id) references private.renewal_evidence (
        practice_id, id
    ) on delete restrict
);
create index renewal_evidence_request_file_idx on private.renewal_evidence_requests (evidence_id);
create index renewal_evidence_request_actor_idx on private.renewal_evidence_requests (
    actor_user_id
);

-- One immutable physical path per attachment. Retry leases reuse that path;
-- upsert is forbidden, so an uncertain upload cannot replace existing bytes.
create table private.renewal_evidence_objects (
    id uuid primary key default gen_random_uuid(),
    evidence_id uuid not null unique references private.renewal_evidence (id) on delete restrict,
    object_path text not null unique,
    state text not null default 'pending' check (
        state in ('pending', 'verified', 'purging', 'purged')
    ),
    claim_token uuid,
    claim_until timestamptz,
    next_check_at timestamptz not null default clock_timestamp(),
    failures integer not null default 0 check (failures between 0 and 16),
    updated_at timestamptz not null default clock_timestamp(),
    check ((claim_token is null) = (claim_until is null))
);
create index renewal_evidence_cleanup_idx on private.renewal_evidence_objects (next_check_at, id);

create table private.renewal_evidence_audit_events (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    credential_id uuid not null,
    cycle_id uuid not null,
    evidence_id uuid not null,
    actor_user_id uuid references auth.users (id) on delete restrict,
    operation text not null check (operation in (
        'reserved', 'uploaded', 'download-authorized',
        'download-failed', 'delete-requested', 'purge-completed', 'abandoned'
    )),
    occurred_at timestamptz not null default clock_timestamp(),
    foreign key (practice_id, credential_id, cycle_id, evidence_id)
    references private.renewal_evidence (
        practice_id, credential_id, cycle_id, id
    ) on delete restrict
);
create index renewal_evidence_audit_file_idx on private.renewal_evidence_audit_events (
    practice_id, evidence_id, occurred_at, id
);
create index renewal_evidence_audit_actor_idx on private.renewal_evidence_audit_events (
    actor_user_id
);
alter table private.renewal_evidence enable row level security;
alter table private.renewal_evidence_requests enable row level security;
alter table private.renewal_evidence_objects enable row level security;
alter table private.renewal_evidence_audit_events enable row level security;
revoke all on private.renewal_evidence, private.renewal_evidence_requests,
private.renewal_evidence_objects,
private.renewal_evidence_audit_events from public,
anon,
authenticated,
service_role;

create policy renewal_evidence_gateway_only on storage.objects as restrictive
for all to anon, authenticated using (bucket_id <> 'renewal-evidence')
with check (bucket_id <> 'renewal-evidence');

create function private.require_evidence_actor(p_practice_id uuid, p_actor_id uuid, p_edit boolean)
returns void language plpgsql volatile security invoker set search_path = '' as $$
declare actor_role text;
begin
    perform 1 from public.practices where id = p_practice_id for update;
    select role into actor_role from public.practice_memberships
    where practice_id = p_practice_id and user_id = p_actor_id and state = 'active';
    if p_edit is null or actor_role is null or (p_edit and actor_role not in ('administrator', 'manager')) then
        raise exception 'forbidden' using errcode = '42501';
    end if;
end;
$$;
create function private.evidence_event(
    p_record private.renewal_evidence, p_actor_id uuid, p_operation text
)
returns uuid language plpgsql volatile security invoker set search_path = '' as $$
declare result uuid;
begin
    insert into private.renewal_evidence_audit_events (practice_id, credential_id, cycle_id,
        evidence_id, actor_user_id, operation)
    values (p_record.practice_id, p_record.credential_id, p_record.cycle_id, p_record.id, p_actor_id, p_operation)
    returning id into result;
    return result;
end;
$$;
create function private.evidence_projection(p_record private.renewal_evidence, p_actor_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
    select jsonb_build_object('id', p_record.id, 'filename', p_record.filename,
        'mime', p_record.mime, 'byteCount', p_record.byte_count, 'state', p_record.state,
        'version', p_record.version, 'createdAt', p_record.created_at,
        'requestId', case when p_record.state = 'pending' and p_record.actor_user_id = p_actor_id
            then p_record.request_id else null end);
$$;
revoke all on function private.require_evidence_actor(uuid, uuid, boolean),
private.evidence_event(private.renewal_evidence, uuid, text),
private.evidence_projection(private.renewal_evidence, uuid) from public,
anon,
authenticated,
service_role;

create function private.get_renewal_evidence(
    p_practice_id uuid, p_credential_id uuid, p_cycle_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare credential public.credentials; cycle public.credential_cycles; files jsonb; notices jsonb;
begin
    perform private.require_register_member(p_practice_id, false);
    select * into credential from public.credentials where practice_id = p_practice_id and id = p_credential_id;
    select * into cycle from public.credential_cycles where practice_id = p_practice_id
        and credential_id = p_credential_id and id = p_cycle_id;
    if credential.id is null or cycle.id is null then return '{"status":"not-found"}'::jsonb; end if;
    select coalesce(jsonb_agg(private.evidence_projection(e, auth.uid()) order by e.created_at, e.id), '[]')
    into files from (select * from private.renewal_evidence where practice_id = p_practice_id
        and credential_id = p_credential_id and cycle_id = p_cycle_id and state in ('pending', 'available')
        order by created_at, id limit 20) e;
    select coalesce(jsonb_agg(private.evidence_projection(e, auth.uid()) order by e.updated_at desc, e.id), '[]')
    into notices from (select * from private.renewal_evidence where practice_id = p_practice_id
        and credential_id = p_credential_id and cycle_id = p_cycle_id and state in ('deleting', 'deleted', 'abandoned')
        order by updated_at desc, id limit 20) e;
    return jsonb_build_object('status', 'success', 'credentialId', credential.id,
        'cycleId', cycle.id, 'title', credential.title, 'archivedAt', credential.archived_at,
        'current', cycle.id = (private.current_credential_cycle(p_practice_id, p_credential_id)).id,
        'cycle', private.renewal_cycle_history(cycle, credential.type), 'files', files, 'notices', notices);
end;
$$;

create function private.reserve_renewal_evidence(
    p_practice_id uuid, p_credential_id uuid,
    p_cycle_id uuid,
    p_request_id uuid,
    p_filename text,
    p_mime text,
    p_byte_count integer,
    p_digest text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare credential public.credentials; evidence private.renewal_evidence;
    receipt private.renewal_evidence_requests; payload jsonb; result jsonb; file_extension text;
begin
    perform private.require_register_member(p_practice_id, true);
    if p_request_id is null or p_filename is null or char_length(p_filename) not between 1 and 120
        or p_filename ~ '[[:cntrl:]/\\]' or p_byte_count is null or p_byte_count not between 1 and 3145728
        or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or p_mime is null then
        return '{"status":"invalid"}'::jsonb;
    end if;
    file_extension := case when p_mime = 'application/pdf' and lower(p_filename) ~ '\.pdf$' then 'pdf'
        when p_mime = 'image/jpeg' and lower(p_filename) ~ '\.jpe?g$' then 'jpg'
        when p_mime = 'image/png' and lower(p_filename) ~ '\.png$' then 'png' else null end;
    if file_extension is null then return '{"status":"invalid"}'::jsonb; end if;
    payload := jsonb_build_object('credentialId', p_credential_id, 'cycleId', p_cycle_id,
        'nameHash', encode(sha256(convert_to(p_filename, 'UTF8')), 'hex'),
        'mime', p_mime, 'byteCount', p_byte_count, 'digest', p_digest);
    select * into receipt from private.renewal_evidence_requests where practice_id = p_practice_id
        and actor_user_id = auth.uid() and request_id = p_request_id;
    if found then
        if receipt.operation <> 'upload' or receipt.payload <> payload then return '{"status":"request-conflict"}'::jsonb; end if;
        select * into evidence from private.renewal_evidence where id = receipt.evidence_id;
        return jsonb_build_object('status', 'success', 'evidenceId', evidence.id, 'state', evidence.state);
    end if;
    select * into credential from public.credentials where practice_id = p_practice_id and id = p_credential_id;
    if not found or not exists (select 1 from public.credential_cycles where practice_id = p_practice_id
        and credential_id = p_credential_id and id = p_cycle_id) then return '{"status":"not-found"}'::jsonb; end if;
    if credential.archived_at is not null then return '{"status":"archived"}'::jsonb; end if;
    if (select count(*) from private.renewal_evidence where practice_id = p_practice_id
        and cycle_id = p_cycle_id and state in ('pending', 'available')) >= 20
        or (select coalesce(sum(byte_count), 0) from private.renewal_evidence
            where practice_id = p_practice_id and charged) + p_byte_count > 104857600 then
        return '{"status":"quota"}'::jsonb;
    end if;
    insert into private.renewal_evidence (practice_id, credential_id, cycle_id, actor_user_id,
        request_id, filename, mime, file_extension, byte_count, digest)
    values (p_practice_id, p_credential_id, p_cycle_id, auth.uid(), p_request_id,
        p_filename, p_mime, file_extension, p_byte_count, p_digest) returning * into evidence;
    result := jsonb_build_object('status', 'success', 'evidenceId', evidence.id, 'state', evidence.state);
    insert into private.renewal_evidence_requests (practice_id, actor_user_id, request_id, evidence_id, operation, payload, result)
    values (p_practice_id, auth.uid(), p_request_id, evidence.id, 'upload', payload, result);
    perform private.evidence_event(evidence, auth.uid(), 'reserved');
    return result;
end;
$$;

create function private.claim_renewal_evidence_upload(
    p_practice_id uuid, p_actor_id uuid, p_evidence_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare evidence private.renewal_evidence; object private.renewal_evidence_objects; token uuid; object_id uuid;
begin
    perform private.require_evidence_actor(p_practice_id, p_actor_id, true);
    select * into evidence from private.renewal_evidence where practice_id = p_practice_id and id = p_evidence_id;
    if not found or evidence.actor_user_id <> p_actor_id then return '{"status":"not-found"}'::jsonb; end if;
    if evidence.state <> 'pending' then return jsonb_build_object('status', evidence.state); end if;
    if exists (select 1 from public.credentials where practice_id = p_practice_id
        and id = evidence.credential_id and archived_at is not null) then return '{"status":"archived"}'::jsonb; end if;
    select * into object from private.renewal_evidence_objects where evidence_id = evidence.id;
    if object.claim_until > clock_timestamp() then return '{"status":"busy"}'::jsonb; end if;
    if object.id is null then
        object_id := gen_random_uuid();
        insert into private.renewal_evidence_objects (id, evidence_id, object_path)
        values (object_id, evidence.id, evidence.practice_id::text || '/' || evidence.credential_id::text
            || '/' || evidence.cycle_id::text || '/' || evidence.id::text || '/' || object_id::text || '.' || evidence.file_extension)
        returning * into object;
    end if;
    token := gen_random_uuid();
    update private.renewal_evidence_objects set claim_token = token,
        claim_until = clock_timestamp() + interval '120 seconds', updated_at = clock_timestamp()
    where id = object.id returning * into object;
    return jsonb_build_object('status', 'upload', 'evidenceId', evidence.id, 'objectId', object.id,
        'token', token, 'path', object.object_path, 'mime', evidence.mime, 'byteCount', evidence.byte_count, 'digest', evidence.digest);
end;
$$;

create function private.finalize_renewal_evidence_upload(
    p_practice_id uuid, p_actor_id uuid,
    p_evidence_id uuid, p_token uuid, p_byte_count integer, p_digest text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare evidence private.renewal_evidence; object private.renewal_evidence_objects;
begin
    perform private.require_evidence_actor(p_practice_id, p_actor_id, true);
    select * into evidence from private.renewal_evidence where practice_id = p_practice_id and id = p_evidence_id;
    if not found or evidence.actor_user_id <> p_actor_id then return '{"status":"not-found"}'::jsonb; end if;
    if p_byte_count is distinct from evidence.byte_count or p_digest is distinct from evidence.digest then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if evidence.state = 'available' then return jsonb_build_object('status', 'success', 'evidenceId', evidence.id, 'state', 'available'); end if;
    if evidence.state <> 'pending' then return jsonb_build_object('status', evidence.state); end if;
    if exists (select 1 from public.credentials where practice_id = p_practice_id
        and id = evidence.credential_id and archived_at is not null) then return '{"status":"archived"}'::jsonb; end if;
    select * into object from private.renewal_evidence_objects where evidence_id = evidence.id;
    if p_token is null or object.claim_token is distinct from p_token or object.claim_until <= clock_timestamp()
        or object.claim_until is null or object.state <> 'pending' then return '{"status":"busy"}'::jsonb; end if;
    update private.renewal_evidence_objects set state = 'verified', claim_token = null,
        claim_until = null, updated_at = clock_timestamp() where id = object.id;
    update private.renewal_evidence set state = 'available', version = 2, updated_at = clock_timestamp()
    where id = evidence.id returning * into evidence;
    perform private.evidence_event(evidence, p_actor_id, 'uploaded');
    return jsonb_build_object('status', 'success', 'evidenceId', evidence.id, 'state', evidence.state);
end;
$$;

create function private.authorize_renewal_evidence_download(
    p_practice_id uuid, p_actor_id uuid,
    p_credential_id uuid, p_cycle_id uuid, p_evidence_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare evidence private.renewal_evidence; object private.renewal_evidence_objects; access_id uuid;
begin
    perform private.require_evidence_actor(p_practice_id, p_actor_id, false);
    select * into evidence from private.renewal_evidence where practice_id = p_practice_id
        and credential_id = p_credential_id and cycle_id = p_cycle_id and id = p_evidence_id and state = 'available';
    if not found then return '{"status":"not-found"}'::jsonb; end if;
    select * into object from private.renewal_evidence_objects where evidence_id = evidence.id and state = 'verified';
    if not found then return '{"status":"not-found"}'::jsonb; end if;
    access_id := private.evidence_event(evidence, p_actor_id, 'download-authorized');
    return jsonb_build_object('status', 'download', 'accessId', access_id, 'path', object.object_path,
        'filename', evidence.filename, 'mime', evidence.mime, 'byteCount', evidence.byte_count, 'digest', evidence.digest);
end;
$$;
create function private.record_renewal_evidence_download(p_access_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare access_event private.renewal_evidence_audit_events; evidence private.renewal_evidence;
begin
    select * into access_event from private.renewal_evidence_audit_events
    where id = p_access_id and operation = 'download-authorized';
    if not found then return false; end if;
    select * into evidence from private.renewal_evidence where id = access_event.evidence_id;
    perform 1 from public.practices where id = evidence.practice_id for update;
    perform private.evidence_event(evidence, access_event.actor_user_id, 'download-failed');
    return true;
end;
$$;

create function private.remove_renewal_evidence(
    p_practice_id uuid, p_credential_id uuid,
    p_cycle_id uuid,
    p_evidence_id uuid,
    p_request_id uuid,
    p_expected_version integer,
    p_confirmed boolean
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare evidence private.renewal_evidence; receipt private.renewal_evidence_requests; payload jsonb; result jsonb;
begin
    perform private.require_register_member(p_practice_id, true);
    if p_request_id is null or p_expected_version is null or p_expected_version < 1
        or p_confirmed is distinct from true then return '{"status":"invalid"}'::jsonb; end if;
    payload := jsonb_build_object('credentialId', p_credential_id, 'cycleId', p_cycle_id,
        'evidenceId', p_evidence_id, 'expectedVersion', p_expected_version, 'confirmed', true);
    select * into receipt from private.renewal_evidence_requests where practice_id = p_practice_id
        and actor_user_id = auth.uid() and request_id = p_request_id;
    if found then
        if receipt.operation <> 'remove' or receipt.payload <> payload then return '{"status":"request-conflict"}'::jsonb; end if;
        select * into evidence from private.renewal_evidence where id = receipt.evidence_id;
        return jsonb_build_object('status', 'success', 'evidenceId', evidence.id, 'state', evidence.state);
    end if;
    select * into evidence from private.renewal_evidence where practice_id = p_practice_id
        and credential_id = p_credential_id and cycle_id = p_cycle_id and id = p_evidence_id;
    if not found then return '{"status":"not-found"}'::jsonb; end if;
    if evidence.version <> p_expected_version or evidence.version = 2147483647
        or evidence.state not in ('pending', 'available') then return '{"status":"conflict"}'::jsonb; end if;
    update private.renewal_evidence set state = 'deleting', version = version + 1, updated_at = clock_timestamp()
    where id = evidence.id returning * into evidence;
    update private.renewal_evidence_objects set state = 'purging', next_check_at = clock_timestamp()
    where evidence_id = evidence.id;
    perform private.evidence_event(evidence, auth.uid(), 'delete-requested');
    result := jsonb_build_object('status', 'success', 'evidenceId', evidence.id, 'state', evidence.state);
    insert into private.renewal_evidence_requests (practice_id, actor_user_id, request_id, evidence_id, operation, payload, result)
    values (p_practice_id, auth.uid(), p_request_id, evidence.id, 'remove', payload, result);
    return result;
end;
$$;

create function private.claim_renewal_evidence_cleanup(p_evidence_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare evidence private.renewal_evidence; object private.renewal_evidence_objects;
    candidate record; result jsonb := '[]'::jsonb; token uuid;
begin
    for candidate in select e.id, e.practice_id from private.renewal_evidence e
        left join private.renewal_evidence_objects o on o.evidence_id = e.id
        where (p_evidence_id is null or e.id = p_evidence_id)
        and (o.id is not null or e.charged)
        and (o.claim_until is null or o.claim_until <= clock_timestamp())
        and (o.next_check_at is null or o.next_check_at <= clock_timestamp())
        and (e.state in ('deleting', 'deleted', 'abandoned') or (e.state = 'pending' and (
            e.created_at <= clock_timestamp() - interval '24 hours'
            or exists (select 1 from public.credentials c where c.id = e.credential_id and c.archived_at is not null)
            or not exists (select 1 from public.practice_memberships m where m.practice_id = e.practice_id
                and m.user_id = e.actor_user_id and m.state = 'active' and m.role in ('administrator', 'manager')))))
        order by coalesce(o.next_check_at, e.created_at), e.id limit 20
    loop
        perform 1 from public.practices where id = candidate.practice_id for update skip locked;
        if not found then continue; end if;
        select * into evidence from private.renewal_evidence where id = candidate.id;
        select * into object from private.renewal_evidence_objects where evidence_id = evidence.id;
        -- Recheck after lock wait: a successful finalize is never purged.
        if evidence.state = 'available' or object.claim_until > clock_timestamp() then continue; end if;
        if evidence.state = 'pending' and evidence.created_at > clock_timestamp() - interval '24 hours'
            and not exists (select 1 from public.credentials where id = evidence.credential_id and archived_at is not null)
            and exists (select 1 from public.practice_memberships where practice_id = evidence.practice_id
                and user_id = evidence.actor_user_id and state = 'active' and role in ('administrator', 'manager')) then continue; end if;
        if object.id is null and not evidence.charged then continue; end if;
        if evidence.state = 'pending' then
            update private.renewal_evidence set state = 'abandoned', updated_at = clock_timestamp()
            where id = evidence.id returning * into evidence;
            perform private.evidence_event(evidence, null, 'abandoned');
        end if;
        if object.id is null then
            update private.renewal_evidence set state = case when state = 'deleting' then 'deleted' else state end,
                filename = null, charged = false, updated_at = clock_timestamp() where id = evidence.id;
            perform private.evidence_event(evidence, null, 'purge-completed');
            continue;
        end if;
        token := gen_random_uuid();
        update private.renewal_evidence_objects set state = 'purging', claim_token = token,
            claim_until = clock_timestamp() + interval '120 seconds', updated_at = clock_timestamp()
        where id = object.id;
        result := result || jsonb_build_array(jsonb_build_object('objectId', object.id,
            'token', token, 'path', object.object_path));
    end loop;
    return result;
end;
$$;
create function private.record_renewal_evidence_cleanup(
    p_object_id uuid, p_token uuid, p_purged boolean
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare evidence private.renewal_evidence; object private.renewal_evidence_objects;
begin
    select * into object from private.renewal_evidence_objects where id = p_object_id;
    if not found then return false; end if;
    select * into evidence from private.renewal_evidence where id = object.evidence_id;
    perform 1 from public.practices where id = evidence.practice_id for update;
    select * into object from private.renewal_evidence_objects where id = p_object_id;
    if p_token is null or object.claim_token is distinct from p_token or object.claim_until <= clock_timestamp()
        or evidence.state not in ('deleting', 'deleted', 'abandoned') or p_purged is null then return false; end if;
    update private.renewal_evidence_objects set state = case when p_purged then 'purged' else 'purging' end,
        claim_token = null, claim_until = null,
        failures = case when p_purged then 0 else least(failures + 1, 16) end,
        next_check_at = clock_timestamp() + case when p_purged then interval '24 hours'
            else interval '1 minute' * least(60, power(2, least(failures, 6))) end,
        updated_at = clock_timestamp() where id = object.id;
    if p_purged and evidence.charged then
        update private.renewal_evidence set state = case when state = 'deleting' then 'deleted' else state end,
            filename = null, charged = false, updated_at = clock_timestamp() where id = evidence.id;
        perform private.evidence_event(evidence, null, 'purge-completed');
    end if;
    return true;
end;
$$;

create function public.get_renewal_evidence(
    p_practice_id uuid, p_credential_id uuid, p_cycle_id uuid
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.get_renewal_evidence(p_practice_id, p_credential_id, p_cycle_id);
$$;
create function public.reserve_renewal_evidence(
    p_practice_id uuid, p_credential_id uuid,
    p_cycle_id uuid,
    p_request_id uuid,
    p_filename text,
    p_mime text,
    p_byte_count integer,
    p_digest text
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.reserve_renewal_evidence(p_practice_id, p_credential_id, p_cycle_id,
        p_request_id, p_filename, p_mime, p_byte_count, p_digest);
$$;
create function public.remove_renewal_evidence(
    p_practice_id uuid, p_credential_id uuid,
    p_cycle_id uuid,
    p_evidence_id uuid,
    p_request_id uuid,
    p_expected_version integer,
    p_confirmed boolean
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.remove_renewal_evidence(p_practice_id, p_credential_id, p_cycle_id,
        p_evidence_id, p_request_id, p_expected_version, p_confirmed);
$$;
create function public.claim_renewal_evidence_upload(
    p_practice_id uuid, p_actor_id uuid, p_evidence_id uuid
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.claim_renewal_evidence_upload(p_practice_id, p_actor_id, p_evidence_id);
$$;
create function public.finalize_renewal_evidence_upload(
    p_practice_id uuid, p_actor_id uuid,
    p_evidence_id uuid, p_token uuid, p_byte_count integer, p_digest text
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.finalize_renewal_evidence_upload(p_practice_id, p_actor_id, p_evidence_id, p_token, p_byte_count, p_digest);
$$;
create function public.authorize_renewal_evidence_download(
    p_practice_id uuid, p_actor_id uuid,
    p_credential_id uuid, p_cycle_id uuid, p_evidence_id uuid
)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.authorize_renewal_evidence_download(p_practice_id, p_actor_id, p_credential_id, p_cycle_id, p_evidence_id);
$$;
create function public.record_renewal_evidence_download(p_access_id uuid)
returns boolean language sql volatile security invoker set search_path = '' as $$
    select private.record_renewal_evidence_download(p_access_id);
$$;
create function public.claim_renewal_evidence_cleanup(p_evidence_id uuid default null)
returns jsonb language sql volatile security invoker set search_path = '' as $$
    select private.claim_renewal_evidence_cleanup(p_evidence_id);
$$;
create function public.record_renewal_evidence_cleanup(
    p_object_id uuid, p_token uuid, p_purged boolean
)
returns boolean language sql volatile security invoker set search_path = '' as $$
    select private.record_renewal_evidence_cleanup(p_object_id, p_token, p_purged);
$$;

do $$
declare entry record; audience text;
begin
    for entry in select p.oid::regprocedure signature, p.proname from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')
        and p.proname in ('get_renewal_evidence', 'reserve_renewal_evidence', 'remove_renewal_evidence',
            'claim_renewal_evidence_upload', 'finalize_renewal_evidence_upload',
            'authorize_renewal_evidence_download', 'record_renewal_evidence_download',
            'claim_renewal_evidence_cleanup', 'record_renewal_evidence_cleanup')
    loop
        execute format('revoke all on function %s from public, anon, authenticated, service_role', entry.signature);
        audience := case when entry.proname in ('get_renewal_evidence', 'reserve_renewal_evidence',
            'remove_renewal_evidence') then 'authenticated' else 'service_role' end;
        execute format('grant execute on function %s to %I', entry.signature, audience);
    end loop;
end;
$$;
