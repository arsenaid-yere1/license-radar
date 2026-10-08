-- E4-S1. User operations lock practice -> one endpoint -> enrollment -> challenge/request.
-- Lifecycle invalidation owns the practice lock and never locks an endpoint.
-- Provider opt-out owns only an endpoint lock; eligibility reads suppression directly.
create table private.sms_phone_endpoints (
    id uuid primary key default gen_random_uuid(),
    account_sid text not null check (account_sid ~ '^AC[0-9a-fA-F]{32}$'),
    messaging_service_sid text not null check (messaging_service_sid ~ '^MG[0-9a-fA-F]{32}$'),
    phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{1,14}$'),
    provider_blocked boolean not null default false,
    suppression_epoch integer not null default 0 check (suppression_epoch >= 0),
    created_at timestamptz not null default clock_timestamp(),
    unique (account_sid, messaging_service_sid, phone_e164)
);
create table private.practice_sms_enrollments (
    practice_id uuid not null,
    membership_id uuid not null,
    endpoint_id uuid references private.sms_phone_endpoints (id) on delete restrict,
    version integer not null default 1 check (version > 0),
    phone_revision integer not null default 0 check (phone_revision >= 0),
    verified_revision integer,
    verified_at timestamptz,
    consent_event_id uuid,
    consent_epoch integer,
    withdrawn boolean not null default false,
    primary key (practice_id, membership_id),
    foreign key (practice_id, membership_id) references public.practice_memberships (
        practice_id, id
    ) on delete restrict,
    check ((verified_revision is null) = (verified_at is null)),
    check (
        verified_revision is null
        or (verified_revision = phone_revision and endpoint_id is not null)
    ),
    check ((consent_event_id is null) = (consent_epoch is null)),
    check (consent_event_id is null or verified_revision is not null)
);
create table private.sms_enrollment_events (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    membership_id uuid not null,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    phone_revision integer not null check (phone_revision >= 0),
    endpoint_id uuid references private.sms_phone_endpoints (id) on delete restrict,
    kind text not null check (
        kind in (
            'phone-change',
            'otp-permission',
            'verified',
            'reminder-consent',
            'withdrawn',
            'member-invalidated'
        )
    ),
    disclosure_version text,
    disclosure_text text,
    occurred_at timestamptz not null default clock_timestamp(),
    foreign key (practice_id, membership_id) references private.practice_sms_enrollments (
        practice_id, membership_id
    ) on delete restrict,
    unique (practice_id, membership_id, phone_revision, id),
    check (
        (kind in ('otp-permission', 'reminder-consent'))
        = (disclosure_version is not null and disclosure_text is not null)
    )
);
alter table private.practice_sms_enrollments add constraint practice_sms_consent_event_fkey
foreign key (practice_id, membership_id, phone_revision, consent_event_id)
references private.sms_enrollment_events (
    practice_id, membership_id, phone_revision, id
) on delete restrict;
create table private.sms_verification_challenges (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    membership_id uuid not null,
    phone_revision integer not null check (phone_revision > 0),
    endpoint_id uuid not null references private.sms_phone_endpoints (id) on delete restrict,
    verify_service_sid text not null check (verify_service_sid ~ '^VA[0-9a-fA-F]{32}$'),
    verification_sid text check (verification_sid ~ '^VE[0-9a-fA-F]{32}$'),
    state text not null check (
        state in (
            'reserved', 'pending', 'verified', 'failed', 'uncertain', 'expired', 'invalidated'
        )
    ),
    created_at timestamptz not null default transaction_timestamp(),
    expires_at timestamptz not null default transaction_timestamp() + interval '10 minutes',
    check_count integer not null default 0 check (check_count between 0 and 5),
    foreign key (practice_id, membership_id) references private.practice_sms_enrollments (
        practice_id, membership_id
    ) on delete restrict,
    unique (practice_id, membership_id, id),
    check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
create unique index sms_one_live_challenge on private.sms_verification_challenges (endpoint_id)
where state in ('reserved', 'pending', 'uncertain');
create table private.sms_verification_requests (
    id uuid primary key default gen_random_uuid(),
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    practice_id uuid not null,
    membership_id uuid not null,
    request_id uuid not null,
    challenge_id uuid not null,
    intent text not null check (intent in ('send', 'check')),
    state text not null default 'prepared' check (
        state in ('prepared', 'claimed', 'complete', 'uncertain')
    ),
    payload jsonb not null,
    claim_token uuid,
    reserved_at timestamptz,
    lease_until timestamptz,
    outcome text,
    created_at timestamptz not null default clock_timestamp(),
    foreign key (
        practice_id, membership_id, challenge_id
    ) references private.sms_verification_challenges (
        practice_id, membership_id, id
    ) on delete restrict,
    unique (practice_id, actor_user_id, request_id),
    check ((claim_token is null) = (reserved_at is null)),
    check ((lease_until is null) = (reserved_at is null))
);
create index sms_request_actor_budget on private.sms_verification_requests (
    actor_user_id, reserved_at
);
create index sms_request_challenge_budget on private.sms_verification_requests (
    challenge_id, reserved_at
);
create table private.sms_action_receipts (
    id uuid primary key default gen_random_uuid(),
    practice_id uuid not null,
    membership_id uuid not null,
    actor_user_id uuid not null references auth.users (id) on delete restrict,
    request_id uuid not null,
    intent text not null check (intent in ('prepare', 'consent', 'withdraw')),
    payload jsonb not null,
    result text not null default 'success' check (result = 'success'),
    version integer not null check (version > 0),
    phone_revision integer not null check (phone_revision >= 0),
    occurred_at timestamptz not null default clock_timestamp(),
    foreign key (practice_id, membership_id) references private.practice_sms_enrollments (
        practice_id, membership_id
    ) on delete restrict,
    unique (practice_id, actor_user_id, request_id)
);
create table private.sms_provider_events (
    id uuid primary key default gen_random_uuid(),
    account_sid text not null,
    message_sid text not null check (message_sid ~ '^SM[0-9a-fA-F]{32}$'),
    endpoint_id uuid not null references private.sms_phone_endpoints (id) on delete restrict,
    opt_out_type text not null check (opt_out_type in ('STOP', 'START', 'HELP')),
    occurred_at timestamptz not null default clock_timestamp(),
    unique (account_sid, message_sid)
);

alter table private.sms_phone_endpoints enable row level security;
alter table private.practice_sms_enrollments enable row level security;
alter table private.sms_enrollment_events enable row level security;
alter table private.sms_verification_challenges enable row level security;
alter table private.sms_verification_requests enable row level security;
alter table private.sms_action_receipts enable row level security;
alter table private.sms_provider_events enable row level security;
revoke all on private.sms_phone_endpoints, private.practice_sms_enrollments,
private.sms_enrollment_events, private.sms_verification_challenges,
private.sms_verification_requests, private.sms_action_receipts, private.sms_provider_events
from public, anon, authenticated, service_role;
grant usage on schema private to service_role;

create function private.sms_member(p_practice_id uuid, p_actor uuid, p_edit boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare member public.practice_memberships;
begin
    perform 1 from public.practices where id = p_practice_id for update;
    select * into member from public.practice_memberships
    where practice_id = p_practice_id and user_id = p_actor and state = 'active';
    if not found or (p_edit and member.role not in ('administrator','manager')) then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    return member.id;
end;
$$;
create function private.sms_disclosure(p_kind text, p_practice_id uuid) returns text
language sql stable security definer set search_path = '' as $$
    select case when p_kind = 'otp-permission' then
        'License Renewal Radar: I request a phone verification text. Message and data rates may apply. SMS terms and privacy: /sms-information.'
    else 'License Renewal Radar: I agree to renewal reminder texts for ' || name ||
        '. Frequency varies with renewal dates. Message and data rates may apply. Reply STOP or withdraw in settings to stop; HELP for help. SMS terms and privacy: /sms-information. Renewal texts are not active yet.' end
    from public.practices where id = p_practice_id;
$$;
create function private.sms_state(p_practice_id uuid, p_member_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    enrollment private.practice_sms_enrollments;
    endpoint private.sms_phone_endpoints;
    challenge private.sms_verification_challenges;
    member public.practice_memberships;
    consent private.sms_enrollment_events;
    reason text := 'not-started';
    is_verified boolean := false;
    is_consented boolean := false;
    retry_at timestamptz;
begin
    select * into member from public.practice_memberships where practice_id = p_practice_id and id = p_member_id;
    select * into enrollment from private.practice_sms_enrollments where practice_id = p_practice_id and membership_id = p_member_id;
    if enrollment.endpoint_id is not null then
        select * into endpoint from private.sms_phone_endpoints where id = enrollment.endpoint_id;
        if not found then raise exception 'Enrollment unavailable' using errcode = 'XX000'; end if;
    end if;
    select * into challenge from private.sms_verification_challenges
    where practice_id = p_practice_id and membership_id = p_member_id and phone_revision = enrollment.phone_revision
    order by created_at desc, id desc limit 1;
    if enrollment.consent_event_id is not null then
        select * into consent from private.sms_enrollment_events where id = enrollment.consent_event_id
        and practice_id = p_practice_id and membership_id = p_member_id and phone_revision = enrollment.phone_revision
        and kind = 'reminder-consent' and disclosure_version = 'e4-s1-v1';
        if not found then raise exception 'Consent unavailable' using errcode = 'XX000'; end if;
    end if;
    is_verified := coalesce(enrollment.verified_revision = enrollment.phone_revision and enrollment.verified_at is not null, false);
    is_consented := is_verified and consent.id is not null and not endpoint.provider_blocked
        and enrollment.consent_epoch = endpoint.suppression_epoch;
    if coalesce(endpoint.provider_blocked, false) then reason := 'provider-opted-out';
    elsif enrollment.withdrawn then reason := 'withdrawn';
    elsif is_consented then reason := 'enrolled';
    elsif is_verified then reason := 'consent-required';
    elsif challenge.expires_at > pg_catalog.clock_timestamp() and challenge.state in ('reserved','pending','uncertain') then
        reason := case when challenge.state = 'uncertain' or exists (
            select 1 from private.sms_verification_requests where challenge_id = challenge.id
            and state = 'claimed' and lease_until <= pg_catalog.clock_timestamp()
        ) then 'verification-uncertain' else 'verification-pending' end;
    end if;
    select max(r.reserved_at) + interval '60 seconds' into retry_at
    from private.sms_verification_requests r join private.sms_verification_challenges c on c.id = r.challenge_id
    where r.intent = 'send' and (r.actor_user_id = member.user_id or c.endpoint_id = enrollment.endpoint_id);
    return pg_catalog.jsonb_build_object(
        'version', coalesce(enrollment.version, 1), 'phoneRevision', coalesce(enrollment.phone_revision, 0),
        'phoneSuffix', case when endpoint.id is not null then pg_catalog.right(endpoint.phone_e164, 4) else null end,
        'verified', is_verified, 'consented', coalesce(is_consented, false),
        'canEdit', member.state = 'active' and member.role in ('administrator','manager'), 'reason', reason,
        'challengeId', case when challenge.expires_at > pg_catalog.clock_timestamp() and challenge.state in ('reserved','pending','uncertain') then challenge.id else null end,
        'expiresAt', case when challenge.expires_at > pg_catalog.clock_timestamp() and challenge.state in ('reserved','pending','uncertain') then challenge.expires_at else null end,
        'retryAfter', case when retry_at > pg_catalog.clock_timestamp() then retry_at else null end, 'deliveryActive', false);
end;
$$;
create function private.get_my_practice_sms_enrollment(p_practice_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare member uuid;
begin
    member := private.sms_member(p_practice_id, auth.uid(), false);
    return private.sms_state(p_practice_id, member);
end;
$$;
create function private.get_practice_reminder_recipient_with_enrollment(
    p_practice_id uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare recipient jsonb; enrollment jsonb; reason text;
begin
    recipient := private.get_practice_reminder_recipient(p_practice_id);
    reason := recipient->>'readiness';
    if reason = 'sms-setup-pending' then
        enrollment := private.sms_state(p_practice_id, (recipient->'selected'->>'id')::uuid);
        reason := enrollment->>'reason';
    end if;
    return pg_catalog.jsonb_build_object('recipient', recipient, 'enrollment',
        pg_catalog.jsonb_build_object('reason', reason, 'enrollmentReady', reason = 'enrolled', 'deliveryActive', false));
end;
$$;
create function private.sms_reply(p_practice_id uuid, p_member uuid, p_status text) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select pg_catalog.jsonb_build_object('status', p_status, 'enrollment', private.sms_state(p_practice_id, p_member));
$$;
create function private.sms_receipt(
    p_practice_id uuid, p_member uuid, p_actor uuid, p_request uuid, p_intent text, p_payload jsonb
) returns void
language sql volatile security definer set search_path = '' as $$
    insert into private.sms_action_receipts (practice_id,membership_id,actor_user_id,request_id,intent,payload,version,phone_revision)
    select p_practice_id,p_member,p_actor,p_request,p_intent,p_payload,version,phone_revision
    from private.practice_sms_enrollments where practice_id = p_practice_id and membership_id = p_member;
$$;
create function private.prepare_my_sms_verification(
    p_practice_id uuid, p_request_id uuid, p_phone text, p_expected_version integer,
    p_change_confirmed boolean, p_otp_permission boolean, p_account_sid text,
    p_messaging_service_sid text, p_verify_service_sid text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    member uuid; endpoint private.sms_phone_endpoints; enrollment private.practice_sms_enrollments;
    challenge private.sms_verification_challenges; receipt private.sms_action_receipts; payload jsonb;
begin
    member := private.sms_member(p_practice_id, auth.uid(), true);
    if p_request_id is null or p_expected_version is null or p_expected_version < 1 or p_otp_permission is distinct from true
        or p_phone is null or p_phone !~ '^\+[1-9][0-9]{1,14}$' or p_verify_service_sid is null or p_verify_service_sid !~ '^VA[0-9a-fA-F]{32}$'
        or p_account_sid is null or p_account_sid !~ '^AC[0-9a-fA-F]{32}$'
        or p_messaging_service_sid is null or p_messaging_service_sid !~ '^MG[0-9a-fA-F]{32}$' then
        raise exception 'Invalid verification input' using errcode = '23514';
    end if;
    insert into private.sms_phone_endpoints (account_sid,messaging_service_sid,phone_e164)
    values (p_account_sid,p_messaging_service_sid,p_phone) on conflict do nothing;
    select * into endpoint from private.sms_phone_endpoints where account_sid = p_account_sid
        and messaging_service_sid = p_messaging_service_sid and phone_e164 = p_phone for update;
    payload := pg_catalog.jsonb_build_object('endpoint',endpoint.id,'version',p_expected_version,'confirmed',p_change_confirmed,'verifyService',p_verify_service_sid);
    select * into receipt from private.sms_action_receipts where practice_id = p_practice_id and actor_user_id = auth.uid() and request_id = p_request_id;
    if found then
        if receipt.intent <> 'prepare' or receipt.payload <> payload then return private.sms_reply(p_practice_id,member,'conflict'); end if;
        return private.sms_reply(p_practice_id,member,'success');
    end if;
    if exists (select 1 from private.sms_verification_requests where practice_id = p_practice_id and actor_user_id = auth.uid() and request_id = p_request_id) then
        return private.sms_reply(p_practice_id,member,'conflict');
    end if;
    select * into enrollment from private.practice_sms_enrollments where practice_id = p_practice_id and membership_id = member for update;
    if coalesce(enrollment.version,1) <> p_expected_version then return private.sms_reply(p_practice_id,member,'conflict'); end if;
    if endpoint.provider_blocked then return private.sms_reply(p_practice_id,member,'blocked'); end if;
    if enrollment.endpoint_id = endpoint.id and enrollment.verified_revision = enrollment.phone_revision then
        perform private.sms_receipt(p_practice_id,member,auth.uid(),p_request_id,'prepare',payload);
        return private.sms_reply(p_practice_id,member,'success');
    end if;
    if enrollment.endpoint_id is not null and enrollment.endpoint_id <> endpoint.id and p_change_confirmed is distinct from true then
        return private.sms_reply(p_practice_id,member,'confirmation-required');
    end if;
    -- Retire expired live challenges under their sole endpoint lock before successor allocation.
    update private.sms_verification_challenges set state = 'expired' where endpoint_id = endpoint.id
        and state in ('reserved','pending','uncertain') and expires_at <= pg_catalog.clock_timestamp();
    select * into challenge from private.sms_verification_challenges where endpoint_id = endpoint.id
        and state in ('reserved','pending','uncertain') for update;
    if found and (challenge.membership_id <> member or challenge.practice_id <> p_practice_id or challenge.state = 'uncertain') then
        return private.sms_reply(p_practice_id,member,'busy');
    end if;
    if not found then
        if enrollment.practice_id is null then
            insert into private.practice_sms_enrollments (practice_id,membership_id) values (p_practice_id,member);
        end if;
        if enrollment.endpoint_id is distinct from endpoint.id then
            update private.sms_verification_challenges set state = 'invalidated'
                where practice_id = p_practice_id and membership_id = member and state <> 'invalidated';
            update private.practice_sms_enrollments set endpoint_id = endpoint.id, phone_revision = phone_revision + 1,
                version = version + 1, verified_revision = null, verified_at = null, consent_event_id = null, consent_epoch = null, withdrawn = false
                where practice_id = p_practice_id and membership_id = member returning * into enrollment;
            insert into private.sms_enrollment_events (practice_id,membership_id,actor_user_id,phone_revision,endpoint_id,kind)
                values (p_practice_id,member,auth.uid(),enrollment.phone_revision,endpoint.id,'phone-change');
        else
            update private.practice_sms_enrollments set verified_revision = null, verified_at = null, consent_event_id = null, consent_epoch = null,
                withdrawn = false, version = version + 1 where practice_id = p_practice_id and membership_id = member returning * into enrollment;
        end if;
        insert into private.sms_verification_challenges (practice_id,membership_id,phone_revision,endpoint_id,verify_service_sid,state)
            values (p_practice_id,member,enrollment.phone_revision,endpoint.id,p_verify_service_sid,'reserved') returning * into challenge;
    elsif challenge.verify_service_sid <> p_verify_service_sid then return private.sms_reply(p_practice_id,member,'conflict');
    end if;
    insert into private.sms_enrollment_events (practice_id,membership_id,actor_user_id,phone_revision,endpoint_id,kind,disclosure_version,disclosure_text)
        values (p_practice_id,member,auth.uid(),challenge.phone_revision,endpoint.id,'otp-permission','e4-s1-v1',private.sms_disclosure('otp-permission',p_practice_id));
    insert into private.sms_verification_requests (actor_user_id,practice_id,membership_id,request_id,challenge_id,intent,payload)
        values (auth.uid(),p_practice_id,member,p_request_id,challenge.id,'send',payload);
    perform private.sms_receipt(p_practice_id,member,auth.uid(),p_request_id,'prepare',payload);
    return private.sms_reply(p_practice_id,member,'success');
end;
$$;
create function private.consent_my_practice_sms(
    p_practice_id uuid, p_request_id uuid, p_expected_version integer, p_consent boolean
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare member uuid; enrollment private.practice_sms_enrollments; endpoint private.sms_phone_endpoints; receipt private.sms_action_receipts; event uuid; payload jsonb;
begin
    member := private.sms_member(p_practice_id,auth.uid(),true);
    if p_consent is distinct from true or p_request_id is null or p_expected_version is null or p_expected_version < 1 then
        raise exception 'Explicit consent required' using errcode = '23514';
    end if;
    select e.* into endpoint from private.sms_phone_endpoints e join private.practice_sms_enrollments s on s.endpoint_id = e.id
        where s.practice_id = p_practice_id and s.membership_id = member for update of e;
    select * into enrollment from private.practice_sms_enrollments where practice_id = p_practice_id and membership_id = member for update;
    payload := pg_catalog.jsonb_build_object('version',p_expected_version,'consent',true,'disclosure','e4-s1-v1');
    select * into receipt from private.sms_action_receipts where practice_id = p_practice_id and actor_user_id = auth.uid() and request_id = p_request_id;
    if found then
        return private.sms_reply(p_practice_id,member,case when receipt.intent = 'consent' and receipt.payload = payload then 'success' else 'conflict' end);
    end if;
    if exists (select 1 from private.sms_verification_requests where practice_id=p_practice_id and actor_user_id=auth.uid() and request_id=p_request_id) then return private.sms_reply(p_practice_id,member,'conflict'); end if;
    if enrollment.version is distinct from p_expected_version then return private.sms_reply(p_practice_id,member,'conflict'); end if;
    if endpoint.id is null or endpoint.provider_blocked or enrollment.verified_revision is distinct from enrollment.phone_revision then
        return private.sms_reply(p_practice_id,member,'verification-required');
    end if;
    if enrollment.consent_event_id is null then
        insert into private.sms_enrollment_events (practice_id,membership_id,actor_user_id,phone_revision,endpoint_id,kind,disclosure_version,disclosure_text)
        values (p_practice_id,member,auth.uid(),enrollment.phone_revision,endpoint.id,'reminder-consent','e4-s1-v1',private.sms_disclosure('reminder-consent',p_practice_id)) returning id into event;
        update private.practice_sms_enrollments set consent_event_id=event,consent_epoch=endpoint.suppression_epoch,withdrawn=false,version=version+1
        where practice_id=p_practice_id and membership_id=member;
    end if;
    perform private.sms_receipt(p_practice_id,member,auth.uid(),p_request_id,'consent',payload);
    return private.sms_reply(p_practice_id,member,'success');
end;
$$;
create function private.withdraw_my_practice_sms(
    p_practice_id uuid, p_request_id uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare member uuid; enrollment private.practice_sms_enrollments; receipt private.sms_action_receipts;
begin
    member := private.sms_member(p_practice_id,auth.uid(),false);
    if p_request_id is null then raise exception 'Invalid request' using errcode='23514'; end if;
    select * into enrollment from private.practice_sms_enrollments where practice_id=p_practice_id and membership_id=member for update;
    select * into receipt from private.sms_action_receipts where practice_id=p_practice_id and actor_user_id=auth.uid() and request_id=p_request_id;
    if found then return private.sms_reply(p_practice_id,member,case when receipt.intent='withdraw' then 'success' else 'conflict' end); end if;
    if exists (select 1 from private.sms_verification_requests where practice_id=p_practice_id and actor_user_id=auth.uid() and request_id=p_request_id) then return private.sms_reply(p_practice_id,member,'conflict'); end if;
    if enrollment.practice_id is null then return private.sms_reply(p_practice_id,member,'success'); end if;
    if not enrollment.withdrawn then
        update private.practice_sms_enrollments set consent_event_id=null,consent_epoch=null,withdrawn=true,version=version+1
            where practice_id=p_practice_id and membership_id=member;
        insert into private.sms_enrollment_events (practice_id,membership_id,actor_user_id,phone_revision,endpoint_id,kind)
            values (p_practice_id,member,auth.uid(),enrollment.phone_revision,enrollment.endpoint_id,'withdrawn');
    end if;
    perform private.sms_receipt(p_practice_id,member,auth.uid(),p_request_id,'withdraw','{}'::jsonb);
    return private.sms_reply(p_practice_id,member,'success');
end;
$$;
create function private.invalidate_sms_enrollment(p_practice_id uuid, p_member_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare enrollment private.practice_sms_enrollments;
begin
    select * into enrollment from private.practice_sms_enrollments where practice_id=p_practice_id and membership_id=p_member_id for update;
    if not found then return; end if;
    update private.practice_sms_enrollments set consent_event_id=null,consent_epoch=null,verified_revision=null,verified_at=null,
        phone_revision=phone_revision+1,version=version+1,withdrawn=true where practice_id=p_practice_id and membership_id=p_member_id;
    update private.sms_verification_challenges set state='invalidated' where practice_id=p_practice_id and membership_id=p_member_id and state<>'invalidated';
    insert into private.sms_enrollment_events (practice_id,membership_id,actor_user_id,phone_revision,endpoint_id,kind)
        values (p_practice_id,p_member_id,auth.uid(),enrollment.phone_revision+1,enrollment.endpoint_id,'member-invalidated');
end;
$$;

-- Service proof paths recheck the prepared actor under the practice lock.
-- No DB lock spans network I/O.
create function private.claim_sms_verification_send(
    p_practice_id uuid, p_actor_id uuid, p_request_id uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare member uuid; request private.sms_verification_requests; challenge private.sms_verification_challenges; endpoint private.sms_phone_endpoints; enrollment private.practice_sms_enrollments; now_at timestamptz := pg_catalog.clock_timestamp(); token uuid;
begin
    member := private.sms_member(p_practice_id,p_actor_id,true);
    select * into request from private.sms_verification_requests where practice_id=p_practice_id and actor_user_id=p_actor_id and request_id=p_request_id and intent='send';
    if not found or request.membership_id<>member then return private.sms_reply(p_practice_id,member,'conflict'); end if;
    select e.* into endpoint from private.sms_phone_endpoints e join private.sms_verification_challenges c on c.endpoint_id=e.id where c.id=request.challenge_id for update of e;
    select * into enrollment from private.practice_sms_enrollments where practice_id=p_practice_id and membership_id=member for update;
    select * into challenge from private.sms_verification_challenges where id=request.challenge_id for update;
    select * into request from private.sms_verification_requests where id=request.id for update;
    now_at := pg_catalog.clock_timestamp();
    if request.state<>'prepared' then
        if request.state='claimed' and request.lease_until<=now_at then
            update private.sms_verification_requests set state='uncertain',outcome='uncertain' where id=request.id;
            update private.sms_verification_challenges set state='uncertain' where id=challenge.id and state in ('reserved','pending');
        end if;
        return private.sms_reply(p_practice_id,member,case when request.state='complete' then 'success' else 'uncertain' end);
    end if;
    if endpoint.provider_blocked or enrollment.phone_revision<>challenge.phone_revision or enrollment.endpoint_id<>endpoint.id
        or challenge.state not in ('reserved','pending') or challenge.expires_at<=now_at then return private.sms_reply(p_practice_id,member,'verification-required'); end if;
    if exists (select 1 from private.sms_verification_requests where challenge_id=challenge.id and state in ('claimed','uncertain')) then return private.sms_reply(p_practice_id,member,'busy'); end if;
    if exists (select 1 from private.sms_verification_requests r join private.sms_verification_challenges c on c.id=r.challenge_id
        where r.intent='send' and r.reserved_at>now_at-interval '60 seconds' and (r.actor_user_id=p_actor_id or c.endpoint_id=endpoint.id))
        or (select count(*) from private.sms_verification_requests where intent='send' and actor_user_id=p_actor_id and reserved_at>now_at-interval '30 minutes')>=5
        or (select count(*) from private.sms_verification_requests where intent='send' and actor_user_id=p_actor_id and reserved_at>now_at-interval '24 hours')>=10
        or (select count(*) from private.sms_verification_requests r join private.sms_verification_challenges c on c.id=r.challenge_id where r.intent='send' and c.endpoint_id=endpoint.id and r.reserved_at>now_at-interval '30 minutes')>=5
        or (select count(*) from private.sms_verification_requests r join private.sms_verification_challenges c on c.id=r.challenge_id where r.intent='send' and c.endpoint_id=endpoint.id and r.reserved_at>now_at-interval '24 hours')>=10
        or (select count(*) from private.sms_verification_requests where intent='send' and practice_id=p_practice_id and reserved_at>now_at-interval '24 hours')>=100 then return private.sms_reply(p_practice_id,member,'rate-limited'); end if;
    token := gen_random_uuid();
    update private.sms_verification_requests set state='claimed',claim_token=token,reserved_at=now_at,lease_until=now_at+interval '30 seconds' where id=request.id;
    return pg_catalog.jsonb_build_object('status','claimed','claimToken',token,'phone',endpoint.phone_e164,'accountSid',endpoint.account_sid,'messagingServiceSid',endpoint.messaging_service_sid,'verifyServiceSid',challenge.verify_service_sid,'verificationSid',challenge.verification_sid,'challengeId',challenge.id);
end;
$$;
create function private.claim_sms_verification_check(
    p_practice_id uuid,
    p_actor_id uuid,
    p_request_id uuid,
    p_challenge_id uuid,
    p_expected_version integer
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare member uuid; enrollment private.practice_sms_enrollments; challenge private.sms_verification_challenges; endpoint private.sms_phone_endpoints; request private.sms_verification_requests; now_at timestamptz:=pg_catalog.clock_timestamp(); payload jsonb; token uuid;
begin
    member := private.sms_member(p_practice_id,p_actor_id,true);
    if p_request_id is null or p_expected_version is null or p_expected_version<1 then raise exception 'Invalid check input' using errcode='23514'; end if;
    select * into challenge from private.sms_verification_challenges where id=p_challenge_id and practice_id=p_practice_id and membership_id=member;
    if not found then return private.sms_reply(p_practice_id,member,'conflict'); end if;
    select * into endpoint from private.sms_phone_endpoints where id=challenge.endpoint_id for update;
    select * into enrollment from private.practice_sms_enrollments where practice_id=p_practice_id and membership_id=member for update;
    select * into challenge from private.sms_verification_challenges where id=p_challenge_id for update;
    payload := pg_catalog.jsonb_build_object('challenge',p_challenge_id,'version',p_expected_version);
    if exists (select 1 from private.sms_action_receipts where practice_id=p_practice_id and actor_user_id=p_actor_id and request_id=p_request_id) then return private.sms_reply(p_practice_id,member,'conflict'); end if;
    select * into request from private.sms_verification_requests where practice_id=p_practice_id and actor_user_id=p_actor_id and request_id=p_request_id for update;
    now_at := pg_catalog.clock_timestamp();
    if found then
        if request.intent<>'check' or request.payload<>payload then return private.sms_reply(p_practice_id,member,'conflict'); end if;
        if request.state='claimed' and request.lease_until<=now_at then
            update private.sms_verification_requests set state='uncertain',outcome='uncertain' where id=request.id;
            update private.sms_verification_challenges set state='uncertain' where id=challenge.id and state='pending';
        end if;
        return private.sms_reply(p_practice_id,member,case when request.state='complete' then coalesce(request.outcome,'success') else 'uncertain' end);
    end if;
    if enrollment.version<>p_expected_version then return private.sms_reply(p_practice_id,member,'conflict'); end if;
    if endpoint.provider_blocked or enrollment.phone_revision<>challenge.phone_revision or enrollment.endpoint_id<>endpoint.id or challenge.state<>'pending'
        or challenge.verification_sid is null or challenge.expires_at<=now_at or challenge.check_count>=5 then return private.sms_reply(p_practice_id,member,'verification-required'); end if;
    if exists (select 1 from private.sms_verification_requests where challenge_id=challenge.id and state in ('claimed','uncertain')) then return private.sms_reply(p_practice_id,member,'busy'); end if;
    token := gen_random_uuid();
    update private.sms_verification_challenges set check_count=check_count+1 where id=challenge.id;
    insert into private.sms_verification_requests (actor_user_id,practice_id,membership_id,request_id,challenge_id,intent,payload,state,claim_token,reserved_at,lease_until)
        values (p_actor_id,p_practice_id,member,p_request_id,challenge.id,'check',payload,'claimed',token,now_at,now_at+interval '30 seconds');
    return pg_catalog.jsonb_build_object('status','claimed','claimToken',token,'phone',endpoint.phone_e164,'accountSid',endpoint.account_sid,'messagingServiceSid',endpoint.messaging_service_sid,'verifyServiceSid',challenge.verify_service_sid,'verificationSid',challenge.verification_sid,'challengeId',challenge.id);
end;
$$;
create function private.record_sms_verification(
    p_practice_id uuid,
    p_actor_id uuid,
    p_request_id uuid,
    p_claim_token uuid,
    p_outcome jsonb,
    p_intent text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare member uuid; request private.sms_verification_requests; enrollment private.practice_sms_enrollments; challenge private.sms_verification_challenges; endpoint private.sms_phone_endpoints; result_status text; now_at timestamptz:=pg_catalog.clock_timestamp(); matches boolean;
begin
    member := private.sms_member(p_practice_id,p_actor_id,true);
    select * into request from private.sms_verification_requests where practice_id=p_practice_id and actor_user_id=p_actor_id and request_id=p_request_id and intent=p_intent;
    if not found or request.membership_id<>member then return private.sms_reply(p_practice_id,member,'conflict'); end if;
    select e.* into endpoint from private.sms_phone_endpoints e join private.sms_verification_challenges c on c.endpoint_id=e.id where c.id=request.challenge_id for update of e;
    select * into enrollment from private.practice_sms_enrollments where practice_id=p_practice_id and membership_id=member for update;
    select * into challenge from private.sms_verification_challenges where id=request.challenge_id for update;
    select * into request from private.sms_verification_requests where id=request.id for update;
    now_at := pg_catalog.clock_timestamp();
    if request.state='complete' then return private.sms_reply(p_practice_id,member,coalesce(request.outcome,'success')); end if;
    if request.claim_token is distinct from p_claim_token or request.state<>'claimed' then return private.sms_reply(p_practice_id,member,'conflict'); end if;
    if endpoint.provider_blocked or enrollment.phone_revision<>challenge.phone_revision or enrollment.endpoint_id<>endpoint.id or challenge.state not in ('reserved','pending') or challenge.expires_at<=now_at then
        update private.sms_verification_requests set state='complete',outcome='verification-required' where id=request.id;
        return private.sms_reply(p_practice_id,member,'verification-required');
    end if;
    matches := coalesce(p_outcome->>'accountSid'=endpoint.account_sid and p_outcome->>'serviceSid'=challenge.verify_service_sid
        and p_outcome->>'to'=endpoint.phone_e164 and p_outcome->>'channel'='sms' and p_outcome->>'sid' ~ '^VE[0-9a-fA-F]{32}$'
        and (challenge.verification_sid is null or p_outcome->>'sid'=challenge.verification_sid),false);
    if request.lease_until<=now_at or p_outcome->>'status'='uncertain' or not matches then
        result_status:='uncertain';
        update private.sms_verification_challenges set state='uncertain' where id=challenge.id;
    elsif p_intent='send' and p_outcome->>'status'='pending' then
        result_status:='success'; update private.sms_verification_challenges set state='pending',verification_sid=p_outcome->>'sid' where id=challenge.id;
    elsif p_intent='check' and p_outcome->>'status'='approved' then
        result_status:='success'; update private.sms_verification_challenges set state='verified' where id=challenge.id;
        update private.practice_sms_enrollments set verified_revision=phone_revision,verified_at=now_at,version=version+1,withdrawn=false where practice_id=p_practice_id and membership_id=member;
        insert into private.sms_enrollment_events (practice_id,membership_id,actor_user_id,phone_revision,endpoint_id,kind)
            values (p_practice_id,member,p_actor_id,challenge.phone_revision,endpoint.id,'verified');
    elsif p_intent='check' and p_outcome->>'status'='pending' then result_status:='wrong-code';
        if challenge.check_count>=5 then update private.sms_verification_challenges set state='failed' where id=challenge.id; end if;
    else result_status:='verification-required'; update private.sms_verification_challenges set state='failed' where id=challenge.id;
    end if;
    update private.sms_verification_requests set state=case when result_status='uncertain' then 'uncertain' else 'complete' end,outcome=result_status where id=request.id;
    return private.sms_reply(p_practice_id,member,result_status);
end;
$$;
create function private.record_sms_verification_send(
    p_practice_id uuid, p_actor_id uuid, p_request_id uuid, p_claim_token uuid, p_outcome jsonb
) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select private.record_sms_verification(p_practice_id,p_actor_id,p_request_id,p_claim_token,p_outcome,'send');
$$;
create function private.record_sms_verification_check(
    p_practice_id uuid, p_actor_id uuid, p_request_id uuid, p_claim_token uuid, p_outcome jsonb
) returns jsonb
language sql volatile security definer set search_path = '' as $$
    select private.record_sms_verification(p_practice_id,p_actor_id,p_request_id,p_claim_token,p_outcome,'check');
$$;
create function private.apply_sms_provider_opt_out(
    p_account_sid text,
    p_messaging_service_sid text,
    p_phone text,
    p_message_sid text,
    p_opt_out_type text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare endpoint private.sms_phone_endpoints; event private.sms_provider_events;
begin
    if p_opt_out_type is null or p_opt_out_type not in ('STOP','START','HELP') or p_message_sid is null or p_message_sid !~ '^SM[0-9a-fA-F]{32}$' then raise exception 'Invalid event' using errcode='23514'; end if;
    insert into private.sms_phone_endpoints (account_sid,messaging_service_sid,phone_e164) values (p_account_sid,p_messaging_service_sid,p_phone) on conflict do nothing;
    select * into endpoint from private.sms_phone_endpoints where account_sid=p_account_sid and messaging_service_sid=p_messaging_service_sid and phone_e164=p_phone for update;
    select * into event from private.sms_provider_events where account_sid=p_account_sid and message_sid=p_message_sid;
    if found then
        if event.endpoint_id<>endpoint.id or event.opt_out_type<>p_opt_out_type then return '{"status":"conflict"}'::jsonb; end if;
        return '{"status":"success"}'::jsonb;
    end if;
    insert into private.sms_provider_events (account_sid,message_sid,endpoint_id,opt_out_type) values (p_account_sid,p_message_sid,endpoint.id,p_opt_out_type);
    if p_opt_out_type='STOP' then update private.sms_phone_endpoints set provider_blocked=true,suppression_epoch=suppression_epoch+1 where id=endpoint.id; end if;
    return '{"status":"success"}'::jsonb;
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
        perform private.invalidate_sms_enrollment(member.practice_id, p_membership_id);
        perform private.invalidate_reminder_recipient(member.practice_id, p_membership_id,
            case when p_revoke then 'revoked' else 'role-viewer' end);
    end if;
    return '{"status":"success"}'::jsonb;
end;
$$;

revoke all on function private.sms_member(uuid, uuid, boolean) from public,
anon,
authenticated,
service_role;
revoke all on function private.sms_disclosure(text, uuid) from public,
anon,
authenticated,
service_role;
revoke all on function private.sms_state(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.sms_reply(uuid, uuid, text) from public,
anon,
authenticated,
service_role;
revoke all on function private.sms_receipt(uuid, uuid, uuid, uuid, text, jsonb) from public,
anon,
authenticated,
service_role;
revoke all on function private.invalidate_sms_enrollment(uuid, uuid) from public,
anon,
authenticated,
service_role;
revoke all on function private.record_sms_verification(
    uuid, uuid, uuid, uuid, jsonb, text
) from public,
anon,
authenticated,
service_role;
create function public.get_my_practice_sms_enrollment(p_practice_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.get_my_practice_sms_enrollment(p_practice_id);
$$;
revoke all on function public.get_my_practice_sms_enrollment(uuid),
private.get_my_practice_sms_enrollment(uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.get_my_practice_sms_enrollment(uuid),
private.get_my_practice_sms_enrollment(uuid) to authenticated;
create function public.get_practice_reminder_recipient_with_enrollment(
    p_practice_id uuid
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.get_practice_reminder_recipient_with_enrollment(p_practice_id);
$$;
revoke all on function public.get_practice_reminder_recipient_with_enrollment(uuid),
private.get_practice_reminder_recipient_with_enrollment(uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.get_practice_reminder_recipient_with_enrollment(uuid),
private.get_practice_reminder_recipient_with_enrollment(uuid) to authenticated;
create function public.prepare_my_sms_verification(
    p_practice_id uuid,
    p_request_id uuid,
    p_phone text,
    p_expected_version integer,
    p_change_confirmed boolean,
    p_otp_permission boolean,
    p_account_sid text,
    p_messaging_service_sid text,
    p_verify_service_sid text
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.prepare_my_sms_verification(p_practice_id, p_request_id, p_phone, p_expected_version, p_change_confirmed, p_otp_permission, p_account_sid, p_messaging_service_sid, p_verify_service_sid);
$$;
revoke all on function public.prepare_my_sms_verification(
    uuid, uuid, text, integer, boolean, boolean, text, text, text
),
private.prepare_my_sms_verification(
    uuid, uuid, text, integer, boolean, boolean, text, text, text
) from public,
anon,
authenticated,
service_role;
grant execute on function public.prepare_my_sms_verification(
    uuid, uuid, text, integer, boolean, boolean, text, text, text
),
private.prepare_my_sms_verification(
    uuid, uuid, text, integer, boolean, boolean, text, text, text
) to authenticated;
create function public.consent_my_practice_sms(
    p_practice_id uuid, p_request_id uuid, p_expected_version integer, p_consent boolean
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.consent_my_practice_sms(p_practice_id, p_request_id, p_expected_version, p_consent);
$$;
revoke all on function public.consent_my_practice_sms(uuid, uuid, integer, boolean),
private.consent_my_practice_sms(uuid, uuid, integer, boolean) from public,
anon,
authenticated,
service_role;
grant execute on function public.consent_my_practice_sms(uuid, uuid, integer, boolean),
private.consent_my_practice_sms(uuid, uuid, integer, boolean) to authenticated;
create function public.withdraw_my_practice_sms(p_practice_id uuid, p_request_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.withdraw_my_practice_sms(p_practice_id, p_request_id);
$$;
revoke all on function public.withdraw_my_practice_sms(uuid, uuid),
private.withdraw_my_practice_sms(uuid, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.withdraw_my_practice_sms(uuid, uuid),
private.withdraw_my_practice_sms(uuid, uuid) to authenticated;
create function public.claim_sms_verification_send(
    p_practice_id uuid, p_actor_id uuid, p_request_id uuid
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.claim_sms_verification_send(p_practice_id, p_actor_id, p_request_id);
$$;
revoke all on function public.claim_sms_verification_send(uuid, uuid, uuid),
private.claim_sms_verification_send(uuid, uuid, uuid) from public,
anon,
authenticated,
service_role;
grant execute on function public.claim_sms_verification_send(uuid, uuid, uuid),
private.claim_sms_verification_send(uuid, uuid, uuid) to service_role;
create function public.record_sms_verification_send(
    p_practice_id uuid, p_actor_id uuid, p_request_id uuid, p_claim_token uuid, p_outcome jsonb
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.record_sms_verification_send(p_practice_id, p_actor_id, p_request_id, p_claim_token, p_outcome);
$$;
revoke all on function public.record_sms_verification_send(uuid, uuid, uuid, uuid, jsonb),
private.record_sms_verification_send(uuid, uuid, uuid, uuid, jsonb) from public,
anon,
authenticated,
service_role;
grant execute on function public.record_sms_verification_send(uuid, uuid, uuid, uuid, jsonb),
private.record_sms_verification_send(uuid, uuid, uuid, uuid, jsonb) to service_role;
create function public.claim_sms_verification_check(
    p_practice_id uuid,
    p_actor_id uuid,
    p_request_id uuid,
    p_challenge_id uuid,
    p_expected_version integer
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.claim_sms_verification_check(p_practice_id, p_actor_id, p_request_id, p_challenge_id, p_expected_version);
$$;
revoke all on function public.claim_sms_verification_check(uuid, uuid, uuid, uuid, integer),
private.claim_sms_verification_check(uuid, uuid, uuid, uuid, integer) from public,
anon,
authenticated,
service_role;
grant execute on function public.claim_sms_verification_check(uuid, uuid, uuid, uuid, integer),
private.claim_sms_verification_check(uuid, uuid, uuid, uuid, integer) to service_role;
create function public.record_sms_verification_check(
    p_practice_id uuid, p_actor_id uuid, p_request_id uuid, p_claim_token uuid, p_outcome jsonb
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.record_sms_verification_check(p_practice_id, p_actor_id, p_request_id, p_claim_token, p_outcome);
$$;
revoke all on function public.record_sms_verification_check(uuid, uuid, uuid, uuid, jsonb),
private.record_sms_verification_check(uuid, uuid, uuid, uuid, jsonb) from public,
anon,
authenticated,
service_role;
grant execute on function public.record_sms_verification_check(uuid, uuid, uuid, uuid, jsonb),
private.record_sms_verification_check(uuid, uuid, uuid, uuid, jsonb) to service_role;
create function public.apply_sms_provider_opt_out(
    p_account_sid text,
    p_messaging_service_sid text,
    p_phone text,
    p_message_sid text,
    p_opt_out_type text
) returns jsonb
language sql volatile security invoker set search_path = '' as $$
    select private.apply_sms_provider_opt_out(p_account_sid, p_messaging_service_sid, p_phone, p_message_sid, p_opt_out_type);
$$;
revoke all on function public.apply_sms_provider_opt_out(text, text, text, text, text),
private.apply_sms_provider_opt_out(text, text, text, text, text) from public,
anon,
authenticated,
service_role;
grant execute on function public.apply_sms_provider_opt_out(text, text, text, text, text),
private.apply_sms_provider_opt_out(text, text, text, text, text) to service_role;
