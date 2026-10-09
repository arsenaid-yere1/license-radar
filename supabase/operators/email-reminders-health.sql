-- Authorized operator reads only; coarse aggregates, no destinations/payloads.
select
    max(finished_at) filter (where success) as last_success_at,
    count(*) filter (where not success and started_at > now() - interval '1 hour')
        as unsuccessful_last_hour
from private.reminder_worker_runs;
select
    state,
    count(*) as jobs,
    min(next_send_at) as oldest_due_at
from private.reminder_jobs
group by state
order by state;
select count(*) as expired_submissions
from private.reminder_message_attempts
where outcome = 'submitting' and deadline < now();
select
    jobid,
    jobname,
    active
from cron.job
where jobname = 'email-reminder-worker';
