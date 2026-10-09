-- Authorized operator preview while sending is off. Supply the configured stable namespace.
-- This reads current eligibility; no jobs, attempts, consent or external requests are created.
begin;
set local transaction_read_only = on;
set local statement_timeout = '5s';
with configuration as (
    select
        'REPLACE_WITH_PROVIDER_NAMESPACE'::text as namespace,
        clock_timestamp() as checked_at
),

contexts as (
    select
        private.email_reminder_context(
            c.practice_id, c.id, configuration.namespace, configuration.checked_at
        ) as context
    from public.credentials as c cross join configuration
)

select
    case
        when context is not null and context ->> 'reason' is null then 'eligible'
        else 'blocked'
    end as eligibility,
    context ->> 'scheduleKind' as schedule_kind,
    coalesce(context ->> 'reason', case when context is null then 'no-recipient' end) as reason,
    count(*) as records,
    min((context ->> 'target')::timestamptz) as oldest_original_target,
    min((context ->> 'dispatchTarget')::timestamptz) as oldest_dispatch_target,
    min((context ->> 'nextSendAt')::timestamptz) as next_permitted_time
from contexts
group by 1, 2, 3
order by 1, 2, 3;
rollback;
