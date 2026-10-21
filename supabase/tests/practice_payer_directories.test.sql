begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);
select is(private.credential_change_values(
    'DIR fixture', 'insurance_payer_provider_directory', 'practice', null, '{}',
    null, null, null, null
) ->> 'type', 'insurance_payer_provider_directory', 'DIR02 practice-owned DIR accepted');
select is(private.credential_change_values(
    'DIR fixture', 'insurance_payer_provider_directory', 'clinician',
    'aaaaaaaa-0000-4000-8000-000000000001', '{}', null, null, null, null
) ->> 'type', 'insurance_payer_provider_directory', 'DIR02 clinician ownership accepted');
select is(private.credential_change_values(
    'DIR fixture', 'insurance_payer_provider_directory', 'practice', null,
    '{aaaaaaaa-0000-4000-8000-000000000001}', null, null, null, null
) ->> 'status', 'invalid', 'DIR03 covered clinicians rejected');
select is(private.credential_change_values(
    'DIR fixture', 'pci_other', 'practice', null, '{}', null, null, null, null
) ->> 'status', 'invalid', 'DIR01 unknown types rejected');
select ok(
    not has_table_privilege('authenticated', 'public.credentials', 'insert,update,delete'),
    'DIR03 direct credential writes denied'
);
select ok(not has_function_privilege(
    'authenticated',
    'private.credential_change_values(text,text,text,uuid,uuid[],text,text,text,text)', 'execute'
),
'DIR03 raw validation helper remains private');
select is(private.credential_change_values(
    'Directory fixture', 'insurance_payer_provider_directory', 'clinician', null,
    '{}', null, null, null, null
) ->> 'status', 'invalid', 'DIR02 missing clinician rejected');
select is(private.credential_change_values(
    'Directory fixture', 'insurance_payer_provider_directory', 'practice',
    'aaaaaaaa-0000-4000-8000-000000000001', '{}', null, null, null, null
) ->> 'status', 'invalid', 'DIR02 incoherent practice owner rejected');
select ok(exists (
    select 1
    from pg_constraint
    where
        conrelid = 'public.credentials'::regclass
        and conname = 'credentials_pci_practice_owner_check'
), 'DIR02 PCI practice-only constraint retained');
select finish from finish();
rollback;
