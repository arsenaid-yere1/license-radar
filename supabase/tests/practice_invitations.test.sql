begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);
select
    ok((
        select relrowsecurity from pg_class
        where oid = 'private.practice_invitations'::regclass
    ), 'N04 invitation RLS');
select ok(not has_table_privilege(
    'authenticated',
    'private.practice_invitations',
    'select,insert,update,delete'
),
'N04 private invitations denied');
select ok(not has_function_privilege(
    'authenticated',
    'private.invitation_for_actor(text)',
    'execute'
),
'N04 internal invitation helper denied');
select ok(not has_function_privilege(
    'authenticated',
    'private.audit_invitation()',
    'execute'
),
'N05 invitation trigger denied');
select ok(not has_function_privilege(
    'anon',
    'public.accept_practice_invitation(text)',
    'execute'
),
'S33 anonymous accept denied');
select ok(has_function_privilege(
    'authenticated',
    'public.accept_practice_invitation(text)',
    'execute'
),
'S19 authenticated accept grant');
select
    ok(not (
        select prosecdef from pg_proc
        where oid = 'public.accept_practice_invitation(text)'::regprocedure
    ), 'N04 public accept invoker');
select is(
    private.canonical_invitation_email('  Manager+Renewals@Example.test  '),
    'manager+renewals@example.test',
    'S10 ASCII canonicalization'
);
select throws_ok(
    $q$select private.canonical_invitation_email(E'\ta@example.test')$q$,
    '23514',
    null,
    'S09 tab rejected'
);
select throws_ok(
    $q$select private.canonical_invitation_email('é@example.test')$q$,
    '23514',
    null,
    'S09 non ASCII rejected'
);
select
    is((
        select count(*)::integer from information_schema.columns
        where
            table_schema = 'private'
            and table_name = 'practice_invitations'
            and column_name in ('token', 'raw_token')
    ), 0, 'N04 no raw token column');
select
    ok((
        select indisunique and indpred is not null from pg_index
        where indexrelid = to_regclass('private.practice_invitations_one_pending_email')
    ), 'S11 pending email unique');
insert into auth.users (id, email, email_confirmed_at) values
('20000000-0000-0000-0000-000000000001', 'fixture-sql-admin@example.test', clock_timestamp()),
('20000000-0000-0000-0000-000000000002', 'sql-fixture@example.test', clock_timestamp());
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.create_practice('Cedar Clinic', 'UTC');
select is((public.create_practice_invitation(
    (select id from public.practices),
    'sql-fixture@example.test',
    'manager',
    repeat(
        '1',
        64
    )
) ->> 'status'),
'success',
'S08 invitation created');
select is((public.create_practice_invitation(
    (select id from public.practices),
    'sql-fixture@example.test',
    'viewer',
    repeat(
        '2',
        64
    )
) ->> 'status'),
'invite-exists',
'S11 duplicate denied');
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select is((public.preview_practice_invitation(repeat(
    '1',
    64
)) ->> 'role'),
'manager',
'S19 confirmed matching preview');
select is((public.accept_practice_invitation(repeat(
    '1',
    64
)) ->> 'status'),
'success',
'S19 explicit accept');
reset role;
select finish from finish();
rollback;
