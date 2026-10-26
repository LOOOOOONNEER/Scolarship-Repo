-- Roles, grants and row-level security.
--
-- Three kinds of callers:
--   anon / authenticated  : the PWA, through Supabase's API (RLS decides rows)
--   admin / reviewer      : authenticated users listed in user_roles
--   discovery_worker      : the GitHub Actions worker, connecting directly to Postgres.
--                           It can write pipeline and catalog tables and has NO grant
--                           on any student table. It is not given the service-role key.

-- Security-definer functions (matching, consent handling, the worker's submissions
-- view) run as the migration owner and must bypass RLS. Supabase's `postgres`
-- role does; stop here if that ever changes, instead of failing silently.
do $$
begin
  if not (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) then
    raise exception 'migrations must run as a role that bypasses RLS (got %)', current_user;
  end if;
end
$$;

-- ---------------------------------------------------------------- helpers

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.is_reviewer()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'reviewer')
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_reviewer() from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_reviewer() to anon, authenticated;

-- ---------------------------------------------------------------- worker role

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'discovery_worker') then
    -- No password here: set one in the SQL editor after deploying (see README).
    create role discovery_worker login noinherit;
  end if;
end
$$;

-- Start from nothing: Supabase grants new public tables to anon/authenticated by default.
revoke all on all tables in schema public from anon, authenticated, discovery_worker;
revoke all on all functions in schema public from anon, authenticated, discovery_worker;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_reviewer() to anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

grant usage on schema public to discovery_worker;

-- ---------------------------------------------------------------- grants: public catalog

grant select on public.regions, public.localities, public.grade_scales, public.income_brackets,
  public.providers, public.scholarship_programs, public.offerings, public.eligibility_rules,
  public.grade_conversions, public.change_log
  to anon, authenticated;

-- ---------------------------------------------------------------- grants: students

grant select, insert, update, delete on public.profiles, public.profile_sensitive to authenticated;
grant select, insert on public.consents to authenticated;
grant update (withdrawn_at) on public.consents to authenticated;
grant select on public.matches to authenticated;
grant update (saved, dismissed) on public.matches to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant select, insert on public.submissions, public.error_reports to authenticated;
grant update (status) on public.submissions, public.error_reports to authenticated;

-- ---------------------------------------------------------------- grants: admin and reviewers
-- (authenticated holds the table privilege; RLS limits rows to reviewers/admins)

grant insert, update, delete on public.providers, public.scholarship_programs, public.offerings,
  public.eligibility_rules, public.grade_conversions, public.sources
  to authenticated;
grant select, insert, update, delete on public.offering_sources to authenticated;
grant select on public.sources, public.source_suggestions, public.fetch_queue, public.raw_documents,
  public.extracted_candidates, public.field_evidence, public.job_runs, public.review_tasks,
  public.coverage_audits, public.audit_log, public.user_roles
  to authenticated;
grant update (status, reviewed_by) on public.source_suggestions to authenticated;
grant update (status) on public.extracted_candidates to authenticated;
grant update (status, assigned_to, resolved_at, resolution) on public.review_tasks to authenticated;
grant insert, update on public.coverage_audits to authenticated;

-- ---------------------------------------------------------------- grants: discovery worker

grant select on public.regions, public.localities, public.grade_scales, public.income_brackets,
  public.providers to discovery_worker;
grant select, insert, update on public.sources, public.source_suggestions, public.raw_documents,
  public.extracted_candidates, public.scholarship_programs, public.offerings
  to discovery_worker;
grant select, insert, update, delete on public.fetch_queue, public.field_evidence,
  public.eligibility_rules, public.offering_sources
  to discovery_worker;
grant select, insert on public.change_log, public.review_tasks to discovery_worker;
grant select, insert, update on public.job_runs to discovery_worker;
grant select on public.grade_conversions to discovery_worker;

-- Submissions without the submitting student's id.
create view public.submissions_for_worker
with (security_barrier = true)
as select id, url, note, image_path, status, created_at from public.submissions;
revoke all on public.submissions_for_worker from anon, authenticated;
grant select on public.submissions_for_worker to discovery_worker;

create or replace function public.worker_set_submission_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_status not in ('processing', 'processed', 'rejected') then
    raise exception 'invalid submission status %', p_status using errcode = '22023';
  end if;
  update public.submissions set status = p_status where id = p_id;
end;
$$;
revoke all on function public.worker_set_submission_status(uuid, text) from public;
grant execute on function public.worker_set_submission_status(uuid, text) to discovery_worker;

-- ---------------------------------------------------------------- RLS on every table

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- reference data: readable by everyone, managed by admins
create policy "reference readable" on public.regions for select to anon, authenticated, discovery_worker using (true);
create policy "reference readable" on public.localities for select to anon, authenticated, discovery_worker using (true);
create policy "reference readable" on public.grade_scales for select to anon, authenticated, discovery_worker using (true);
create policy "reference readable" on public.income_brackets for select to anon, authenticated, discovery_worker using (true);

