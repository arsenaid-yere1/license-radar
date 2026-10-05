create table public.practice_memberships (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null references public.practices (id) on delete restrict,
    user_id uuid not null references auth.users (id) on delete restrict,
    role text not null check (role in ('administrator', 'manager', 'viewer')),
    state text not null default 'active' check (state in ('active', 'revoked')),
    version integer not null default 1 check (version > 0),
    revoked_at timestamptz,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    unique (practice_id, user_id),
    check (state <> 'revoked' or revoked_at is not null)
);
create unique index practice_memberships_one_active_user
on public.practice_memberships (user_id) where state = 'active';
create index practice_memberships_practice_id_idx
on public.practice_memberships (practice_id);
alter table public.practice_memberships enable row level security;
revoke all on public.practice_memberships from public, anon, authenticated;
grant select on public.practice_memberships to authenticated;
create policy memberships_self on public.practice_memberships for select to authenticated
using (user_id = (select auth.uid()) and state = 'active');

create table private.practice_access_events (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null references public.practices (id) on delete restrict,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    membership_id uuid references public.practice_memberships (id) on delete restrict,
    invitation_id uuid,
    operation text not null,
    before_role text,
    after_role text,
    before_state text,
    after_state text,
    occurred_at timestamptz not null default clock_timestamp()
);
create index practice_access_events_practice_id_idx
on private.practice_access_events (practice_id);
create index practice_access_events_actor_user_id_idx
on private.practice_access_events (actor_user_id);
create index practice_access_events_membership_id_idx
on private.practice_access_events (membership_id);
alter table private.practice_access_events enable row level security;
revoke all on private.practice_access_events from public, anon, authenticated;

-- Backfill before enabling mutation audit triggers: historical profile events stay intact.
insert into public.practice_memberships (practice_id, user_id, role)
select
    id,
    owner_user_id,
    'administrator' as role
from public.practices;
insert into private.practice_access_events
(practice_id, actor_user_id, membership_id, operation, after_role, after_state)
select
    practice_id,
    user_id,
    id,
    'membership_initialized' as operation,
    role,
    state
from public.practice_memberships;

create function private.current_practice_id() returns uuid
language sql stable security definer set search_path = '' as $$
    select practice_id from public.practice_memberships
    where user_id = auth.uid() and state = 'active';
$$;
revoke all on function private.current_practice_id() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.current_practice_id() to authenticated;
drop policy practices_insert on public.practices;
drop policy practices_update on public.practices;
drop policy practices_select on public.practices;
create policy practices_select on public.practices for select to authenticated
using (id = (select private.current_practice_id()));
revoke insert (name, timezone), update (name, timezone) on public.practices from authenticated;
alter table public.practices drop constraint practices_owner_user_id_key;

create function private.require_administrator(p_practice_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform 1 from public.practices where id = p_practice_id for update;
    if not exists (select 1 from public.practice_memberships
                   where practice_id = p_practice_id and user_id = auth.uid()
                     and state = 'active' and role = 'administrator') then
        raise exception 'forbidden' using errcode = '42501';
    end if;
end;
$$;
revoke all on function private.require_administrator(uuid) from public, anon, authenticated;

create function private.ensure_administrator() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
declare
    target uuid;
begin
    if tg_table_name = 'practices' then
        target := new.id;
    elsif tg_op = 'DELETE' then
        target := old.practice_id;
    else
        target := new.practice_id;
    end if;
    perform 1 from public.practices where id = target for update;
    if found and not exists (select 1 from public.practice_memberships
                             where practice_id = target and state = 'active'
                               and role = 'administrator') then
        raise exception 'Practice requires an active administrator' using errcode = '23514';
    end if;
    if tg_table_name = 'practice_memberships' then
        if tg_op = 'UPDATE' then
            if old.practice_id <> new.practice_id then
                raise exception 'Membership practice is immutable' using errcode = '23514';
            end if;
        end if;
    end if;
    return null;
end;
$$;
revoke all on function private.ensure_administrator() from public, anon, authenticated;
create constraint trigger practice_requires_administrator
after insert on public.practices deferrable initially deferred
for each row execute function private.ensure_administrator();
create constraint trigger membership_requires_administrator
after insert or update or delete on public.practice_memberships deferrable initially deferred
for each row execute function private.ensure_administrator();

create function private.audit_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    insert into private.practice_access_events
        (practice_id, actor_user_id, membership_id, operation,
         before_role, after_role, before_state, after_state)
    values (new.practice_id, coalesce(auth.uid(), new.user_id), new.id,
            case when tg_op = 'INSERT' then 'membership_created'
                 when new.state = 'revoked' then 'membership_revoked'
                 when old.state = 'revoked' then 'membership_reactivated'
                 else 'membership_role_changed' end,
            case when tg_op = 'UPDATE' then old.role end, new.role,
            case when tg_op = 'UPDATE' then old.state end, new.state);
    return new;
end;
$$;
revoke all on function private.audit_membership() from public, anon, authenticated;
create trigger audit_membership after insert or update on public.practice_memberships
for each row execute function private.audit_membership();

create function private.create_practice(p_name text, p_timezone text) returns public.practices
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
    return result;
end;
$$;
revoke all on function private.create_practice(text, text) from public, anon, authenticated;
grant execute on function private.create_practice(text, text) to authenticated;
create function public.create_practice(p_name text, p_timezone text) returns public.practices
language sql volatile security invoker set search_path = '' as $$
    select private.create_practice(p_name, p_timezone);
$$;
revoke all on function public.create_practice(text, text) from public, anon, authenticated;
grant execute on function public.create_practice(text, text) to authenticated;

create function private.update_practice(
    p_practice_id uuid, p_name text, p_timezone text, p_expected_version integer
) returns public.practices
language plpgsql volatile security definer set search_path = '' as $$
declare
    result public.practices;
begin
    perform private.require_administrator(p_practice_id);
    if p_expected_version is null or p_expected_version < 1 then
        raise exception 'Invalid version' using errcode = '23514';
    end if;
    update public.practices set name = p_name, timezone = p_timezone
    where id = p_practice_id and version = p_expected_version returning * into result;
    if not found then raise exception 'conflict' using errcode = 'PT409'; end if;
    return result;
end;
$$;
revoke all on function private.update_practice(uuid, text, text, integer) from public,
anon,
authenticated;
grant execute on function private.update_practice(uuid, text, text, integer) to authenticated;
create function public.update_practice(
    p_practice_id uuid, p_name text, p_timezone text, p_expected_version integer
) returns public.practices
language sql volatile security invoker set search_path = '' as $$
    select private.update_practice(p_practice_id, p_name, p_timezone, p_expected_version);
$$;
revoke all on function public.update_practice(uuid, text, text, integer) from public,
anon,
authenticated;
grant execute on function public.update_practice(uuid, text, text, integer) to authenticated;
