begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);
select has_table(
    'private',
    'gmail_reminder_authority',
    'GM06 durable operator recipient authority'
);
select has_column(
    'private',
    'reminder_message_attempts',
    'provider_kind',
    'GM07 persisted provider capability'
);
select has_column(
    'private',
    'reminder_message_attempts',
    'gmail_message_id',
    'GM03 genuine non-UUID Gmail identity'
);
select has_function(
    'public',
    'begin_gmail_reminder',
    array['uuid', 'uuid', 'jsonb', 'text', 'integer'],
    'GM04 checked begin'
);
select has_function(
    'public',
    'record_gmail_reminder',
    array['uuid', 'uuid', 'text', 'text', 'text'],
    'GM04 checked result'
);
select has_function(
    'public',
    'expire_gmail_reminders',
    array[]::text[],
    'GM04 bounded expiry'
);
select has_function(
    'public',
    'get_email_reminder_schedule_v4',
    array['uuid', 'text', 'uuid'],
    'GM07 versioned schedule'
);
select has_function(
    'public',
    'get_email_reminder_history_v2',
    array['uuid', 'uuid', 'uuid'],
    'GM07 versioned history'
);
select ok(not has_table_privilege(
    'service_role',
    'private.gmail_reminder_authority',
    'SELECT,INSERT,UPDATE,DELETE'
), 'GM06 service cannot read or change recipient authority directly');
select ok(not has_table_privilege(
    'authenticated',
    'private.gmail_reminder_authority',
    'SELECT,INSERT,UPDATE,DELETE'
), 'GM06 members cannot read or change recipient authority directly');
select ok(not has_function_privilege(
    'authenticated',
    'public.begin_gmail_reminder(uuid,uuid,jsonb,text,integer)',
    'execute'
), 'GM04 members cannot reserve a send');
select ok(has_function_privilege(
    'service_role',
    'public.begin_gmail_reminder(uuid,uuid,jsonb,text,integer)',
    'execute'
), 'GM04 only checked service entry reserves');
select ok(not has_function_privilege(
    'service_role',
    'private.begin_gmail_reminder_at(uuid,uuid,jsonb,text,integer,timestamptz)',
    'execute'
), 'GM04 service cannot forge begin clock');
select ok(not has_function_privilege(
    'service_role',
    'private.record_gmail_reminder_at(uuid,uuid,text,text,text,timestamptz)',
    'execute'
), 'GM04 service cannot forge recording clock');
select ok(not has_function_privilege(
    'anon',
    'public.get_email_reminder_history_v2(uuid,uuid,uuid)',
    'execute'
), 'GM07 anonymous cannot read Gmail history');
select ok(not (
    select prosecdef from pg_proc
    where oid = 'public.begin_gmail_reminder(uuid,uuid,jsonb,text,integer)'::regprocedure
), 'GM04 public Gmail boundary remains invoker');
select ok((
    select relrowsecurity from pg_class
    where oid = 'private.gmail_reminder_authority'::regclass
), 'GM06 Gmail authority RLS');
select ok(not has_function_privilege(
    'anon',
    'public.gmail_reminder_readiness(text,text,text,text,text)',
    'execute'
), 'GM06 anonymous readiness denied');
select ok(has_function_privilege(
    'service_role',
    'public.gmail_reminder_readiness(text,text,text,text,text)',
    'execute'
), 'GM06 checked readiness service entry');
select ok(exists (
    select 1 from pg_constraint
    where
        conrelid = 'private.reminder_message_attempts'::regclass
        and contype = 'u'
        and pg_get_constraintdef(oid) = 'UNIQUE (cycle_id, user_id, channel)'
), 'GM04 cross-provider consumed key unchanged');
select finish from finish();
rollback;
