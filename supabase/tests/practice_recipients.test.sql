begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);
select ok((
    select relrowsecurity from pg_class
    where oid = 'private.practice_reminder_settings'::regclass
), 'R11 settings RLS');
select ok((
    select relrowsecurity from pg_class
    where oid = 'private.practice_recipient_events'::regclass
), 'R11 recipient audit RLS');
select
    ok(not has_table_privilege(
        'authenticated',
        'private.practice_reminder_settings',
        'select'
    ),
    'R11 settings denied');
select
    ok(not has_table_privilege(
        'authenticated',
        'private.practice_recipient_events',
        'select'
    ),
    'R11 recipient audit denied');
select
    ok(not has_table_privilege(
        'anon',
        'private.practice_reminder_settings',
        'select'
    ),
    'R11 anonymous storage denied');
select
    ok(not has_function_privilege(
        'anon',
        'public.get_practice_reminder_recipient(uuid)',
        'execute'
    ),
    'R11 anonymous read denied');
select
    ok(not has_function_privilege(
        'anon',
        'public.set_practice_reminder_recipient(uuid,uuid,integer)',
        'execute'
    ),
    'R11 anonymous assignment denied');
select
    ok(has_function_privilege(
        'authenticated',
        'public.set_practice_reminder_recipient(uuid,uuid,integer)',
        'execute'
    ),
    'R11 authenticated wrapper granted');
select
    ok(not has_function_privilege(
        'authenticated',
        'private.change_reminder_recipient(uuid,uuid,text)',
        'execute'
    )
    and not has_function_privilege(
        'authenticated',
        'private.invalidate_reminder_recipient(uuid,uuid,text)',
        'execute'
    )
    and not has_function_privilege(
        'authenticated',
        'private.require_recipient_member(uuid,boolean)',
        'execute'
    ),
    'R11 internal helpers denied');
select is((
    select count(*)::integer from pg_proc
    where
        oid in (
            'public.get_practice_reminder_recipient(uuid)'::regprocedure,
            'public.set_practice_reminder_recipient(uuid,uuid,integer)'::regprocedure
        )
        and not prosecdef
), 2, 'R11 wrappers are invokers');
select is((
    select count(*)::integer from pg_constraint
    where
        conrelid in (
            'private.practice_reminder_settings'::regclass,
            'private.practice_recipient_events'::regclass
        )
        and contype = 'f'
        and confdeltype = 'r'
), 6, 'R12 recipient foreign keys restrict deletion');
select is((
    select count(*)::integer from pg_constraint
    where
        conrelid in (
            'private.practice_reminder_settings'::regclass,
            'private.practice_recipient_events'::regclass
        )
        and contype = 'f'
        and array_length(conkey, 1) = 2
        and confrelid = 'public.practice_memberships'::regclass
), 3, 'R12 composite tenant references');
insert into auth.users (id, email, email_confirmed_at) values (
    '20000000-0000-4000-8000-000000000001', 'recipient-sql-fixture@example.test', clock_timestamp()
);
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select
    lives_ok(
        $q$select public.create_practice('Recipient fixture','UTC')$q$,
        'R10 recipient initialization'
    );
select
    is(
        (
            select (public.get_practice_reminder_recipient(id) ->> 'version')::integer
            from public.practices
        ),
        1,
        'R10 initial version'
    );
select
    is(
        (select public.get_practice_reminder_recipient(id) ->> 'readiness' from public.practices),
        'no-recipient',
        'R10 initially unassigned'
    );
select
    lives_ok(
        $q$select public.set_practice_reminder_recipient(
        (select id from public.practices),
        (select id from public.practice_memberships),1)$q$,
        'R04 explicit assignment'
    );
select
    is(
        (
            select (public.get_practice_reminder_recipient(id) ->> 'ready')::boolean
            from public.practices
        ),
        false,
        'R04 SMS remains pending'
    );
reset role;
select is((
    select count(*)::integer from private.practice_recipient_events
    where actor_user_id = '20000000-0000-4000-8000-000000000001'
), 1, 'R04 exactly one assignment audit');
select
    throws_ok(
        $q$insert into private.practice_recipient_events
        (practice_id,actor_user_id,operation,before_version,after_version)
        select practice_id,actor_user_id,'assigned',2,3
        from private.practice_recipient_events
        where actor_user_id='20000000-0000-4000-8000-000000000001'$q$,
        '23514',
        null,
        'R12 invalid audit shape rejected'
    );
select
    throws_ok(
        $q$update private.practice_reminder_settings set version=0
        where practice_id in (select practice_id from public.practice_memberships
        where user_id='20000000-0000-4000-8000-000000000001')$q$,
        '23514',
        null,
        'R12 positive version storage'
    );
select finish from finish();
rollback;
