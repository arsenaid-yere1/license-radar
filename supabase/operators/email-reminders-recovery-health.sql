-- Authorized operator health check. Supply the configured stable provider namespace.
-- Results contain counts and timing only; this neither changes recovery nor calls a provider.
begin;
set local transaction_read_only = on;
set local statement_timeout = '5s';
set local lock_timeout = '1s';
with configuration as (
    select
        'REPLACE_WITH_PROVIDER_NAMESPACE'::text as namespace,
        clock_timestamp() as checked_at
),

health as (
    select
        a.recovery_state,
        a.outcome,
        a.delivery,
        count(*) as attempts,
        count(*) filter (where a.recovery_state = 'retry-pending') as retries_waiting,
        count(*) filter (where a.recovery_state = 'exhausted') as retries_exhausted,
        count(*) filter (where a.post_count >= 3) as post_budget_used,
        count(*) filter (where a.check_count >= 6) as check_budget_used,
        count(*) filter (
            where a.outcome = 'uncertain' and a.provider_id is null
        ) as unknown_provider_id,
        min(a.started_at) filter (
            where a.outcome = 'uncertain' and a.provider_id is null
        ) as oldest_unknown_started_at,
        max(configuration.checked_at - a.started_at) filter (
            where a.outcome = 'uncertain' and a.provider_id is null
        ) as oldest_unknown_age,
        min(a.retry_due) as oldest_retry_due,
        min(a.retry_expires) filter (
            where a.recovery_state = 'retry-pending'
        ) as next_retry_expiry,
        min(a.check_due) as oldest_check_due
    from private.reminder_message_attempts as a
    cross join configuration
    where a.provider_namespace = configuration.namespace
    group by a.recovery_state, a.outcome, a.delivery
)

select * from health
order by recovery_state, outcome, delivery;
rollback;
