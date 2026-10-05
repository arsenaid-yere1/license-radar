create function private.canonical_invitation_email(p_email text) returns text
language plpgsql immutable security invoker set search_path = '' as $email$
declare
    result text := pg_catalog.translate(pg_catalog.btrim(p_email, ' '),
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
begin
    if result is null or pg_catalog.char_length(result) > 254
       or result !~ $re$^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$$re$ then
        raise exception 'Invalid email' using errcode = '23514';
    end if;
    return result;
end;
$email$;
revoke all on function private.canonical_invitation_email(text) from public, anon, authenticated;

create table private.practice_invitations (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null references public.practices (id) on delete restrict,
    email text not null check (email = private.canonical_invitation_email(email)),
    role text not null check (role in ('administrator', 'manager', 'viewer')),
    token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
    state text not null default 'pending' check (state in ('pending', 'accepted', 'canceled')),
    issued_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null,
    creator_user_id uuid not null references auth.users (id) on delete restrict,
    accepted_user_id uuid references auth.users (id) on delete restrict,
    accepted_at timestamptz,
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    check (state <> 'accepted' or (accepted_user_id is not null and accepted_at is not null))
);
create unique index practice_invitations_one_pending_email
on private.practice_invitations (practice_id, email) where state = 'pending';
create index practice_invitations_creator_user_id_idx
on private.practice_invitations (creator_user_id);
create index practice_invitations_accepted_user_id_idx
on private.practice_invitations (accepted_user_id);
alter table private.practice_invitations enable row level security;
revoke all on private.practice_invitations from public, anon, authenticated;
alter table private.practice_access_events add constraint practice_access_events_invitation_id_fkey
foreign key (invitation_id) references private.practice_invitations (id) on delete restrict;
create index practice_access_events_invitation_id_idx
on private.practice_access_events (invitation_id);

create function private.invitation_projection(
    p_invitation private.practice_invitations
) returns jsonb
language sql immutable security invoker set search_path = '' as $$
    select pg_catalog.jsonb_build_object('id',p_invitation.id,'email',p_invitation.email,
        'role',p_invitation.role,'state',p_invitation.state,'version',p_invitation.version,
        'expires_at',p_invitation.expires_at);
$$;
revoke all on function private.invitation_projection(private.practice_invitations) from public,
anon,
authenticated;

create function private.audit_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    insert into private.practice_access_events
        (practice_id,actor_user_id,invitation_id,membership_id,operation,
         before_role,after_role,before_state,after_state)
    values (new.practice_id,auth.uid(),new.id,
            (select id from public.practice_memberships
             where practice_id=new.practice_id and user_id=new.accepted_user_id),
            case when tg_op='INSERT' then 'invitation_created'
                 when new.state='accepted' then 'invitation_accepted'
                 when new.state='canceled' then 'invitation_canceled'
                 else 'invitation_reissued' end,
            case when tg_op='UPDATE' then old.role end,new.role,
            case when tg_op='UPDATE' then old.state end,new.state);
    return new;
end;
$$;
revoke all on function private.audit_invitation() from public, anon, authenticated;
create trigger audit_invitation after insert or update on private.practice_invitations
for each row execute function private.audit_invitation();

create function private.list_practice_team(p_practice_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
    perform private.require_administrator(p_practice_id);
    select pg_catalog.jsonb_build_object(
        'members',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id',m.id,'email',u.email,'role',m.role,'state',m.state,'version',m.version)
            order by m.created_at,m.id) from public.practice_memberships m
            join auth.users u on u.id=m.user_id where m.practice_id=p_practice_id),'[]'::jsonb),
        'invitations',coalesce((select pg_catalog.jsonb_agg(private.invitation_projection(i)
            order by i.created_at,i.id) from private.practice_invitations i
            where i.practice_id=p_practice_id),'[]'::jsonb)) into result;
    return result;
end;
$$;

