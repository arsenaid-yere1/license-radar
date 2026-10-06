begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);
select ok(
    (
        select relrowsecurity from pg_class
        where oid = 'public.credential_cycles'::regclass
    ),
    'D10 cycle RLS'
);
select ok(
    has_table_privilege('authenticated', 'public.credential_cycles', 'select'),
    'D10 cycle read grant'
);
select ok(
    not has_table_privilege(
        'authenticated', 'public.credential_cycles', 'insert,update,delete,truncate'
    ),
    'D10 cycle DML denied'
);
select ok(
    not has_table_privilege('anon', 'public.credential_cycles', 'select'),
    'D10 cycle anonymous denied'
);
select ok(
    not has_function_privilege('authenticated', 'private.credential_date(text)', 'execute')
    and not has_function_privilege(
        'authenticated', 'private.initialize_credential_cycle()', 'execute'
    ),
    'D10 date helpers denied'
);
select ok(not has_function_privilege(
    'anon',
    'public.create_practice_credential_with_details(uuid,uuid,text,text,text,uuid,uuid[],'
    || 'text,text,text,text)',
    'execute'
), 'D10 detailed anonymous denied');
select ok(not (
    select prosecdef
    from pg_proc
    where
        oid
        = (
            'public.create_practice_credential_with_details(uuid,uuid,text,text,text,uuid,uuid[],'
            || 'text,text,text,text)'
        )::regprocedure
),
'D10 detailed wrapper invoker');
select is((
    select count(*)::integer from pg_constraint
    where conrelid = 'public.credential_cycles'::regclass and contype = 'f' and confdeltype = 'r'
),
2, 'D10 cycle restrictive foreign keys');
select is((
    select count(*)::integer from pg_constraint
    where
        conrelid = 'public.credential_cycles'::regclass and contype = 'f'
        and array_length(conkey, 1) = 2
), 1, 'D10 cycle composite reference');
select ok(exists (
    select 1
    from pg_trigger
    where
        tgrelid = 'public.credentials'::regclass
        and tgname = 'initialize_credential_cycle' and not tgisinternal
), 'D10 initial cycle trigger');
insert into auth.users (id, email, email_confirmed_at) values (
    '40000000-0000-4000-8000-000000000001', 'fixture-date-sql@example.test', clock_timestamp()
);
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
create temporary table date_fixture as
select (public.create_practice('Date fixture', 'UTC')).id as practice_id;
create temporary table date_record as
select public.create_practice_credential_with_details(
    (select date_fixture.practice_id from date_fixture), '40000000-0000-4000-8000-000000000002',
    'Policy', 'malpractice_policy', 'practice', null, '{}'::uuid[],
    ' Insurer ', ' CA ', '2028-02-29', '2028-02-01'
) as result;
select is((select result ->> 'status' from date_record), 'success', 'D01 detailed success');
select is((
    select end_date::text from public.credential_cycles
    where practice_id = (select date_fixture.practice_id from date_fixture)
), '2028-02-29', 'D03 stored date');
select is((
    select count(*)::integer from public.credential_cycles
    where practice_id = (select date_fixture.practice_id from date_fixture)
), 1, 'D01 single initial cycle');
select throws_ok(
    $q$update public.credential_cycles set date_revision = 0
    where practice_id = (select date_fixture.practice_id from date_fixture)$q$,
    '23514', null, 'D10 positive date revision'
);
select throws_ok(
    $q$update public.credential_cycles set cycle_number = 0
    where practice_id = (select date_fixture.practice_id from date_fixture)$q$,
    '23514', null, 'D10 positive cycle number'
);
select throws_ok(
    $q$update public.credential_cycles set end_date = 'infinity'
    where practice_id = (select date_fixture.practice_id from date_fixture)$q$,
    '23514', null, 'D10 end date range'
);
select throws_ok(
    $q$update public.credential_cycles set action_deadline = '-infinity'
    where practice_id = (select date_fixture.practice_id from date_fixture)$q$,
    '23514', null, 'D10 action date range'
);
select throws_ok(
    $q$update public.credential_cycles set action_deadline = end_date
    where practice_id = (select date_fixture.practice_id from date_fixture)$q$,
    '23514', null, 'D10 strict earlier ordering'
);
select throws_ok(
    $q$insert into public.credential_cycles(practice_id, credential_id)
    select practice_id, credential_id from public.credential_cycles
    where practice_id = (select date_fixture.practice_id from date_fixture)$q$,
    '23505', null, 'D10 initial cycle uniqueness'
);
select throws_ok(
    $q$update public.credentials set issuer = ' '
    where practice_id = (select date_fixture.practice_id from date_fixture)$q$,
    '23514', null, 'D10 issuer constraint'
);
select throws_ok(
    $q$update public.credentials set jurisdiction = ' '
    where practice_id = (select date_fixture.practice_id from date_fixture)$q$,
    '23514', null, 'D10 jurisdiction constraint'
);
select is((
    select after_data from private.register_audit_events
    where practice_id = (select date_fixture.practice_id from date_fixture)
),
(select result -> 'credential' from date_record), 'D01 final date audit snapshot');
select finish from finish();
rollback;