-- providers
create policy "providers readable" on public.providers for select to anon, authenticated, discovery_worker using (true);
create policy "providers managed by reviewers" on public.providers for all to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));

-- programs: public only when they have a published offering
create policy "programs readable when published" on public.scholarship_programs for select to anon, authenticated
  using (
    (select public.is_reviewer())
    or exists (select 1 from public.offerings o where o.program_id = scholarship_programs.id and o.publish_state = 'published')
  );
create policy "programs managed by reviewers" on public.scholarship_programs for all to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));
create policy "programs worker" on public.scholarship_programs for all to discovery_worker using (true) with check (true);

-- offerings
create policy "offerings readable when published" on public.offerings for select to anon, authenticated
  using (publish_state = 'published' or (select public.is_reviewer()));
create policy "offerings managed by reviewers" on public.offerings for all to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));
create policy "offerings worker" on public.offerings for all to discovery_worker using (true) with check (true);

-- eligibility rules
create policy "rules readable when published" on public.eligibility_rules for select to anon, authenticated
  using (
    (select public.is_reviewer())
    or exists (select 1 from public.offerings o where o.id = eligibility_rules.offering_id and o.publish_state = 'published')
  );
create policy "rules managed by reviewers" on public.eligibility_rules for all to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));
create policy "rules worker" on public.eligibility_rules for all to discovery_worker using (true) with check (true);

-- grade conversions: public for transparency
create policy "conversions readable" on public.grade_conversions for select to anon, authenticated, discovery_worker using (true);
create policy "conversions managed by reviewers" on public.grade_conversions for all to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));

-- change log: visible for published offerings; written by triggers and the worker
create policy "changes readable when published" on public.change_log for select to anon, authenticated
  using (
    (select public.is_reviewer())
    or exists (select 1 from public.offerings o where o.id = change_log.offering_id and o.publish_state = 'published')
  );
create policy "changes worker" on public.change_log for all to discovery_worker using (true) with check (true);

-- offering sources
create policy "offering sources reviewers" on public.offering_sources for all to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));
create policy "offering sources worker" on public.offering_sources for all to discovery_worker using (true) with check (true);

-- discovery tables: worker writes, reviewers read and triage
create policy "sources reviewers" on public.sources for all to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));
create policy "sources worker" on public.sources for all to discovery_worker using (true) with check (true);

create policy "suggestions reviewers" on public.source_suggestions for all to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));
create policy "suggestions worker" on public.source_suggestions for all to discovery_worker using (true) with check (true);

create policy "queue reviewers read" on public.fetch_queue for select to authenticated using ((select public.is_reviewer()));
create policy "queue worker" on public.fetch_queue for all to discovery_worker using (true) with check (true);

create policy "documents reviewers read" on public.raw_documents for select to authenticated using ((select public.is_reviewer()));
create policy "documents worker" on public.raw_documents for all to discovery_worker using (true) with check (true);

create policy "candidates reviewers" on public.extracted_candidates for all to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));
create policy "candidates worker" on public.extracted_candidates for all to discovery_worker using (true) with check (true);

create policy "evidence reviewers read" on public.field_evidence for select to authenticated using ((select public.is_reviewer()));
create policy "evidence worker" on public.field_evidence for all to discovery_worker using (true) with check (true);

-- student tables: owner only (no reviewer or admin access to answers)
create policy "own profile" on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own sensitive answers" on public.profile_sensitive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own consents" on public.consents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own matches" on public.matches for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own notifications" on public.notifications for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- submissions and error reports: students file their own, reviewers triage
create policy "file own submission" on public.submissions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "read own or review submissions" on public.submissions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_reviewer()));
create policy "reviewers update submissions" on public.submissions for update to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));

create policy "file own error report" on public.error_reports for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "read own or review reports" on public.error_reports for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_reviewer()));
create policy "reviewers update reports" on public.error_reports for update to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));

-- admin tables
create policy "see own roles" on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "jobs reviewers read" on public.job_runs for select to authenticated using ((select public.is_reviewer()));
create policy "jobs worker" on public.job_runs for all to discovery_worker using (true) with check (true);

create policy "tasks reviewers" on public.review_tasks for all to authenticated
  using ((select public.is_reviewer())) with check ((select public.is_reviewer()));
create policy "tasks worker" on public.review_tasks for all to discovery_worker using (true) with check (true);

create policy "audits reviewers read" on public.coverage_audits for select to authenticated using ((select public.is_reviewer()));
create policy "audits admins write" on public.coverage_audits for insert to authenticated with check ((select public.is_admin()));
create policy "audits admins update" on public.coverage_audits for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "audit log admins read" on public.audit_log for select to authenticated using ((select public.is_admin()));
