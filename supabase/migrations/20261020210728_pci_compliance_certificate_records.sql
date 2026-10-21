-- PCI certificates reuse explicit expiration dates and existing transactional contracts.
alter table public.credentials
drop constraint credentials_type_check,
add constraint credentials_type_check check (
    type in (
        'state_license', 'dea_registration', 'malpractice_policy', 'pci_compliance_certificate'
    )
),
add constraint credentials_pci_practice_owner_check check (
    type <> 'pci_compliance_certificate'
    or (owner_kind = 'practice' and owner_clinician_id is null)
);

-- CREATE OR REPLACE retains existing function grants, signatures and historical payloads.
create or replace function private.create_practice_credential(
    p_practice_id uuid, p_request_id uuid, p_title text, p_type text, p_owner_kind text,
    p_owner_clinician_id uuid, p_covered_clinician_ids uuid[]
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    normalized text;
    covered uuid[] := coalesce(p_covered_clinician_ids, '{}'::uuid[]);
    payload jsonb;
    result jsonb;
    credential public.credentials;
begin
    perform private.require_register_member(p_practice_id, true);
    normalized := private.register_name(p_title);
    if p_request_id is null or normalized is null or char_length(normalized) not between 1 and 120
       or p_type is null or p_type not in ('state_license', 'dea_registration', 'malpractice_policy', 'pci_compliance_certificate')
       or p_owner_kind is null or p_owner_kind not in ('clinician', 'practice')
       or (p_type = 'pci_compliance_certificate' and p_owner_kind <> 'practice')
       or (p_owner_kind = 'clinician' and p_owner_clinician_id is null)
       or (p_owner_kind = 'practice' and p_owner_clinician_id is not null)
       or coalesce(array_ndims(covered), 1) <> 1 then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if array_position(covered, null) is not null
       or cardinality(covered) <> (select count(distinct c) from unnest(covered) c)
       or (cardinality(covered) > 0 and (p_type <> 'malpractice_policy' or p_owner_kind <> 'practice')) then
        return '{"status":"invalid"}'::jsonb;
    end if;
    select coalesce(array_agg(c order by c), '{}'::uuid[]) into covered from unnest(covered) c;
    payload := pg_catalog.jsonb_build_object('title', normalized, 'type', p_type,
        'owner_kind', p_owner_kind, 'owner_clinician_id', p_owner_clinician_id,
        'covered_clinician_ids', covered);
    result := private.register_replay(p_practice_id, p_request_id, 'credential-created', payload);
    if result is not null then return result; end if;
    if (p_owner_clinician_id is not null and not exists (
        select 1 from public.clinicians where practice_id = p_practice_id and id = p_owner_clinician_id
    )) or exists (
        select 1 from unnest(covered) x where not exists (
            select 1 from public.clinicians where practice_id = p_practice_id and id = x
        )
    ) then return '{"status":"invalid-reference"}'::jsonb; end if;
    insert into public.credentials (practice_id, title, type, owner_kind, owner_clinician_id)
    values (p_practice_id, normalized, p_type, p_owner_kind, p_owner_clinician_id)
    returning * into credential;
    insert into public.policy_coverage (practice_id, credential_id, clinician_id)
    select p_practice_id, credential.id, x from unnest(covered) x;
    result := pg_catalog.jsonb_build_object('status', 'success', 'credential',
        private.credential_projection(credential));
    return private.finish_register_create(p_practice_id, p_request_id, 'credential-created', payload,
        null, credential.id, result);
end;
$$;

create or replace function private.create_practice_credential_with_details(
    p_practice_id uuid, p_request_id uuid, p_title text, p_type text, p_owner_kind text,
    p_owner_clinician_id uuid, p_covered_clinician_ids uuid[],
    p_issuer text, p_jurisdiction text, p_end_date text, p_action_deadline text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
    normalized text;
    issuer text;
    jurisdiction text;
    entered_end_date date;
    entered_action_deadline date;
    covered uuid[] := coalesce(p_covered_clinician_ids, '{}'::uuid[]);
    payload jsonb;
    result jsonb;
    credential public.credentials;
begin
    perform private.require_register_member(p_practice_id, true);
    normalized := private.register_name(p_title);
    issuer := nullif(private.register_name(p_issuer), '');
    jurisdiction := nullif(private.register_name(p_jurisdiction), '');
    if p_request_id is null or normalized is null or char_length(normalized) not between 1 and 120
       or p_type is null or p_type not in ('state_license', 'dea_registration', 'malpractice_policy', 'pci_compliance_certificate')
       or p_owner_kind is null or p_owner_kind not in ('clinician', 'practice')
       or (p_type = 'pci_compliance_certificate' and p_owner_kind <> 'practice')
       or (p_owner_kind = 'clinician' and p_owner_clinician_id is null)
       or (p_owner_kind = 'practice' and p_owner_clinician_id is not null)
       or coalesce(array_ndims(covered), 1) <> 1 then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if array_position(covered, null) is not null
       or cardinality(covered) <> (select count(distinct c) from unnest(covered) c)
       or (cardinality(covered) > 0 and (p_type <> 'malpractice_policy' or p_owner_kind <> 'practice')) then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if issuer is not null and char_length(issuer) > 120 then
        return '{"status":"invalid","errors":{"issuer":"Use 1 to 120 characters."}}'::jsonb;
    end if;
    if jurisdiction is not null and char_length(jurisdiction) > 120 then
        return '{"status":"invalid","errors":{"jurisdiction":"Use 1 to 120 characters."}}'::jsonb;
    end if;
    begin
        entered_end_date := private.credential_date(p_end_date);
    exception when datetime_field_overflow or invalid_datetime_format then
        return '{"status":"invalid","errors":{"endDate":"Enter a valid date (YYYY-MM-DD)."}}'::jsonb;
    end;
    begin
        entered_action_deadline := private.credential_date(p_action_deadline);
    exception when datetime_field_overflow or invalid_datetime_format then
        return '{"status":"invalid","errors":{"actionDeadline":"Enter a valid date (YYYY-MM-DD)."}}'::jsonb;
    end;
    if entered_end_date is not null and entered_action_deadline is not null and entered_action_deadline >= entered_end_date then
        return '{"status":"invalid","errors":{"actionDeadline":"The action deadline must be earlier than the end date."}}'::jsonb;
    end if;
    select coalesce(array_agg(c order by c), '{}'::uuid[]) into covered from unnest(covered) c;
    payload := pg_catalog.jsonb_build_object('title', normalized, 'type', p_type,
        'owner_kind', p_owner_kind, 'owner_clinician_id', p_owner_clinician_id,
        'covered_clinician_ids', covered, 'contract_version', 2, 'issuer', issuer,
        'jurisdiction', jurisdiction, 'end_date', pg_catalog.to_char(entered_end_date, 'YYYY-MM-DD'),
        'action_deadline', pg_catalog.to_char(entered_action_deadline, 'YYYY-MM-DD'));
    result := private.register_replay(p_practice_id, p_request_id, 'credential-created', payload);
    if result is not null then return result; end if;
    if (p_owner_clinician_id is not null and not exists (
        select 1 from public.clinicians where practice_id = p_practice_id and id = p_owner_clinician_id
    )) or exists (
        select 1 from unnest(covered) x where not exists (
            select 1 from public.clinicians where practice_id = p_practice_id and id = x
        )
    ) then return '{"status":"invalid-reference"}'::jsonb; end if;
    insert into public.credentials (practice_id, title, type, owner_kind, owner_clinician_id, issuer, jurisdiction)
    values (p_practice_id, normalized, p_type, p_owner_kind, p_owner_clinician_id, issuer, jurisdiction)
    returning * into credential;
    insert into public.policy_coverage (practice_id, credential_id, clinician_id)
    select p_practice_id, credential.id, x from unnest(covered) x;
    update public.credential_cycles cy set end_date = entered_end_date,
        action_deadline = entered_action_deadline,
        updated_at = pg_catalog.clock_timestamp()
    where cy.practice_id = p_practice_id and cy.credential_id = credential.id and cy.cycle_number = 1;
    result := pg_catalog.jsonb_build_object('status', 'success', 'credential',
        private.credential_details_projection(credential));
    return private.finish_register_create(p_practice_id, p_request_id, 'credential-created', payload,
        null, credential.id, result);
end;
$$;

create or replace function private.credential_change_values(
    p_title text,
    p_type text,
    p_owner_kind text,
    p_owner_clinician_id uuid,
    p_covered_clinician_ids uuid[],
    p_issuer text,
    p_jurisdiction text,
    p_end_date text,
    p_action_deadline text
) returns jsonb
language plpgsql immutable security invoker set search_path = '' as $$
declare
    normalized text;
    issuer text;
    jurisdiction text;
    entered_end_date date;
    entered_action_deadline date;
    covered uuid[] := coalesce(p_covered_clinician_ids, '{}'::uuid[]);
    payload jsonb;
begin
    normalized := private.register_name(p_title);
    issuer := nullif(private.register_name(p_issuer), '');
    jurisdiction := nullif(private.register_name(p_jurisdiction), '');
    if normalized is null or char_length(normalized) not between 1 and 120
       or p_type is null or p_type not in ('state_license', 'dea_registration', 'malpractice_policy', 'pci_compliance_certificate')
       or p_owner_kind is null or p_owner_kind not in ('clinician', 'practice')
       or (p_type = 'pci_compliance_certificate' and p_owner_kind <> 'practice')
       or (p_owner_kind = 'clinician' and p_owner_clinician_id is null)
       or (p_owner_kind = 'practice' and p_owner_clinician_id is not null)
       or coalesce(array_ndims(covered), 1) <> 1 then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if array_position(covered, null) is not null
       or cardinality(covered) <> (select count(distinct c) from unnest(covered) c)
       or (cardinality(covered) > 0 and (p_type <> 'malpractice_policy' or p_owner_kind <> 'practice')) then
        return '{"status":"invalid"}'::jsonb;
    end if;
    if issuer is not null and char_length(issuer) > 120 then
        return '{"status":"invalid","errors":{"issuer":"Use 1 to 120 characters."}}'::jsonb;
    end if;
    if jurisdiction is not null and char_length(jurisdiction) > 120 then
        return '{"status":"invalid","errors":{"jurisdiction":"Use 1 to 120 characters."}}'::jsonb;
    end if;
    begin
        entered_end_date := private.credential_date(p_end_date);
    exception when datetime_field_overflow or invalid_datetime_format then
        return '{"status":"invalid","errors":{"endDate":"Enter a valid date (YYYY-MM-DD)."}}'::jsonb;
    end;
    begin
        entered_action_deadline := private.credential_date(p_action_deadline);
    exception when datetime_field_overflow or invalid_datetime_format then
        return '{"status":"invalid","errors":{"actionDeadline":"Enter a valid date (YYYY-MM-DD)."}}'::jsonb;
    end;
    if entered_end_date is not null and entered_action_deadline is not null and entered_action_deadline >= entered_end_date then
        return '{"status":"invalid","errors":{"actionDeadline":"The action deadline must be earlier than the end date."}}'::jsonb;
    end if;
    select coalesce(array_agg(c order by c), '{}'::uuid[]) into covered from unnest(covered) c;
    payload := pg_catalog.jsonb_build_object('title', normalized, 'type', p_type,
        'owner_kind', p_owner_kind, 'owner_clinician_id', p_owner_clinician_id,
        'covered_clinician_ids', covered, 'contract_version', 2, 'issuer', issuer,
        'jurisdiction', jurisdiction, 'end_date', pg_catalog.to_char(entered_end_date, 'YYYY-MM-DD'),
        'action_deadline', pg_catalog.to_char(entered_action_deadline, 'YYYY-MM-DD'));
    return payload;
end;
$$;
