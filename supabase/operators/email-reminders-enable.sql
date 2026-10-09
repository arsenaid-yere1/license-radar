-- Operator template only: never run by migrations or local preparation.
-- Create these Vault entries securely first; never paste their values here.
-- email_reminder_worker_url: https://YOUR_VERIFIED_APP/api/reminders/run
-- email_reminder_worker_token: the independently generated worker bearer secret
-- Requires reviewed pg_cron/pg_net/Vault privileges and restricted net tables.
do $$
declare worker_url text; token text;
begin
    select decrypted_secret into worker_url from vault.decrypted_secrets
    where name = 'email_reminder_worker_url';
    select decrypted_secret into token from vault.decrypted_secrets
    where name = 'email_reminder_worker_token';
    if worker_url is null or worker_url !~ '^https://[a-zA-Z0-9.-]+/api/reminders/run$'
        or token is null or token !~ '^[a-zA-Z0-9_-]{32,256}$' then
        raise exception 'Worker URL/token setup incomplete';
    end if;
    if exists (select 1 from cron.job where jobname = 'email-reminder-worker') then
        raise exception 'Worker already registered; review before replacing';
    end if;
    perform cron.schedule('email-reminder-worker', '* * * * *', $cron$
        select net.http_post(
            url := (select decrypted_secret from vault.decrypted_secrets where name = 'email_reminder_worker_url'),
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
                'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_reminder_worker_token')),
            body := '{}'::jsonb,
            timeout_milliseconds := 55000
        );
    $cron$);
end;
$$;
