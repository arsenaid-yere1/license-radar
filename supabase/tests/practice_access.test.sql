begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);
select
    ok((
        select relrowsecurity from pg_class
        where oid = 'public.practice_memberships'::regclass
    ), 'S33 memberships RLS');
select
    ok((
        select relrowsecurity from pg_class
        where oid = 'private.practice_access_events'::regclass
    ), 'N05 access audit RLS');
select ok(not has_table_privilege(
    'anon',
    'public.practice_memberships',
    'select'
),
'S33 anonymous membership denied');
select ok(has_table_privilege(
    'authenticated',
    'public.practice_memberships',
    'select'
),
'S33 self membership select grant');
select ok(not has_table_privilege(
    'authenticated',
    'public.practice_memberships',
    'insert,update,delete'
),
'N05 membership DML denied');
select ok(not has_any_column_privilege(
    'authenticated',
    'public.practices',
    'insert,update'
),
'N05 profile DML denied');
select ok(not has_table_privilege(
    'authenticated',
    'private.practice_access_events',
    'select,insert,update,delete'
),
'N05 access events denied');
select ok(has_schema_privilege(
    'authenticated',
    'private',
    'usage'
),
'S33 narrow private wrapper usage');
select ok(not has_function_privilege(
    'authenticated',
    'private.audit_membership()',
    'execute'
),
'N05 membership trigger denied');
select ok(not has_function_privilege(
    'authenticated',
    'private.ensure_administrator()',
    'execute'
),
'N05 invariant trigger denied');
select ok(not has_function_privilege(
    'authenticated',
    'private.require_administrator(uuid)',
    'execute'
),
'N05 internal authority helper denied');
select ok(not has_function_privilege(
    'anon',
    'public.create_practice(text,text)',
    'execute'
),
'S33 anonymous create RPC denied');
select
    ok(not (
        select prosecdef from pg_proc
        where oid = 'public.create_practice(text,text)'::regprocedure
    ), 'N05 public create invoker');
select
    ok((
        select indisunique and indpred is not null from pg_index
        where indexrelid = to_regclass('public.practice_memberships_one_active_user')
    ), 'N02 active user partial uniqueness');
select
    is((
        select count(*)::integer from pg_trigger
        where
            tgname in ('practice_requires_administrator', 'membership_requires_administrator')
            and tgdeferrable
            and tginitdeferred
    ), 2, 'S37 both deferred administrator invariants');
select is((
    select count(*)::integer from pg_constraint
    where
        contype = 'f' and confdeltype = 'r'
        and conrelid in (
            'public.practice_memberships'::regclass,
            'private.practice_access_events'::regclass,
            'private.practice_invitations'::regclass
        )
), 9,
'N04 membership invitation and access foreign keys restrict deletion');
select finish from finish();
rollback;
