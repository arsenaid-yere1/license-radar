alter table public.practice_memberships
add constraint practice_memberships_practice_id_id_key unique (practice_id, id);

create table private.practice_reminder_settings (
    practice_id uuid primary key references public.practices (id) on delete restrict,
    membership_id uuid,
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    constraint practice_reminder_settings_member_fkey foreign key (practice_id, membership_id)
    references public.practice_memberships (practice_id, id) on delete restrict
);
create index practice_reminder_settings_member_idx
on private.practice_reminder_settings (membership_id);
alter table private.practice_reminder_settings enable row level security;
revoke all on private.practice_reminder_settings from public, anon, authenticated;

create table private.practice_recipient_events (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null references public.practices (id) on delete restrict,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    operation text not null check (
        operation in ('assigned', 'replaced', 'cleared', 'member-invalidated')
    ),
    before_membership_id uuid,
    after_membership_id uuid,
    before_version integer not null check (before_version > 0),
    after_version integer not null check (after_version = before_version + 1),
    reason text check (reason in ('revoked', 'role-viewer')),
    occurred_at timestamptz not null default clock_timestamp(),
    constraint practice_recipient_events_before_fkey foreign key (practice_id, before_membership_id)
    references public.practice_memberships (practice_id, id) on delete restrict,
    constraint practice_recipient_events_after_fkey foreign key (practice_id, after_membership_id)
    references public.practice_memberships (practice_id, id) on delete restrict,
    check ((operation = 'member-invalidated') = (reason is not null)),
    check (
        (
            operation = 'assigned'
            and before_membership_id is null
            and after_membership_id is not null
        )
        or (
            operation = 'replaced' and before_membership_id is not null
            and after_membership_id is not null and before_membership_id <> after_membership_id
        )
        or (
            operation in ('cleared', 'member-invalidated')
            and before_membership_id is not null and after_membership_id is null
        )
    )
);
create index practice_recipient_events_practice_idx on private.practice_recipient_events (
    practice_id
);
create index practice_recipient_events_actor_idx on private.practice_recipient_events (
    actor_user_id
);
create index practice_recipient_events_before_idx on private.practice_recipient_events (
    before_membership_id
);
create index practice_recipient_events_after_idx on private.practice_recipient_events (
    after_membership_id
);
alter table private.practice_recipient_events enable row level security;
revoke all on private.practice_recipient_events from public, anon, authenticated;

-- Backfill responsibility as unassigned without manufacturing assignment or consent history.
insert into private.practice_reminder_settings (practice_id) select id from public.practices;

