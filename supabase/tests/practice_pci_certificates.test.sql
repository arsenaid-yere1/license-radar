begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);
select ok(exists (
    select 1
    from pg_constraint
    where
        conrelid = 'public.credentials'::regclass
        and conname = 'credentials_pci_practice_owner_check'
), 'PCI03 persisted practice-only ownership constraint');
select is(private.credential_change_values(
    'PCI fixture', 'pci_compliance_certificate', 'practice', null, '{}',
    null, null, null, null
) ->> 'type', 'pci_compliance_certificate', 'PCI02 practice-owned PCI accepted');
select is(private.credential_change_values(
    'PCI fixture', 'pci_compliance_certificate', 'clinician',
    'aaaaaaaa-0000-4000-8000-000000000001', '{}', null, null, null, null
) ->> 'status', 'invalid', 'PCI03 clinician ownership rejected');
select is(private.credential_change_values(
    'PCI fixture', 'pci_compliance_certificate', 'practice', null,
    '{aaaaaaaa-0000-4000-8000-000000000001}', null, null, null, null
) ->> 'status', 'invalid', 'PCI03 covered clinicians rejected');
select is(private.credential_change_values(
    'PCI fixture', 'pci_other', 'practice', null, '{}', null, null, null, null
) ->> 'status', 'invalid', 'PCI01 unknown types rejected');
select ok(
    not has_table_privilege('authenticated', 'public.credentials', 'insert,update,delete'),
    'PCI03 direct credential writes denied'
);
select ok(not has_function_privilege(
    'authenticated',
    'private.credential_change_values(text,text,text,uuid,uuid[],text,text,text,text)', 'execute'
),
'PCI03 raw validation helper remains private');
select finish from finish();
rollback;
