begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);
select is((
    select count(*)::integer from pg_class
    where oid in (
        'public.clinicians'::regclass,
        'public.credentials'::regclass,
        'public.policy_coverage'::regclass,
        'private.register_create_requests'::regclass, 'private.register_audit_events'::regclass
    ) and relrowsecurity
), 5, 'A01 register RLS');
select ok(
    has_table_privilege('authenticated', 'public.clinicians', 'select')
    and has_table_privilege('authenticated', 'public.credentials', 'select')
    and has_table_privilege('authenticated', 'public.policy_coverage', 'select'),
    'A01 register authenticated read grants'
);
select ok(
    not has_table_privilege('authenticated', 'public.clinicians', 'insert,update,delete')
    and not has_table_privilege('authenticated', 'public.credentials', 'insert,update,delete')
    and not has_table_privilege('authenticated', 'public.policy_coverage', 'insert,update,delete'),
    'A01 register direct DML denied'
);
select ok(
    not has_table_privilege('authenticated', 'private.register_audit_events', 'select')
    and not has_table_privilege('authenticated', 'private.register_create_requests', 'select'),
    'A01 register private storage denied'
);
select ok(
    not has_function_privilege('anon', 'public.list_practice_register(uuid)', 'execute')
    and not has_function_privilege(
        'anon', 'public.create_practice_clinician(uuid,uuid,text)', 'execute'
    )
    and not has_function_privilege(
        'anon', 'public.create_practice_credential(uuid,uuid,text,text,text,uuid,uuid[])', 'execute'
    ), 'A01 register anonymous RPC denied'
);
select ok(not has_function_privilege(
    'authenticated', 'private.require_register_member(uuid,boolean)', 'execute'
) and not has_function_privilege(
    'authenticated', 'private.register_replay(uuid,uuid,text,jsonb)', 'execute'
) and not has_function_privilege(
    'authenticated',
    'private.finish_register_create(uuid,uuid,text,jsonb,uuid,uuid,jsonb)',
    'execute'
), 'A01 register helpers denied');
select is((
    select count(*)::integer from pg_proc
    where oid in (
        'public.list_practice_register(uuid)'::regprocedure,
        'public.create_practice_clinician(uuid,uuid,text)'::regprocedure,
        'public.create_practice_credential(uuid,uuid,text,text,text,uuid,uuid[])'::regprocedure
    ) and not prosecdef
), 3, 'A01 register wrappers are invokers');
select is((
    select count(*)::integer from pg_constraint
    where conrelid in (
        'public.clinicians'::regclass,
        'public.credentials'::regclass,
        'public.policy_coverage'::regclass,
        'private.register_create_requests'::regclass, 'private.register_audit_events'::regclass
    ) and contype = 'f' and confdeltype = 'r'
), 12, 'G07 register foreign keys restrict deletion');
select is((
    select count(*)::integer from pg_constraint
    where conrelid in (
        'public.credentials'::regclass, 'public.policy_coverage'::regclass,
        'private.register_audit_events'::regclass
    ) and contype = 'f' and array_length(conkey, 1) >= 2
), 5, 'G07 register composite references');
select ok(exists (
    select 1 from pg_constraint
    where
        conrelid = 'private.register_create_requests'::regclass and contype = 'u'
        and array_length(conkey, 1) = 3
), 'G10 register caller scoped request uniqueness');
select ok(exists (
    select 1 from pg_constraint
    where
        conrelid = 'public.policy_coverage'::regclass and contype = 'p'
        and array_length(conkey, 1) = 3
), 'G08 register coverage uniqueness');
select is((
    select count(*)::integer from pg_attribute
    where
        attrelid = 'public.policy_coverage'::regclass
        and attname in ('type', 'owner_kind') and attnotnull
),
2, 'G08 register discriminator NULL defense');
insert into auth.users (id, email, email_confirmed_at) values (
    '30000000-0000-4000-8000-000000000001', 'fixture-register-sql@example.test', clock_timestamp()
);
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
create temporary table register_fixture as
select (public.create_practice('Register fixture', 'UTC')).id as practice_id;
select lives_ok($q$select public.create_practice_clinician(
    (select register_fixture.practice_id from register_fixture),
    '30000000-0000-4000-8000-000000000002', ' Dr. Rivera ')$q$, 'G02 register create clinician');
select is((
    select name from public.clinicians
    where practice_id = (select register_fixture.practice_id from register_fixture)
),
'Dr. Rivera', 'G09 register normalized name');
select lives_ok(
    $q$select public.create_practice_credential(
    (select register_fixture.practice_id from register_fixture),
    '30000000-0000-4000-8000-000000000003', 'Policy', 'malpractice_policy', 'practice', null,
    array[(select id from public.clinicians
        where practice_id = (select register_fixture.practice_id from register_fixture))])$q$,
    'G05 register create policy'
);
select is(jsonb_array_length(public.list_practice_register(
    (select register_fixture.practice_id from register_fixture)
) -> 'credentials'), 1,
'G05 register one policy projection');
select is((
    select count(*)::integer from private.register_audit_events
    where practice_id = (select register_fixture.practice_id from register_fixture)
), 2,
'G13 register exact audit count');
select is((
    select count(*)::integer from private.register_create_requests
    where practice_id = (select register_fixture.practice_id from register_fixture)
), 2,
'G10 register exact receipt count');
select throws_ok(
    $q$update public.credentials set owner_clinician_id = null, owner_kind = 'clinician'
    where practice_id = (select register_fixture.practice_id from register_fixture)$q$,
    '23514', null, 'G07 register owner shape constraint'
);
select throws_ok(
    $q$update public.policy_coverage set type = null
    where practice_id = (select register_fixture.practice_id from register_fixture)$q$,
    '23502', null, 'G08 register NULL discriminator rejected'
);
select throws_ok(
    $q$update public.clinicians set name = '  '
    where practice_id = (select register_fixture.practice_id from register_fixture)$q$,
    '23514', null, 'G09 register blank name constraint'
);
select throws_ok(
    $q$update public.clinicians set version = 0
    where practice_id = (select register_fixture.practice_id from register_fixture)$q$,
    '23514', null, 'G09 register positive version constraint'
);
select finish from finish();
rollback;
