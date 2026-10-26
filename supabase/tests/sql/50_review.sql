-- Review workflow: approve / reject candidates, duplicate lookup. Run as a superuser that switches roles.

-- A document and two candidates, as the worker would leave them.
insert into public.raw_documents (id, url, content_hash, text_content)
values ('40000000-0000-0000-0000-000000000001', 'https://example.gov.ph/test-announcement', 'h1', 'Test text');
insert into public.extracted_candidates (id, raw_document_id, model, schema_version, payload, status, summary)
values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'fake', 'v1', '{}', 'needs_review', 'Test candidate 1'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'fake', 'v1', '{}', 'pending', 'Test candidate 2');
insert into public.review_tasks (kind, ref_table, ref_id, summary) values
  ('new_offering', 'extracted_candidates', '50000000-0000-0000-0000-000000000001', 'New: test 1'),
  ('new_offering', 'extracted_candidates', '50000000-0000-0000-0000-000000000002', 'New: test 2');

create temporary table approve_input as
select jsonb_build_object(
  'provider', jsonb_build_object('name', 'Test City Government', 'kind', 'lgu', 'official_domains', jsonb_build_array('example.gov.ph')),
  'program_name', 'Test City Scholarship',
  'academic_year', '2027-2028',
  'application_status', 'open_verified',
  'opens_on', (current_date - 1)::text,
  'closes_on', (current_date + 25)::text,
  'status_source_url', 'https://example.gov.ph/test-announcement',
  'apply_url', 'https://example.gov.ph/test-apply',
  'benefits', 'Test benefit',
  'rules', jsonb_build_array(
    jsonb_build_object('kind', 'criterion', 'field', 'residence_province_id', 'operator', 'eq',
                       'value', (select id from public.localities where name = 'Tarlac'), 'description', 'Resident of Tarlac'),
    jsonb_build_object('kind', 'criterion', 'field', 'grade', 'operator', 'lte', 'value', 2.0,
                       'grade_scale', 'ph_1_to_5', 'description', 'GWA 2.00 or better'),
    jsonb_build_object('kind', 'also_required', 'description', 'Interview')
  )
) as data;
grant select on approve_input to authenticated, anon;

-- ---------------------------------------------------------------- anonymous and students cannot decide
select tests.logout();
set role anon;
select tests.throws($$select public.approve_candidate('50000000-0000-0000-0000-000000000001', (select data from approve_input))$$,
  '42501', 'anon cannot approve candidates');
reset role;

select tests.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select tests.throws($$select public.approve_candidate('50000000-0000-0000-0000-000000000001', (select data from approve_input))$$,
  '42501', 'a student cannot approve candidates');
select tests.throws($$select public.reject_candidate('50000000-0000-0000-0000-000000000002', 'spam')$$,
  '42501', 'a student cannot reject candidates');
reset role;

-- ---------------------------------------------------------------- admin
select tests.login('00000000-0000-0000-0000-0000000000ad');
set role authenticated;

select tests.ok(exists (select 1 from public.similar_programs('Test Merit Scholarship Program')
                        where program_name = 'Test Merit Scholarship'),
  'similar_programs finds an existing program with a close name');

select tests.throws(
  $$select public.approve_candidate('50000000-0000-0000-0000-000000000001',
      (select data || '{"publish": true}'::jsonb from approve_input))$$,
  '23514', 'publishing without confirming the status on the official page is refused');
select tests.ok((select status from public.extracted_candidates where id = '50000000-0000-0000-0000-000000000001') = 'needs_review',
  'a refused approval changes nothing');
select tests.ok(not exists (select 1 from public.scholarship_programs where name = 'Test City Scholarship'),
  'a refused approval leaves no half-made records');

create temporary table approved as
select public.approve_candidate('50000000-0000-0000-0000-000000000001',
  (select data || '{"publish": true, "status_verified": true}'::jsonb from approve_input)) as offering_id;

select tests.ok((select publish_state from public.offerings where id = (select offering_id from approved)) = 'published',
  'approve with verification publishes the offering');
select tests.ok((select status_verified_at is not null from public.offerings where id = (select offering_id from approved)),
  'the verification time is recorded');
select tests.ok((select count(*) from public.eligibility_rules where offering_id = (select offering_id from approved)) = 3,
  'eligibility rules are created');
select tests.ok(exists (select 1 from public.offering_sources where offering_id = (select offering_id from approved)
                        and raw_document_id = '40000000-0000-0000-0000-000000000001'),
  'the offering is linked to its source document');
select tests.ok((select status from public.extracted_candidates where id = '50000000-0000-0000-0000-000000000001') = 'approved',
  'the candidate is marked approved');
select tests.ok((select status from public.review_tasks where ref_id = '50000000-0000-0000-0000-000000000001') = 'resolved',
  'its review task is resolved');
select tests.throws($$select public.approve_candidate('50000000-0000-0000-0000-000000000001', (select data from approve_input))$$,
  '22023', 'a candidate cannot be approved twice');

select tests.throws($$select public.reject_candidate('50000000-0000-0000-0000-000000000002', '  ')$$,
  '22023', 'rejecting needs a reason');
select public.reject_candidate('50000000-0000-0000-0000-000000000002', 'Not a scholarship');
select tests.ok((select status from public.extracted_candidates where id = '50000000-0000-0000-0000-000000000002') = 'rejected',
  'the candidate is rejected');
select tests.ok((select resolution from public.review_tasks where ref_id = '50000000-0000-0000-0000-000000000002')
                = 'rejected: Not a scholarship', 'the rejection reason is kept on the review task');
reset role;

-- ---------------------------------------------------------------- the published offering reaches matching
select tests.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select tests.ok((select m.result from public.matches m join approved a on a.offering_id = m.offering_id) = 'eligible',
  'student A (Tarlac, 1.75) is matched as eligible to the newly published offering');
reset role;
select tests.logout();

-- ---------------------------------------------------------------- Phase 3: shared lists and sensitive questions
select tests.logout();
set role anon;
select tests.ok((select count(*) from public.course_fields) >= 10, 'anyone can read the course field list');
select tests.ok(not exists (select 1 from public.sensitive_questions_in_use()),
  'no sensitive question is asked while no published scholarship needs one');
reset role;

insert into public.eligibility_rules (offering_id, kind, field, operator, description)
select offering_id, 'criterion', 'is_pwd', 'is_true', 'Person with disability' from approved;

set role anon;
select tests.ok(array(select public.sensitive_questions_in_use()) = array['is_pwd'],
  'a sensitive question appears once a published scholarship uses it');
reset role;

-- ---------------------------------------------------------------- withdrawing the privacy notice
select tests.login('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select tests.ok(exists (select 1 from public.profiles), 'B has a profile before withdrawing');
update public.consents set withdrawn_at = now() where consent_type = 'privacy_notice' and withdrawn_at is null;
select tests.ok(not exists (select 1 from public.profiles), 'withdrawing the privacy notice deletes the questionnaire answers');
select tests.ok(not exists (select 1 from public.matches), 'and the matches');
reset role;
select tests.logout();
