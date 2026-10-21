begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);
select ok(not exists (
    select 1 from information_schema.table_privileges
    where
        table_schema = 'private' and table_name in
        (
            'reminder_email_submissions',
            'reminder_email_checks',
            'reminder_email_check_requests',
            'reminder_recovery_scan_state'
        )
        and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
), 'DR17 recovery ledgers private');
select
    is((
        select count(*)::integer
        from pg_class as c
        inner join pg_namespace as n on c.relnamespace = n.oid
        where
            n.nspname = 'private' and c.relname in
            (
                'reminder_email_submissions',
                'reminder_email_checks',
                'reminder_email_check_requests',
                'reminder_recovery_scan_state'
            )
            and c.relrowsecurity
    ), 4, 'DR17 recovery RLS inventory');
select is((
    select count(*)::integer
    from pg_constraint as k
    where
        k.conrelid in
        (
            'private.reminder_email_submissions'::regclass,
            'private.reminder_email_checks'::regclass,
            'private.reminder_email_check_requests'::regclass
        )
        and k.contype = 'f' and k.confdeltype = 'r' and cardinality(k.conkey) = 2
), 3, 'DR17 recovery composite restrictive references');
select ok(not has_function_privilege(
    'authenticated', 'public.begin_email_recovery(uuid,uuid,jsonb,text)',
    'execute'
), 'DR17 users cannot reserve POST');
select ok(has_function_privilege(
    'service_role', 'public.begin_email_recovery(uuid,uuid,jsonb,text)',
    'execute'
), 'DR17 service named POST');
select ok(not has_function_privilege(
    'service_role', 'private.begin_email_recovery_at(uuid,uuid,jsonb,text,timestamptz)',
    'execute'
), 'DR17 no forged recovery clock');
select ok(not has_function_privilege(
    'anon', 'public.get_email_reminder_history(uuid,uuid,uuid)',
    'execute'
), 'DR17 history anonymous denied');
select ok(has_function_privilege(
    'authenticated', 'public.get_email_reminder_history(uuid,uuid,uuid)',
    'execute'
), 'DR17 history reader entry');
select ok(not (
    select prosecdef from pg_proc
    where oid = 'public.request_email_reminder_check(uuid,uuid,uuid,integer)'::regprocedure
), 'DR17 check public invoker');
select ok(exists (
    select 1 from pg_index
    where
        indexrelid = to_regclass('private.reminder_submission_pending')
        and indisunique
        and indpred is not null
), 'DR17 one pending POST');
select ok(exists (
    select 1 from pg_index
    where
        indexrelid = to_regclass('private.reminder_check_pending')
        and indisunique
        and indpred is not null
), 'DR17 one pending GET');
select ok(exists (
    select 1 from pg_index
    where
        indexrelid = to_regclass('private.reminder_email_submissions_pending_expiry')
        and indrelid = 'private.reminder_email_submissions'::regclass
        and indisvalid and indisready and indnkeyatts = 2
        and pg_get_indexdef(indexrelid, 1, true) = 'deadline'
        and pg_get_indexdef(indexrelid, 2, true) = 'id'
        and pg_get_expr(indpred, indrelid) = '(result IS NULL)'
), 'DR17 pending POST deadline index');
select ok(exists (
    select 1 from pg_index
    where
        indexrelid = to_regclass('private.reminder_email_checks_pending_expiry')
        and indrelid = 'private.reminder_email_checks'::regclass
        and indisvalid and indisready and indnkeyatts = 2
        and pg_get_indexdef(indexrelid, 1, true) = 'deadline'
        and pg_get_indexdef(indexrelid, 2, true) = 'id'
        and pg_get_expr(indpred, indrelid) = '(result IS NULL)'
), 'DR17 pending GET deadline index');
select is(
    private.email_recovery_disposition('uncertain', null),
    'review-needed', 'DR11 unknown outcome needs review'
);
select finish from finish();
rollback;
