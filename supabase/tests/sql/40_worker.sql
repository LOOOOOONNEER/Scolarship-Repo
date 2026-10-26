-- Run while CONNECTED as discovery_worker (not via SET ROLE), as in production.

select tests.ok(current_user = 'discovery_worker', 'connected as the discovery worker');

select tests.throws('select * from public.profiles', '42501', 'worker cannot read profiles');
select tests.throws('select * from public.profile_sensitive', '42501', 'worker cannot read sensitive answers');
select tests.throws('select * from public.consents', '42501', 'worker cannot read consents');
select tests.throws('select * from public.matches', '42501', 'worker cannot read matches');
select tests.throws('select * from public.notifications', '42501', 'worker cannot read notifications');
select tests.throws('select * from public.push_subscriptions', '42501', 'worker cannot read push subscriptions');
select tests.throws('select * from public.submissions', '42501', 'worker cannot read submissions directly');
select tests.throws('select * from auth.users', '42501', 'worker cannot read auth users');
select tests.throws('select public.export_my_data()', '42501', 'worker cannot call the export function');
select tests.throws('select private.purge_expired()', '42501', 'worker cannot call private functions');

select tests.ok((select count(*) from public.submissions_for_worker) = 1, 'worker sees submitted links');
select tests.ok(not exists (
  select 1 from information_schema.columns
  where table_name = 'submissions_for_worker' and column_name = 'user_id'
), 'submitted links reach the worker without the student''s id');
select public.worker_set_submission_status((select id from public.submissions_for_worker limit 1), 'processing');
select tests.ok((select status from public.submissions_for_worker limit 1) = 'processing',
  'worker can update a submission''s status');

insert into public.sources (url, tier, region_code) values ('https://example.gov.ph/scholarships', 1, 'R3');
select tests.ok((select is_stale from public.source_health where url = 'https://example.gov.ph/scholarships'),
  'a never-checked source shows as stale');

insert into public.job_runs (job_name) values ('test');
select tests.ok((select count(*) from public.job_runs where job_name = 'test') = 1, 'worker records job runs');

insert into public.offerings (program_id, academic_year)
values ('20000000-0000-0000-0000-000000000001', '2029-2030');
select tests.ok(exists (select 1 from public.offerings where academic_year = '2029-2030' and publish_state = 'draft'),
  'worker can create draft offerings');
select tests.throws(
  $$insert into public.offerings (program_id, academic_year, publish_state, application_status, closes_on,
      status_verified_at, status_source_url, apply_url)
    values ('20000000-0000-0000-0000-000000000001', '2030-2031', 'published', 'open_verified', current_date + 5,
      now(), 'https://example.gov.ph/s', 'https://example.gov.ph/a')$$,
  '42501', 'worker cannot publish');
select tests.throws(
  $$update public.offerings set closes_on = closes_on + 1 where id = '30000000-0000-0000-0000-000000000001'$$,
  '42501', 'worker cannot change the deadline of a published offering');
select tests.throws(
  $$update public.offerings set apply_url = 'https://example.org/other' where id = '30000000-0000-0000-0000-000000000001'$$,
  '42501', 'worker cannot change the apply link of a published offering');
select tests.throws(
  $$update public.offerings set application_status = 'suspended' where id = '30000000-0000-0000-0000-000000000001'$$,
  '42501', 'a suspension found by the worker needs review');

update public.offerings set application_status = 'open_unconfirmed'
where id = '30000000-0000-0000-0000-000000000003';
select tests.ok((select application_status from public.offerings where id = '30000000-0000-0000-0000-000000000003')
                = 'open_unconfirmed', 'worker can downgrade to "open, not recently confirmed"');
update public.offerings set application_status = 'open_verified', status_verified_at = now()
where id = '30000000-0000-0000-0000-000000000003';
select tests.ok((select application_status from public.offerings where id = '30000000-0000-0000-0000-000000000003')
                = 'open_verified', 'a fresh recheck can confirm it open again');
select tests.ok(exists (
  select 1 from public.change_log
  where offering_id = '30000000-0000-0000-0000-000000000003' and field_name = 'application_status' and auto_applied
), 'worker changes are logged as auto-applied');

select tests.throws(
  $$insert into public.eligibility_rules (offering_id, kind, field, operator, value, description)
    values ('30000000-0000-0000-0000-000000000001', 'criterion', 'age', 'lte', '25', 'Age 25 or younger')$$,
  '42501', 'worker cannot change eligibility of a published offering');

insert into public.review_tasks (kind, ref_table, ref_id, summary)
values ('offering_change', 'offerings', '30000000-0000-0000-0000-000000000001', 'Deadline on source page changed');
select tests.ok(true, 'worker can open review tasks for changes it may not apply');
