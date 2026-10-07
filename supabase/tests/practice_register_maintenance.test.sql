begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,
extensions;
select plan(27);
select ok((
    select relrowsecurity from pg_class
    where oid = 'private.register_change_requests'::regclass
),
'M09 change receipt RLS');
select ok(not has_table_privilege(
    'authenticated',
    'private.register_change_requests',
    'select,insert,update,delete,truncate'
),
'M09 change receipt private denied');
select ok(not has_table_privilege(
    'anon',
    'private.register_change_requests',
    'select,insert,update,delete,truncate'
),
'M09 change receipt anonymous denied');
select is((
    select count(*)::integer from pg_constraint
    where
        conrelid = 'private.register_change_requests'::regclass
        and contype = 'f'
        and confdeltype = 'r'
),
3,
'M09 change restrictive foreign keys');
select is((
    select count(*)::integer from pg_constraint
    where
        conrelid = 'private.register_change_requests'::regclass
        and contype = 'f'
        and array_length(
            conkey,
            1
        ) = 2
),
1,
'M09 change composite reference');
select ok(exists (
    select 1 from pg_constraint
    where
        conrelid = 'private.register_change_requests'::regclass
        and contype = 'u'
        and array_length(
            conkey,
            1
        ) = 3
),
'M09 change caller request uniqueness');
select ok(not has_function_privilege(
    'authenticated',
    'private.credential_maintenance_projection(public.credentials)',
    'execute'
),
'M09 maintenance projection private');
select ok(not has_function_privilege(
    'authenticated',
    'private.credential_duplicate_ids(public.credentials)',
    'execute') and not has_function_privilege(
    'authenticated',
    'private.duplicate_text(text)',
    'execute'
),
'M09 duplicate helpers private');
select ok(not has_function_privilege(
    'authenticated',
    'private.register_change_replay(uuid,uuid,text,jsonb)',
    'execute'
),
'M09 change replay private');
select ok(not has_function_privilege(
    'authenticated',
    'private.finish_register_change(uuid,uuid,uuid,text,jsonb,jsonb,jsonb)',
    'execute') and not has_function_privilege('authenticated',
'private.apply_credential_change(uuid,uuid,uuid,integer,uuid,integer,jsonb)',
'execute') and not has_function_privilege(
    'authenticated',
    'private.credential_change_values(text,text,text,uuid,uuid[],text,text,text,text)',
    'execute'
),
'M09 change finish private');
select ok(not has_function_privilege(
    'anon',
    'public.archive_practice_credential(uuid,uuid,uuid,integer,uuid,integer)',
    'execute'
),
'M09 archive anonymous denied');
select ok(not has_function_privilege(
    'anon',
    'public.update_practice_credential(uuid,uuid,uuid,integer,uuid,integer,text,'
    || 'text,text,uuid,uuid[],text,text,text,text)',
    'execute'
),
'M09 update anonymous denied');
select ok(not (
    select prosecdef from pg_proc
    where
        oid
        = 'public.archive_practice_credential(uuid,uuid,uuid,integer,uuid,integer)'::regprocedure
),
'M09 archive invoker wrapper');
select ok(not (
    select prosecdef from pg_proc
    where
        oid
        = (
            'public.update_practice_credential(uuid,uuid,uuid,integer,uuid,integer,text,'
            || 'text,text,uuid,uuid[],text,text,text,text)'
        )::regprocedure
),
'M09 update invoker wrapper');
select ok(not (
    select prosecdef from pg_proc
    where oid = 'public.list_practice_register_with_maintenance(uuid,boolean)'::regprocedure
),
'M09 list invoker wrapper');
select ok(has_function_privilege(
    'authenticated',
    'public.archive_practice_credential(uuid,uuid,uuid,integer,uuid,integer)',
    'execute') and has_function_privilege(
    'authenticated',
    'public.update_practice_credential(uuid,uuid,uuid,integer,uuid,integer,text,'
    || 'text,text,uuid,uuid[],text,text,text,text)',
    'execute'
),
'M09 editor entry grants');
select ok(exists (
    select 1 from pg_indexes
    where indexname = 'credentials_active_practice_idx' and indexdef like '%archived_at IS NULL%'
),
'M09 active partial index');
select ok(not has_table_privilege(
    'authenticated',
    'public.credentials',
    'insert,update,delete,truncate'
),
'M09 credential DML denied');
select ok(exists (
    select 1 from pg_constraint
    where
        conrelid = 'private.register_audit_events'::regclass
        and conname = 'register_audit_events_operation_check'
        and pg_get_constraintdef(oid) like '%credential-archived%'
),
'M09 audit maintenance operations');
insert into auth.users (
    id,
    email,
    email_confirmed_at
) values
(
    '50000000-0000-4000-8000-000000000001',
    'fixture-maintenance-sql@example.test',
    clock_timestamp()
);
select set_config(
    'request.jwt.claim.sub',
    '50000000-0000-4000-8000-000000000001',
    true
);
create temporary table maintenance_practice as
select (public.create_practice(
    'Maintenance fixture',
    'UTC'
)).id as id;
create temporary table maintenance_record as select public.create_practice_credential_with_details(
    (select p.id from maintenance_practice as p),
    '50000000-0000-4000-8000-000000000002',

    'Policy',

    'malpractice_policy',

    'practice',

    null,

    '{}'::uuid[],

    'Insurer',

    'CA',

    '2028-02-29',

    '2028-02-01'
) as result;
create temporary table maintenance_archive as select public.archive_practice_credential(
    (select p.id from maintenance_practice as p),
    '50000000-0000-4000-8000-000000000003',

    (select (result -> 'credential' ->> 'id')::uuid from maintenance_record),
    1,

    (select (result -> 'credential' -> 'current_cycle' ->> 'id')::uuid from maintenance_record),
    1
) as result;
select is(
    (select result ->> 'status' from maintenance_archive),
    'success',
    'M05 SQL archive succeeds'
);
select is(
    (
        select jsonb_array_length(public.list_practice_register(id) -> 'credentials')
        from maintenance_practice
    ),
    0,
    'M05 SQL legacy hides archived'
);
select is((select jsonb_array_length(public.list_practice_register_with_maintenance(
    id,
    true
) -> 'credentials') from maintenance_practice),
1,
'M05 SQL retained archived read');
select is((
    select count(*)::integer from public.credential_cycles
    where practice_id = (select p.id from maintenance_practice as p)
),
1,
'M05 SQL preserves cycle');
create temporary table maintenance_archive_audit as select id from private.register_audit_events
where
    operation = 'credential-archived'
    and practice_id = (select p.id from maintenance_practice as p);
