begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);
select is((
    select count(*)::integer from pg_class as c
    inner join pg_namespace as n on c.relnamespace = n.oid
    where n.nspname = 'private' and c.relname in (
        'credential_renewal_completions', 'renewal_completion_requests'
    ) and c.relrowsecurity
), 2, 'RC07 completion RLS inventory');
select ok(not exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'private' and table_name in (
        'credential_renewal_completions', 'renewal_completion_requests'
    ) and grantee in ('anon', 'authenticated', 'service_role')
), 'RC07 completion private storage');
select is((
    select count(*)::integer from pg_constraint
    where conrelid in (
        'private.credential_renewal_completions'::regclass,
        'private.renewal_completion_requests'::regclass
    ) and contype = 'f' and confdeltype = 'r'
), 6, 'RC07 completion restrictive foreign keys');
select is((
    select count(*)::integer from pg_constraint
    where conrelid in (
        'private.credential_renewal_completions'::regclass,
        'private.renewal_completion_requests'::regclass
    ) and contype = 'f' and array_length(conkey, 1) = 3
), 4, 'RC07 completion full cycle binding');
select is((
    select count(*)::integer from pg_constraint
    where
        conrelid = 'private.credential_renewal_completions'::regclass
        and contype in ('p', 'u')
), 2, 'RC03 predecessor and successor uniqueness');
select ok(exists (
    select 1 from pg_constraint
    where
        conrelid = 'private.renewal_completion_requests'::regclass
        and contype = 'p' and array_length(conkey, 1) = 3
), 'RC03 actor request uniqueness');
select is((
    select count(*)::integer from pg_proc as p
    inner join pg_namespace as n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname in (
        'complete_credential_renewal', 'get_credential_renewal_history'
    ) and not p.prosecdef
), 2, 'RC07 completion wrappers invoker');
select is((
    select count(*)::integer from pg_proc as p
    inner join pg_namespace as n on p.pronamespace = n.oid
    where n.nspname = 'private' and p.proname in (
        'complete_credential_renewal', 'get_credential_renewal_history'
    ) and p.prosecdef and p.proconfig @> array['search_path=""']
), 2,
'RC07 completion private checked empty path');
select ok(not exists (
    select 1 from pg_proc as p
    inner join pg_namespace as n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname in (
        'complete_credential_renewal', 'get_credential_renewal_history'
    ) and has_function_privilege('anon', p.oid, 'execute')
), 'RC07 completion anonymous denial');
select ok(not exists (
    select 1 from pg_proc as p
    inner join pg_namespace as n on p.pronamespace = n.oid
    where n.nspname = 'private' and p.proname in (
        'current_credential_cycle', 'renewal_completion_clock', 'renewal_cycle_history'
    ) and has_function_privilege('authenticated', p.oid, 'execute')
), 'RC07 raw completion helpers denied');
select ok(exists (
    select 1 from pg_constraint
    where
        conrelid = 'private.renewal_audit_events'::regclass
        and conname = 'renewal_audit_events_operation_check'
        and pg_get_constraintdef(oid) like '%renewal-confirmed%'
), 'RC09 completion audit operation');
select ok(exists (
    select 1 from pg_indexes
    where
        schemaname = 'public' and indexname = 'credential_cycles_one_incomplete'
        and indexdef like '%WHERE (completed_at IS NULL)%'
), 'RC02 one incomplete cycle invariant');
select finish();
rollback;
