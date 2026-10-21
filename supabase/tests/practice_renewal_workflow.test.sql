begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);
select
    is((
        select count(*)::integer
        from pg_class as c
        inner join pg_namespace as n on c.relnamespace = n.oid
        where
            n.nspname = 'private' and c.relname in (
                'credential_renewal_links', 'credential_renewal_workflows',
                'renewal_change_requests', 'renewal_audit_events'
            ) and c.relrowsecurity
    ), 4,
    'RW10 renewal RLS inventory');
select ok(not exists (
    select 1
    from information_schema.table_privileges
    where
        table_schema = 'private'
        and table_name in (
            'credential_renewal_links', 'credential_renewal_workflows', 'renewal_change_requests',
            'renewal_audit_events'
        ) and grantee in ('anon', 'authenticated', 'service_role'
        )
),
'RW05 renewal storage private');
select is((
    select count(*)::integer from pg_constraint
    where conrelid in (
        'private.credential_renewal_links'::regclass,
        'private.credential_renewal_workflows'::regclass,
        'private.renewal_change_requests'::regclass, 'private.renewal_audit_events'::regclass
    )
    and contype = 'f' and confdeltype = 'r'
), 7, 'RW05 renewal restrictive foreign keys');
select is((
    select count(*)::integer from pg_constraint
    where conrelid in (
        'private.renewal_change_requests'::regclass, 'private.renewal_audit_events'::regclass
    )
    and contype = 'f' and array_length(conkey, 1) = 3
), 2, 'RW05 renewal full cycle credential binding');
select ok(exists (
    select 1
    from pg_constraint
    where
        conrelid = 'private.renewal_change_requests'::regclass
        and contype = 'u' and array_length(conkey, 1) = 3
), 'RW06 renewal actor request uniqueness');
select ok(exists (
    select 1
    from pg_constraint
    where
        conrelid = 'private.credential_renewal_workflows'::regclass
        and conname = 'renewal_review_shape'
), 'RW03 renewal paired review facts');
select ok(exists (
    select 1
    from pg_constraint
    where
        conrelid = 'private.credential_renewal_links'::regclass
        and pg_get_constraintdef(oid) like '%renewal_url%'
), 'RW09 renewal URL constraint');
select ok(
    not has_function_privilege('authenticated', 'private.renewal_url(text)', 'execute')
    and not has_function_privilege(
        'authenticated', 'private.renewal_projection(public.credentials)', 'execute'
    )
    and not has_function_privilege(
        'authenticated',
        'private.apply_renewal_change(uuid,uuid,uuid,integer,uuid,integer,integer,text,text)',
        'execute'
    ),
    'RW05 renewal raw helpers denied'
);
select
    is((
        select count(*)::integer
        from pg_proc as p
        inner join pg_namespace as n on p.pronamespace = n.oid
        where
            n.nspname = 'public' and p.proname in (
                'list_practice_register_with_renewal',
                'set_credential_renewal_link',
                'set_credential_renewal_progress',
                'acknowledge_credential_renewal'
            )
            and not p.prosecdef
    ), 4, 'RW05 renewal public wrappers invoker');
select
    is((
        select count(*)::integer
        from pg_proc as p
        inner join pg_namespace as n on p.pronamespace = n.oid
        where
            n.nspname = 'private' and p.proname in (
                'list_practice_register_with_renewal',
                'set_credential_renewal_link',
                'set_credential_renewal_progress',
                'acknowledge_credential_renewal'
            )
            and p.prosecdef and p.proconfig @> array['search_path=""']
    ), 4,
    'RW05 renewal private authority and empty path');
select ok(
    not has_function_privilege(
        'anon', 'public.list_practice_register_with_renewal(uuid,boolean)', 'execute'
    )
    and not has_function_privilege(
        'anon',
        'public.set_credential_renewal_link(uuid,uuid,uuid,integer,uuid,integer,integer,text)',
        'execute'
    )
    and not has_function_privilege(
        'anon',
        'public.set_credential_renewal_progress(uuid,uuid,uuid,integer,uuid,integer,integer,text)',
        'execute'
    )
    and not has_function_privilege(
        'anon',
        'public.acknowledge_credential_renewal(uuid,uuid,uuid,integer,uuid,integer,integer)',
        'execute'
    ),
    'RW05 renewal anonymous entry denied'
);
select ok(
    has_function_privilege(
        'authenticated', 'public.list_practice_register_with_renewal(uuid,boolean)', 'execute'
    )
    and has_function_privilege(
        'authenticated',
        'public.set_credential_renewal_link(uuid,uuid,uuid,integer,uuid,integer,integer,text)',
        'execute'
    )
    and has_function_privilege(
        'authenticated',
        'public.set_credential_renewal_progress(uuid,uuid,uuid,integer,uuid,integer,integer,text)',
        'execute'
    )
    and has_function_privilege(
        'authenticated',
        'public.acknowledge_credential_renewal(uuid,uuid,uuid,integer,uuid,integer,integer)',
        'execute'
    ),
    'RW05 renewal checked entries granted'
);
select is(
    private.renewal_url(' HTTPS://Board.example.test/renew?type=state#start '),
    'https://Board.example.test/renew?type=state#start', 'RW09 renewal normalized HTTPS'
);
select is(private.renewal_url('   '), null::text, 'RW01 renewal blank clears');
select throws_ok(
    $q$select private.renewal_url('javascript:alert(1)')$q$, '22023',
    'invalid renewal URL', 'RW09 renewal unsafe scheme rejected'
);
select throws_ok(
    $q$select private.renewal_url('https://user@board.example.test')$q$, '22023',
    'invalid renewal URL', 'RW09 renewal userinfo rejected'
);
select throws_ok(
    $q$select private.renewal_url('https://board.example.test/#one#two')$q$, '22023',
    'invalid renewal URL', 'RW09 renewal ambiguous fragment rejected'
);
select finish from finish();
rollback;
