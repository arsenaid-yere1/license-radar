begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);
select
    ok((
        select relrowsecurity from pg_class
        where oid = 'private.sms_phone_endpoints'::regclass
    ), 'SMS sms_phone_endpoints RLS');
select
    ok((
        select relrowsecurity from pg_class
        where oid = 'private.practice_sms_enrollments'::regclass
    ), 'SMS practice_sms_enrollments RLS');
select
    ok((
        select relrowsecurity from pg_class
        where oid = 'private.sms_enrollment_events'::regclass
    ), 'SMS sms_enrollment_events RLS');
select
    ok((
        select relrowsecurity from pg_class
        where oid = 'private.sms_verification_challenges'::regclass
    ), 'SMS sms_verification_challenges RLS');
select
    ok((
        select relrowsecurity from pg_class
        where oid = 'private.sms_verification_requests'::regclass
    ), 'SMS sms_verification_requests RLS');
select
    ok((
        select relrowsecurity from pg_class
        where oid = 'private.sms_action_receipts'::regclass
    ), 'SMS sms_action_receipts RLS');
select
    ok((
        select relrowsecurity from pg_class
        where oid = 'private.sms_provider_events'::regclass
    ), 'SMS sms_provider_events RLS');
select
    ok(not has_table_privilege(
        'authenticated',
        'private.sms_phone_endpoints',
        'select,insert,update,delete'
    ),
    'SMS sms_phone_endpoints private');
select
    ok(not has_table_privilege(
        'authenticated',
        'private.practice_sms_enrollments',
        'select,insert,update,delete'
    ),
    'SMS practice_sms_enrollments private');
select
    ok(not has_table_privilege(
        'authenticated',
        'private.sms_enrollment_events',
        'select,insert,update,delete'
    ),
    'SMS sms_enrollment_events private');
select
    ok(not has_table_privilege(
        'authenticated',
        'private.sms_verification_challenges',
        'select,insert,update,delete'
    ),
    'SMS sms_verification_challenges private');
select
    ok(not has_table_privilege(
        'authenticated',
        'private.sms_verification_requests',
        'select,insert,update,delete'
    ),
    'SMS sms_verification_requests private');
select
    ok(not has_table_privilege(
        'authenticated',
        'private.sms_action_receipts',
        'select,insert,update,delete'
    ),
    'SMS sms_action_receipts private');
select
    ok(not has_table_privilege(
        'authenticated',
        'private.sms_provider_events',
        'select,insert,update,delete'
    ),
    'SMS sms_provider_events private');
select
    is(
        (
            select count(*)::integer
            from pg_proc as p
            inner join pg_namespace as n on p.pronamespace = n.oid
            where
                n.nspname = 'public'
                and p.proname in (
                    'claim_sms_verification_send',
                    'record_sms_verification_send',
                    'claim_sms_verification_check',
                    'record_sms_verification_check',
                    'apply_sms_provider_opt_out'
                )

                and not has_function_privilege('authenticated', p.oid, 'execute')

                and not has_function_privilege('anon', p.oid, 'execute')
                and has_function_privilege('service_role', p.oid, 'execute')
        ), 5, 'SMS proof only service'
    );
select
    is(
        (
            select count(*)::integer
            from pg_proc as p
            inner join pg_namespace as n on p.pronamespace = n.oid
            where
                n.nspname = 'public'
                and p.proname in (
                    'get_my_practice_sms_enrollment',
                    'get_practice_reminder_recipient_with_enrollment',
                    'prepare_my_sms_verification',
                    'consent_my_practice_sms',
                    'withdraw_my_practice_sms'
                )
                and has_function_privilege('authenticated', p.oid, 'execute')

                and not has_function_privilege('anon', p.oid, 'execute')
        ), 5, 'SMS owner entry grants'
    );
select
    is(
        (
            select count(*)::integer
            from pg_proc as p
            inner join pg_namespace as n on p.pronamespace = n.oid
            where
                n.nspname = 'public'
                and p.proname in (
                    'claim_sms_verification_send',
                    'record_sms_verification_send',
                    'claim_sms_verification_check',
                    'record_sms_verification_check',
                    'apply_sms_provider_opt_out',
                    'get_my_practice_sms_enrollment',
                    'get_practice_reminder_recipient_with_enrollment',
                    'prepare_my_sms_verification',
                    'consent_my_practice_sms',
                    'withdraw_my_practice_sms'
                )
                and not p.prosecdef
        ), 10, 'SMS invoker wrappers'
    );
select
    ok(not has_function_privilege(
        'authenticated',
        'private.sms_member(uuid,uuid,boolean)', 'execute'
    )
    and not has_function_privilege(
        'authenticated',
        'private.record_sms_verification(uuid,uuid,uuid,uuid,jsonb,text)', 'execute'
    )
    and not has_function_privilege(
        'authenticated',
        'private.sms_state(uuid,uuid)', 'execute'
    ),
    'SMS internal helpers denied');
select
    is((
        select count(*)::integer from pg_constraint
        where
            conrelid in (
                'private.sms_phone_endpoints'::regclass,
                'private.practice_sms_enrollments'::regclass,
                'private.sms_enrollment_events'::regclass,
                'private.sms_verification_challenges'::regclass,
                'private.sms_verification_requests'::regclass,
                'private.sms_action_receipts'::regclass,
                'private.sms_provider_events'::regclass
            )
            and contype = 'f'
            and confdeltype = 'r'
    ), 13, 'SMS restrictive foreign keys');
select
    is((
        select count(*)::integer from pg_constraint
        where
            conrelid in (
                'private.sms_phone_endpoints'::regclass,
                'private.practice_sms_enrollments'::regclass,
                'private.sms_enrollment_events'::regclass,
                'private.sms_verification_challenges'::regclass,
                'private.sms_verification_requests'::regclass,
                'private.sms_action_receipts'::regclass,
                'private.sms_provider_events'::regclass
            )
            and contype = 'f'
            and array_length(conkey, 1) > 1
    ), 6, 'SMS composite tenant references');
select finish from finish();
rollback;
