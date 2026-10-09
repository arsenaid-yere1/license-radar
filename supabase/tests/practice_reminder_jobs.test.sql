begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);
select
    is((
        select count(*)::integer
        from pg_class as c
        inner join pg_namespace as n on c.relnamespace = n.oid
        where
            n.nspname = 'private'
            and c.relkind = 'r'
            and c.relname like 'reminder_%'
            and c.relrowsecurity
    ),
    12, 'ER10 all email ledgers have RLS');
select ok(not exists (
    select 1 from information_schema.table_privileges
    where
        table_schema = 'private' and table_name like 'reminder_%'
        and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), 'ER10 no direct email storage access');
select ok(has_function_privilege(
    'authenticated',
    'public.get_email_reminder_schedule(uuid,text,uuid)',
    'execute'
),
'ER09 active readers have named projection');
select ok(not has_function_privilege(
    'anon',
    'public.get_email_reminder_schedule(uuid,text,uuid)',
    'execute'
),
'ER09 anonymous projection denied');
select ok(not has_function_privilege(
    'authenticated',
    'public.begin_email_reminder(uuid,uuid,jsonb)',
    'execute'
),
'ER10 ordinary callers cannot dispatch');
select ok(has_function_privilege(
    'service_role',
    'public.begin_email_reminder(uuid,uuid,jsonb)',
    'execute'
),
'ER10 named service dispatch');
select ok(not has_function_privilege(
    'service_role',
    'private.begin_email_reminder_at(uuid,uuid,jsonb,timestamptz)',
    'execute'
),
'ER01 service cannot forge clock');
select ok(not has_function_privilege(
    'authenticated',
    'private.email_reminder_context(uuid,uuid,text,timestamptz)',
    'execute'
),
'ER09 internal destination projection denied');
select ok(not (
    select prosecdef from pg_proc
    where oid = 'public.begin_email_reminder(uuid,uuid,jsonb)'::regprocedure
), 'ER10 public facade invoker');
select ok((
    select prosecdef and proconfig @> array['search_path=""'] from pg_proc
    where oid = 'private.track_reminder_email_account()'::regprocedure
), 'ER06 narrow Auth trigger definer has empty search path');
select is((
    select count(*)::integer
    from pg_constraint
    where
        contype = 'f'
        and conrelid = 'private.reminder_email_account_state'::regclass
), 0, 'ER06 Auth bookkeeping has no domain/deletion FK');
select ok(exists (
    select 1
    from pg_index
    where
        indexrelid = to_regclass('private.reminder_message_attempts_cycle_id_user_id_channel_key')
        and indisunique
), 'ER07 consumed guard is cycle user channel, independent of membership and revision');
select is(
    private.reminder_target('2028-02-29', 'UTC'),
    '2027-12-31 09:00:00+00'::timestamptz,
    'ER02 deadline minus sixty calendar days'
);
select is(
    private.reminder_target('2012-02-28', 'Pacific/Apia'),
    null::timestamptz,
    'ER02 skipped local date rejected'
);
select is(
    private.reminder_next_window('2030-01-01 09:00+00', 'UTC', '2030-01-01 17:00+00'),
    '2030-01-02 09:00+00'::timestamptz, 'ER02 outage waits until next window'
);
select ok(exists (
    select 1
    from pg_trigger
    where
        tgname = 'track_reminder_email_account'
        and tgrelid = 'auth.users'::regclass and not tgisinternal
), 'ER06 app Auth trigger inventoried');
select ok(exists (
    select 1 from pg_index
    where
        indexrelid = to_regclass('public.credential_cycles_one_incomplete')
        and indisunique
        and indpred is not null
), 'ER18 only one incomplete cycle');
select is((
    select count(*)::integer from pg_constraint as k
    inner join pg_class as c on k.conrelid = c.oid
    inner join pg_namespace as n on c.relnamespace = n.oid
    where
        n.nspname = 'private'
        and c.relname like 'reminder_%'
        and k.contype = 'f'
        and k.confdeltype = 'r'
),
12, 'ER18 email restrictive references');
select is((
    select count(*)::integer from pg_constraint
    where
        conrelid = 'private.reminder_jobs'::regclass
        and contype = 'f'
        and array_length(conkey, 1) = 3
),
2, 'ER18 job cycle and selected-user identity composite references');
select ok(has_function_privilege(
    'authenticated',
    'public.get_email_reminder_schedule_v2(uuid,text,uuid)', 'execute'
),
'CU14 active readers have named v2 projection');
select ok(not has_function_privilege(
    'anon',
    'public.get_email_reminder_schedule_v2(uuid,text,uuid)', 'execute'
),
'CU14 anonymous v2 projection denied');
select ok(not has_function_privilege(
    'service_role',
    'private.reminder_valid_window(timestamptz,text,timestamptz)', 'execute'
),
'CU03 service cannot forge window clock');
select is(private.reminder_next_window(
    '2030-01-01 10:00+00', 'UTC',
    '2030-01-01 10:00+00'
), '2030-01-01 10:00+00'::timestamptz,
'CU03 catch-up dispatch can use current permitted instant');
select is(private.reminder_next_window(
    '9999-12-31 17:00+00', 'UTC',
    '9999-12-31 17:00+00'
), null::timestamptz,
'CU03 unsupported next date remains visibly unavailable');
select ok((
    select not prosecdef
    from pg_proc
    where
        oid
        = 'public.get_email_reminder_schedule_v2(uuid,text,uuid)'::regprocedure
),
'CU14 public v2 facade is invoker');
select finish from finish();
rollback;