select throws_ok(
    $q$
insert into private.register_change_requests 
select gen_random_uuid(),
practice_id,
actor_user_id,
request_id,
credential_id,
operation,
payload,
result,
created_at 
from private.register_change_requests 
where practice_id=(
select id 
from maintenance_practice)
$q$,
    '23505',
    null,
    'M09 SQL duplicate mutation receipt rejected'
);
select throws_ok(
    $q$
insert into private.register_audit_events(practice_id,
actor_user_id,
operation,
credential_id,
before_data,
after_data) 
select practice_id,
actor_user_id,
operation,
credential_id,
null,
after_data 
from private.register_audit_events 
where operation='credential-archived' and practice_id=(
select id 
from maintenance_practice)
$q$,
    '23514',
    null,
    'M09 SQL update requires before data'
);
select throws_ok(
    $q$
insert into private.register_audit_events(practice_id,
actor_user_id,
operation,
credential_id,
before_data,
after_data) 
select practice_id,
actor_user_id,
'credential-created',
credential_id,
before_data,
after_data 
from private.register_audit_events 
where operation='credential-archived' and practice_id=(
select id 
from maintenance_practice)
$q$,
    '23514',
    null,
    'M09 SQL creation still requires null before data'
);
select is((
    select after_data from private.register_audit_events
    where id = (select maintenance_archive_audit.id from maintenance_archive_audit)
),
(select result -> 'credential' from maintenance_archive
),
'M05 SQL final archive snapshot');
select finish from finish();
rollback;
