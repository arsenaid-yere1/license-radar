-- Set EMAIL_REMINDERS_ENABLED=false in the application first.
-- Keep callbacks and personal withdrawal available; retain consumed guards.
select cron.unschedule(jobid) from cron.job
where jobname = 'email-reminder-worker';
