-- Read-only aggregate health; no names, object paths, actor IDs or file bytes.
select
    state,
    count(*) as attachment_count,
    coalesce(sum(byte_count) filter (where charged), 0) as accounted_bytes,
    min(updated_at) filter (where state in ('deleting', 'abandoned') and charged)
        as oldest_pending_purge
from private.renewal_evidence
group by state
order by state;
select
    count(*) as due_unverified_paths,
    min(next_check_at) as oldest_due,
    count(*) filter (where failures > 0) as retrying_paths,
    count(*) filter (where claim_until > clock_timestamp()) as leased_paths
from private.renewal_evidence_objects
where state <> 'verified' and next_check_at <= clock_timestamp();