create function private.create_practice_invitation(
    p_practice_id uuid, p_email text, p_role text, p_token_digest text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    canonical text;
    issued timestamptz;
    result private.practice_invitations;
begin
    perform private.require_administrator(p_practice_id);
    canonical := private.canonical_invitation_email(p_email);
    if p_role is null or p_role not in ('administrator','manager','viewer')
       or p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$' then
        raise exception 'Invalid invitation' using errcode='23514';
    end if;
    if exists(select 1 from private.practice_invitations
              where practice_id=p_practice_id and email=canonical and state='pending') then
        return '{"status":"invite-exists"}'::jsonb;
    end if;
    issued := pg_catalog.clock_timestamp();
    insert into private.practice_invitations
        (practice_id,email,role,token_digest,creator_user_id,issued_at,expires_at)
    values(p_practice_id,canonical,p_role,p_token_digest,auth.uid(),issued,issued+interval '168 hours')
    returning * into result;
    return pg_catalog.jsonb_build_object('status','success','invitation',private.invitation_projection(result));
end;
$$;

create function private.mutate_invitation(
    p_invitation_id uuid, p_expected_version integer, p_token_digest text, p_reissue boolean
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    result private.practice_invitations;
    issued timestamptz;
begin
    select * into result from private.practice_invitations where id=p_invitation_id;
    perform private.require_administrator(result.practice_id);
    select * into result from private.practice_invitations where id=p_invitation_id for update;
    if p_expected_version is null or p_expected_version < 1 then
        raise exception 'Invalid version' using errcode='23514';
    end if;
    if not p_reissue and result.state='canceled' then
        return pg_catalog.jsonb_build_object('status','success','invitation',private.invitation_projection(result));
    end if;
    if result.version <> p_expected_version or result.state <> 'pending' then
        return '{"status":"conflict"}'::jsonb;
    end if;
    issued := pg_catalog.clock_timestamp();
    if p_reissue then
        if p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$'
           or p_token_digest=result.token_digest then
            raise exception 'Invalid new digest' using errcode='23514';
        end if;
        update private.practice_invitations set token_digest=p_token_digest,
            issued_at=issued,expires_at=issued+interval '168 hours',version=version+1,updated_at=issued
        where id=p_invitation_id returning * into result;
    else
        update private.practice_invitations set state='canceled',version=version+1,updated_at=issued
        where id=p_invitation_id returning * into result;
    end if;
    return pg_catalog.jsonb_build_object('status','success','invitation',private.invitation_projection(result));
end;
$$;
revoke all on function private.mutate_invitation(uuid, integer, text, boolean) from public,
anon,
authenticated;

create function private.invitation_for_actor(
    p_token_digest text
) returns private.practice_invitations
language plpgsql volatile security definer set search_path = '' as $$
declare
    result private.practice_invitations;
    actor_email text;
    latest_revocation timestamptz;
begin
    if p_token_digest is null or p_token_digest !~ '^[0-9a-f]{64}$' then return null; end if;
    select email into actor_email from auth.users
    where id=auth.uid() and email_confirmed_at is not null;
    if actor_email is null then return null; end if;
    select * into result from private.practice_invitations where token_digest=p_token_digest;
    if not found then return null; end if;
    if result.email <> private.canonical_invitation_email(actor_email)
       or result.state='canceled' or pg_catalog.clock_timestamp() >= result.expires_at then return null; end if;
    select revoked_at into latest_revocation from public.practice_memberships
    where practice_id=result.practice_id and user_id=auth.uid();
    if result.state='pending' and latest_revocation is not null
       and result.issued_at <= latest_revocation then return null; end if;
    if result.state='accepted' and (result.accepted_user_id <> auth.uid()
       or not exists(select 1 from public.practice_memberships where practice_id=result.practice_id
                     and user_id=auth.uid() and state='active')) then return null; end if;
    return result;
exception when check_violation then return null;
end;
$$;
revoke all on function private.invitation_for_actor(text) from public, anon, authenticated;

create function private.preview_practice_invitation(p_token_digest text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    invitation private.practice_invitations;
    invited_role text;
begin
    invitation := private.invitation_for_actor(p_token_digest);
    if invitation.id is null then return '{"status":"invalid-invitation"}'::jsonb; end if;
    invited_role := invitation.role;
    if invitation.state='accepted' then
        select role into invited_role from public.practice_memberships
        where practice_id=invitation.practice_id and user_id=auth.uid() and state='active';
    end if;
    return pg_catalog.jsonb_build_object('status','success','name',
        (select name from public.practices where id=invitation.practice_id),
        'role',invited_role,'expires_at',invitation.expires_at);
end;
$$;

create function private.accept_practice_invitation(p_token_digest text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    invitation private.practice_invitations;
    member public.practice_memberships;
    actor uuid := auth.uid();
begin
    if actor is null then return '{"status":"invalid-invitation"}'::jsonb; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
    select * into invitation from private.practice_invitations where token_digest=p_token_digest;
    if not found then return '{"status":"invalid-invitation"}'::jsonb; end if;
    perform 1 from public.practices where id=invitation.practice_id for update;
    invitation := private.invitation_for_actor(p_token_digest);
    if invitation.id is null then return '{"status":"invalid-invitation"}'::jsonb; end if;
    select * into member from public.practice_memberships where user_id=actor and state='active';
    if found then
        if member.practice_id <> invitation.practice_id then return '{"status":"other-practice"}'::jsonb; end if;
        return pg_catalog.jsonb_build_object('status','already-member','practiceId',member.practice_id,'role',member.role);
    end if;
    if invitation.state <> 'pending' then return '{"status":"invalid-invitation"}'::jsonb; end if;
    insert into public.practice_memberships (practice_id,user_id,role)
    values(invitation.practice_id,actor,invitation.role)
    on conflict(practice_id,user_id) do update set role=excluded.role,state='active',
        version=practice_memberships.version+1,updated_at=pg_catalog.clock_timestamp()
    returning * into member;
    update private.practice_invitations set state='accepted',accepted_user_id=actor,
        accepted_at=pg_catalog.clock_timestamp(),version=version+1,updated_at=pg_catalog.clock_timestamp()
    where id=invitation.id;
    return pg_catalog.jsonb_build_object('status','success','practiceId',member.practice_id,'role',member.role);
end;
$$;

create function private.mutate_member(
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
    return '{"status":"success"}'::jsonb;
end;
$$;
revoke all on function private.mutate_member(uuid, integer, text, boolean) from public,
anon,
authenticated;

-- Public functions are invoker wrappers; implementations remain in the unexposed schema.
create function public.list_practice_team(p_practice_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.list_practice_team(p_practice_id);
$$;
create function public.create_practice_invitation(
    p_practice_id uuid, p_email text, p_role text, p_token_digest text
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.create_practice_invitation(p_practice_id,p_email,p_role,p_token_digest);
$$;
create function private.cancel_practice_invitation(
    p_invitation_id uuid, p_expected_version integer
) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select private.mutate_invitation(p_invitation_id,p_expected_version,null,false);
$$;
create function public.cancel_practice_invitation(
    p_invitation_id uuid, p_expected_version integer
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.cancel_practice_invitation(p_invitation_id,p_expected_version);
$$;
create function private.reissue_practice_invitation(
    p_invitation_id uuid, p_expected_version integer, p_token_digest text
) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select private.mutate_invitation(p_invitation_id,p_expected_version,p_token_digest,true);
$$;
create function public.reissue_practice_invitation(
    p_invitation_id uuid, p_expected_version integer, p_token_digest text
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.reissue_practice_invitation(p_invitation_id,p_expected_version,p_token_digest);
$$;
create function public.preview_practice_invitation(p_token_digest text) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.preview_practice_invitation(p_token_digest);
$$;
create function public.accept_practice_invitation(p_token_digest text) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.accept_practice_invitation(p_token_digest);
$$;
create function private.change_practice_member_role(
    p_membership_id uuid, p_expected_version integer, p_role text
) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select private.mutate_member(p_membership_id,p_expected_version,p_role,false);
$$;
create function public.change_practice_member_role(
    p_membership_id uuid, p_expected_version integer, p_role text
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.change_practice_member_role(p_membership_id,p_expected_version,p_role);
$$;
create function private.revoke_practice_member(
    p_membership_id uuid, p_expected_version integer
) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select private.mutate_member(p_membership_id,p_expected_version,null,true);
$$;
create function public.revoke_practice_member(
    p_membership_id uuid, p_expected_version integer
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.revoke_practice_member(p_membership_id,p_expected_version);
$$;

revoke all on function private.list_practice_team(uuid), public.list_practice_team(uuid),
private.create_practice_invitation(uuid, text, text, text),
public.create_practice_invitation(uuid, text, text, text),
private.cancel_practice_invitation(uuid, integer), public.cancel_practice_invitation(uuid, integer),
private.reissue_practice_invitation(uuid, integer, text),
public.reissue_practice_invitation(uuid, integer, text),
private.preview_practice_invitation(text), public.preview_practice_invitation(text),
private.accept_practice_invitation(text), public.accept_practice_invitation(text),
private.change_practice_member_role(uuid, integer, text),
public.change_practice_member_role(uuid, integer, text),
private.revoke_practice_member(uuid, integer), public.revoke_practice_member(uuid, integer)
from public, anon, authenticated;
grant execute on function private.list_practice_team(uuid), public.list_practice_team(uuid),
private.create_practice_invitation(uuid, text, text, text),
public.create_practice_invitation(uuid, text, text, text),
private.cancel_practice_invitation(uuid, integer), public.cancel_practice_invitation(uuid, integer),
private.reissue_practice_invitation(uuid, integer, text),
public.reissue_practice_invitation(uuid, integer, text),
private.preview_practice_invitation(text), public.preview_practice_invitation(text),
private.accept_practice_invitation(text), public.accept_practice_invitation(text),
private.change_practice_member_role(uuid, integer, text),
public.change_practice_member_role(uuid, integer, text),
private.revoke_practice_member(uuid, integer), public.revoke_practice_member(uuid, integer)
to authenticated;