create function private.require_recipient_member(p_practice_id uuid, p_edit boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
    actor_role text;
begin
    perform 1 from public.practices where id = p_practice_id for update;
    select role into actor_role from public.practice_memberships
    where practice_id = p_practice_id and user_id = auth.uid() and state = 'active';
    if actor_role is null or (p_edit and actor_role not in ('administrator', 'manager')) then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    return actor_role in ('administrator', 'manager');
end;
$$;
revoke all on function private.require_recipient_member(uuid, boolean) from public,
anon,
authenticated;

create function private.get_practice_reminder_recipient(p_practice_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    can_edit boolean;
    settings private.practice_reminder_settings;
    selected jsonb;
    readiness text;
    result jsonb;
begin
    can_edit := private.require_recipient_member(p_practice_id, false);
    select * into settings from private.practice_reminder_settings where practice_id = p_practice_id;
    if not found then raise exception 'Recipient settings unavailable' using errcode = 'XX000'; end if;
    select pg_catalog.jsonb_build_object('id', m.id, 'email', u.email, 'role', m.role, 'state', m.state)
    into selected from public.practice_memberships m join auth.users u on u.id = m.user_id
    where m.practice_id = p_practice_id and m.id = settings.membership_id;
    readiness := case when settings.membership_id is null then 'no-recipient'
        when selected->>'state' = 'active' and selected->>'role' in ('administrator', 'manager')
            then 'sms-setup-pending' else 'member-unavailable' end;
    result := pg_catalog.jsonb_build_object('version', settings.version, 'selected', selected,
        'readiness', readiness, 'ready', false, 'canEdit', can_edit);
    if can_edit then
        result := result || pg_catalog.jsonb_build_object('candidates', coalesce((
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', m.id, 'email', u.email, 'role', m.role, 'state', m.state) order by m.created_at, m.id)
            from public.practice_memberships m join auth.users u on u.id = m.user_id
            where m.practice_id = p_practice_id and m.state = 'active'
                and m.role in ('administrator', 'manager')
        ), '[]'::jsonb));
    end if;
    return result;
end;
$$;

-- Caller already owns the practice lock. No user/advisory or membership lock is acquired here.
create function private.change_reminder_recipient(
    p_practice_id uuid, p_membership_id uuid, p_reason text
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
    settings private.practice_reminder_settings;
begin
    select * into settings from private.practice_reminder_settings
    where practice_id = p_practice_id for update;
    if not found then raise exception 'Recipient settings unavailable' using errcode = 'XX000'; end if;
    if settings.membership_id is not distinct from p_membership_id then return; end if;
    update private.practice_reminder_settings set membership_id = p_membership_id,
        version = version + 1, updated_at = pg_catalog.clock_timestamp() where practice_id = p_practice_id;
    insert into private.practice_recipient_events
        (practice_id, actor_user_id, operation, before_membership_id, after_membership_id,
         before_version, after_version, reason)
    values (p_practice_id, auth.uid(),
        case when p_reason is not null then 'member-invalidated'
             when settings.membership_id is null then 'assigned'
             when p_membership_id is null then 'cleared' else 'replaced' end,
        settings.membership_id, p_membership_id, settings.version, settings.version + 1, p_reason);
end;
$$;
revoke all on function private.change_reminder_recipient(uuid, uuid, text) from public,
anon,
authenticated;

create function private.invalidate_reminder_recipient(
    p_practice_id uuid, p_membership_id uuid, p_reason text
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
    settings private.practice_reminder_settings;
begin
    select * into settings from private.practice_reminder_settings
    where practice_id = p_practice_id for update;
    if not found then raise exception 'Recipient settings unavailable' using errcode = 'XX000'; end if;
    if settings.membership_id = p_membership_id then
        perform private.change_reminder_recipient(p_practice_id, null, p_reason);
    end if;
end;
$$;
revoke all on function private.invalidate_reminder_recipient(uuid, uuid, text) from public,
anon,
authenticated;

create function private.set_practice_reminder_recipient(
    p_practice_id uuid, p_membership_id uuid, p_expected_version integer
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    settings private.practice_reminder_settings;
begin
    perform private.require_recipient_member(p_practice_id, true);
    if p_expected_version is null or p_expected_version < 1 then
        raise exception 'Invalid version' using errcode = '23514';
    end if;
    select * into settings from private.practice_reminder_settings
    where practice_id = p_practice_id for update;
    if not found then raise exception 'Recipient settings unavailable' using errcode = 'XX000'; end if;
    if settings.version <> p_expected_version then return '{"status":"conflict"}'::jsonb; end if;
    if p_membership_id is not null and not exists (
        select 1 from public.practice_memberships where id = p_membership_id and practice_id = p_practice_id
            and state = 'active' and role in ('administrator', 'manager')
    ) then return '{"status":"invalid-recipient"}'::jsonb; end if;
    perform private.change_reminder_recipient(p_practice_id, p_membership_id, null);
    return pg_catalog.jsonb_build_object('status', 'success',
        'recipient', private.get_practice_reminder_recipient(p_practice_id));
end;
$$;

create function public.get_practice_reminder_recipient(p_practice_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.get_practice_reminder_recipient(p_practice_id);
$$;
create function public.set_practice_reminder_recipient(
    p_practice_id uuid, p_membership_id uuid, p_expected_version integer
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.set_practice_reminder_recipient(p_practice_id, p_membership_id, p_expected_version);
$$;
revoke all on function private.get_practice_reminder_recipient(uuid),
public.get_practice_reminder_recipient(uuid),
private.set_practice_reminder_recipient(uuid, uuid, integer),
public.set_practice_reminder_recipient(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function private.get_practice_reminder_recipient(uuid),
public.get_practice_reminder_recipient(uuid),
private.set_practice_reminder_recipient(uuid, uuid, integer),
public.set_practice_reminder_recipient(uuid, uuid, integer) to authenticated;

create or replace function private.create_practice(
    p_name text, p_timezone text
) returns public.practices
language plpgsql volatile security definer set search_path = '' as $$
declare
    result public.practices;
    actor uuid := auth.uid();
begin
    if actor is null or not exists (select 1 from auth.users
                                   where id = actor and email_confirmed_at is not null) then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
    select p.* into result from public.practices as p
    join public.practice_memberships as m on m.practice_id = p.id
    where m.user_id = actor and m.state = 'active';
    if found then return result; end if;
    insert into public.practices (name, timezone) values (p_name, p_timezone)
    returning * into result;
    insert into public.practice_memberships (practice_id, user_id, role)
    values (result.id, actor, 'administrator');
    insert into private.practice_reminder_settings (practice_id) values (result.id);
    return result;
end;
$$;

create or replace function private.mutate_member(
    p_membership_id uuid, p_expected_version integer, p_role text, p_revoke boolean
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    member public.practice_memberships;
begin
    select * into member from public.practice_memberships where id=p_membership_id;
    perform private.require_administrator(member.practice_id);
    select * into member from public.practice_memberships where id=p_membership_id for update;
    if p_expected_version is null or p_expected_version < 1 or
       (not p_revoke and (p_role is null or p_role not in ('administrator','manager','viewer'))) then
        raise exception 'Invalid member input' using errcode='23514';
    end if;
    if p_revoke and member.state='revoked' then return '{"status":"success"}'::jsonb; end if;
    if member.version <> p_expected_version or member.state <> 'active' then return '{"status":"conflict"}'::jsonb; end if;
    if member.role='administrator' and (p_revoke or p_role <> 'administrator')
       and (select count(*) from public.practice_memberships where practice_id=member.practice_id
            and role='administrator' and state='active') <= 1 then return '{"status":"last-administrator"}'::jsonb; end if;
    if not p_revoke and member.role=p_role then return '{"status":"success"}'::jsonb; end if;
    if p_revoke then
        update public.practice_memberships set state='revoked',revoked_at=pg_catalog.clock_timestamp(),
            version=version+1,updated_at=pg_catalog.clock_timestamp() where id=p_membership_id;
    else
        update public.practice_memberships set role=p_role,version=version+1,
            updated_at=pg_catalog.clock_timestamp() where id=p_membership_id;
    end if;
    if p_revoke or p_role = 'viewer' then
        perform private.invalidate_reminder_recipient(member.practice_id, p_membership_id,
            case when p_revoke then 'revoked' else 'role-viewer' end);
    end if;
    return '{"status":"success"}'::jsonb;
end;
$$;
