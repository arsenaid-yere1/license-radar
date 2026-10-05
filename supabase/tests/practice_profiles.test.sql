begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);
select ok((
    select relrowsecurity from pg_class
    where oid = 'public.practices'::regclass
), 'S17 RLS enabled');
select ok((
    select relrowsecurity from pg_class
    where oid = 'private.practice_audit_events'::regclass
), 'S23 audit RLS enabled');
select ok(not has_table_privilege('anon', 'public.practices', 'select'), 'S18 anon read denied');
select
    ok(
        not has_table_privilege('authenticated', 'public.practices', 'delete'),
        'S18 owner cannot delete'
    );
select
    ok(
        not has_column_privilege('authenticated', 'public.practices', 'owner_user_id', 'update'),
        'S18 owner immutable'
    );
select
    ok(
        not has_column_privilege('authenticated', 'public.practices', 'version', 'update'),
        'S18 version database managed'
    );
select
    ok(not has_table_privilege(
        'authenticated',
        'private.practice_audit_events',
        'select'
    ),
    'S23 audit denied');
select
    ok(
        not has_function_privilege('authenticated', 'private.audit_practice()', 'execute'),
        'S23 trigger not callable'
    );
select is((
    select count(*)::integer from pg_constraint
    where
        conrelid = 'public.practices'::regclass
        and contype = 'f' and confrelid = 'auth.users'::regclass
        and confdeltype = 'r'
), 1, 'N04 owner foreign key restricts deletion');
select is((
    select count(*)::integer from pg_constraint
    where
        conrelid = 'private.practice_audit_events'::regclass
        and contype = 'f' and confdeltype = 'r'
        and confrelid in ('public.practices'::regclass, 'auth.users'::regclass)
), 2, 'N04 audit practice and actor foreign keys restrict deletion');
insert into auth.users (id, email, email_confirmed_at) values (
    '10000000-0000-0000-0000-000000000001', 'sql-fixture@example.test', clock_timestamp()
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select
    lives_ok(
        $q$select public.create_practice('  Cedar  ', 'UTC')$q$,
        'S08 valid create'
    );
select is((select name from public.practices), 'Cedar', 'S08 trim in storage');
select is((select version from public.practices), 1, 'S21 initial version');
select
    throws_ok(
        $q$select public.update_practice((select id from public.practices),
        '',
        'UTC',
        (select version from public.practices))$q$,

        '23514', null,
        'S09 blank rejected'
    );
select
    throws_ok(
        $q$select public.update_practice((select id from public.practices),
        repeat('😀',
        121),
        'UTC',
        (select version from public.practices))$q$,

        '23514', null,
        'S10 overlong Unicode rejected'
    );
select
    lives_ok(
        $q$select public.update_practice((select id from public.practices),
        repeat('😀',
        120),
        'UTC',
        (select version from public.practices))$q$,

        'S10 boundary Unicode accepted'
    );
select
    throws_ok(
        $q$select public.update_practice((select id from public.practices),
        'Cedar',
        'Mars/Olympus',
        (select version from public.practices))$q$,

        '23514', null,
        'S11 invalid zone rejected'
    );
select
    throws_ok(
        $q$insert into public.practices (name, timezone) values ('Duplicate', 'UTC')$q$,
        '42501', null,
        'S33 direct creation denied'
    );
reset role;
select is((
    select count(*)::integer from private.practice_audit_events
    where actor_user_id = '10000000-0000-0000-0000-000000000001'
), 2, 'S21 only successful writes audited');
select is((
    select version from public.practices
    where owner_user_id = '10000000-0000-0000-0000-000000000001'
), 2, 'S21 version increases');
select finish from finish();
rollback;
