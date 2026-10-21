begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);
select has_column('public', 'credentials', 'record_number', 'RN01 record number column');
select col_type_is('public', 'credentials', 'record_number', 'text', 'RN02 number is text');
select col_is_null('public', 'credentials', 'record_number', 'RN01 number optional');
select ok(exists (
    select 1 from pg_constraint
    where conrelid = 'public.credentials'::regclass and conname = 'credentials_record_number_check'
), 'RN02 number storage invariant');
select ok(
    (
        select relrowsecurity from pg_class
        where oid = 'public.credentials'::regclass
    ),
    'RN04 credential RLS retained'
);
select ok(
    not has_table_privilege('authenticated', 'public.credentials', 'insert,update,delete'),
    'RN04 direct writes denied'
);
select ok(not has_function_privilege(
    'authenticated',
    'private.credential_record_number(text)', 'execute'
), 'RN04 raw helper denied');
select
    is((
        select count(*)::integer
        from pg_proc as p
        inner join pg_namespace as n on p.pronamespace = n.oid
        where
            n.nspname = 'public' and p.proname in (
                'create_practice_credential_with_number',
                'update_practice_credential_with_number'
            ) and not p.prosecdef
    ), 2, 'RN04 public wrappers invoker');
select
    is((
        select count(*)::integer
        from pg_proc as p
        inner join pg_namespace as n on p.pronamespace = n.oid
        where
            n.nspname = 'private' and p.proname in (
                'create_practice_credential_with_number',
                'update_practice_credential_with_number'
            ) and p.prosecdef
    ), 2, 'RN04 private entries definer');
select
    is((
        select count(*)::integer
        from pg_proc as p
        inner join pg_namespace as n on p.pronamespace = n.oid
        where
            n.nspname in ('public', 'private') and p.proname in (
                'create_practice_credential_with_number',
                'update_practice_credential_with_number'
            ) and has_function_privilege('anon', p.oid, 'execute')
    ), 0, 'RN04 anonymous entries denied');
select is(
    private.credential_record_number(' 000Ab-12 / 陈 '), '000Ab-12 / 陈',
    'RN02 normalize preserves author text'
);
select throws_ok(
    $q$select private.credential_record_number('A' || chr(133) || 'B')$q$,
    '22023', 'invalid record number', 'RN02 embedded C1 control denied'
);
select finish from finish();
rollback;
