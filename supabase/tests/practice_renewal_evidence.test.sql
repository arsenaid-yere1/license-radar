begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);
select is((
    select count(*)::integer
    from pg_tables
    where
        schemaname = 'private'
        and tablename in (
            'renewal_evidence', 'renewal_evidence_requests',
            'renewal_evidence_objects', 'renewal_evidence_audit_events'
        )
), 4,
'EV01 retained evidence table inventory');
select
    is((
        select count(*)::integer
        from pg_class as c
        inner join pg_namespace as n on c.relnamespace = n.oid
        where
            n.nspname = 'private' and c.relname in (
                'renewal_evidence', 'renewal_evidence_requests',
                'renewal_evidence_objects', 'renewal_evidence_audit_events'
            ) and c.relrowsecurity
    ), 4,
    'EV02 evidence private RLS inventory');
select
    is((
        select count(*)::integer
        from pg_proc as p
        inner join pg_namespace as n on p.pronamespace = n.oid
        where
            n.nspname = 'public' and p.proname in (
                'get_renewal_evidence', 'reserve_renewal_evidence',
                'remove_renewal_evidence',
                'claim_renewal_evidence_upload',
                'finalize_renewal_evidence_upload',
                'authorize_renewal_evidence_download', 'record_renewal_evidence_download',
                'claim_renewal_evidence_cleanup', 'record_renewal_evidence_cleanup'
            ) and not p.prosecdef
    ), 9,
    'EV02 evidence invoker wrappers');
select
    is((
        select count(*)::integer
        from pg_proc as p
        inner join pg_namespace as n on p.pronamespace = n.oid
        where
            n.nspname = 'private' and p.proname in (
                'get_renewal_evidence', 'reserve_renewal_evidence',
                'remove_renewal_evidence',
                'claim_renewal_evidence_upload',
                'finalize_renewal_evidence_upload',
                'authorize_renewal_evidence_download', 'record_renewal_evidence_download',
                'claim_renewal_evidence_cleanup', 'record_renewal_evidence_cleanup'
            )
            and p.prosecdef and p.proconfig @> array['search_path=""']
    ), 9,
    'EV02 checked implementations use empty search path');
select ok(exists (
    select 1
    from pg_policies
    where
        schemaname = 'storage' and tablename = 'objects'
        and policyname = 'renewal_evidence_gateway_only' and permissive = 'RESTRICTIVE'
        and cmd = 'ALL' and qual like '%renewal-evidence%' and with_check like '%renewal-evidence%'
),
'EV05 ordinary direct Storage access is restricted');
select ok(not exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'private' and table_name in (
        'renewal_evidence', 'renewal_evidence_requests',
        'renewal_evidence_objects', 'renewal_evidence_audit_events'
    ) and grantee in ('anon', 'authenticated', 'service_role')
), 'EV02 no direct evidence table access');
select is((
    select count(*)::integer from pg_constraint
    where conrelid in (
        'private.renewal_evidence'::regclass, 'private.renewal_evidence_audit_events'::regclass
    ) and contype = 'f' and array_length(conkey, 1) >= 3 and confdeltype = 'r'
), 2,
'EV01 full retained cycle and audit binding');
select ok(exists (
    select 1 from pg_constraint
    where
        conrelid = 'private.renewal_evidence_requests'::regclass and contype = 'f'
        and array_length(conkey, 1) = 2 and confdeltype = 'r'
),
'EV01 receipt practice binding');
select
    ok(not exists (
        select 1 from pg_proc as p inner join pg_namespace as n on p.pronamespace = n.oid
        where
            n.nspname = 'public' and p.proname like '%renewal_evidence%'
            and has_function_privilege('anon', p.oid, 'execute')
    ), 'EV02 anonymous evidence entries denied');
select
    ok(not exists (
        select 1 from pg_proc as p inner join pg_namespace as n on p.pronamespace = n.oid
        where
            n.nspname = 'public' and p.proname in (
                'claim_renewal_evidence_upload',
                'finalize_renewal_evidence_upload', 'authorize_renewal_evidence_download',
                'record_renewal_evidence_download',
                'claim_renewal_evidence_cleanup',
                'record_renewal_evidence_cleanup'
            )
            and has_function_privilege('authenticated', p.oid, 'execute')
    ), 'EV02 service-only evidence entries denied');
select
    ok(not exists (
        select 1 from pg_proc as p inner join pg_namespace as n on p.pronamespace = n.oid
        where
            n.nspname = 'private'
            and p.proname in ('require_evidence_actor', 'evidence_event', 'evidence_projection')
            and (
                has_function_privilege('authenticated', p.oid, 'execute')
                or has_function_privilege('service_role', p.oid, 'execute')
            )
    ), 'EV02 evidence internal helpers denied');
select ok(exists (
    select 1
    from pg_indexes
    where
        schemaname = 'private'
        and indexname = 'renewal_evidence_objects_evidence_id_key'
), 'EV04 one immutable physical object per attachment');
select finish();
rollback;
