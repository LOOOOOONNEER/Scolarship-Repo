-- Source freshness for the admin dashboard and the worker heartbeat.
-- security_invoker: the caller's own grants and RLS apply.

create view public.source_health
with (security_invoker = true)
as
select
  s.id,
  s.url,
  s.tier,
  s.active,
  s.submission_only,
  s.last_checked_at,
  s.last_success_at,
  s.consecutive_failures,
  s.valid_offerings_found,
  (s.active and not s.submission_only
   and (s.last_success_at is null or s.last_success_at < now() - 2 * s.crawl_interval)) as is_stale,
  (s.consecutive_failures >= 3) as is_failing
from public.sources s;

revoke all on public.source_health from anon, authenticated;
grant select on public.source_health to authenticated, discovery_worker;
