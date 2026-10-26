-- Anonymous visitors and students. Run as a superuser that switches roles.

-- ---------------------------------------------------------------- anonymous
select tests.logout();
set role anon;

select tests.ok((select count(*) from public.offerings) = 4, 'anon sees only the 4 published offerings');
select tests.ok(not exists (select 1 from public.offerings where publish_state <> 'published'),
  'anon never sees drafts');
select tests.ok((select count(*) from public.eligibility_rules
                 where offering_id = '30000000-0000-0000-0000-000000000002') = 0,
  'anon cannot see rules of a draft');
select tests.throws('select * from public.profiles', '42501', 'anon cannot read profiles');
select tests.throws('select * from public.matches', '42501', 'anon cannot read matches');
select tests.throws('select * from public.raw_documents', '42501', 'anon cannot read raw documents');
select tests.throws('select * from public.source_health', '42501', 'anon cannot read source health');
select tests.throws($$insert into public.submissions (url) values ('https://example.org/x')$$, '42501',
  'anon cannot file submissions');
reset role;

-- ---------------------------------------------------------------- student A (adult, Tarlac)
select tests.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;

insert into public.consents (user_id, consent_type, notice_version)
values ('00000000-0000-0000-0000-00000000000a', 'privacy_notice', 'test');
insert into public.profiles (user_id, birth_date, education_level, enrollment_status, school_type,
  grade_value, grade_scale, grade_source, residence_province_id, income_bracket, citizenship)
values ('00000000-0000-0000-0000-00000000000a', date '2006-01-15', 'second_year', 'enrolled', 'suc',
  1.75, 'ph_1_to_5', 'report_card', (select id from public.localities where name = 'Tarlac'), 2, 'filipino');

select tests.throws(
  $$insert into public.profiles (user_id) values ('00000000-0000-0000-0000-00000000000b')$$,
  '42501', 'a student cannot create a profile for someone else');
select tests.ok((select count(*) from public.profiles) = 1, 'student A sees only their own profile');

select tests.ok((select result from public.matches where offering_id = '30000000-0000-0000-0000-000000000001') = 'eligible',
  'A is eligible: Tarlac resident with 1.75 on the same scale');
select tests.ok((select reasons @> '[{"outcome":"pass"}]' from public.matches
                 where offering_id = '30000000-0000-0000-0000-000000000001'),
  'match reasons are recorded');
select tests.ok(not (select reasons::text like '%Essay%' from public.matches
                     where offering_id = '30000000-0000-0000-0000-000000000001'),
  '"also required" items are not evaluated as conditions');
select tests.ok((select result from public.matches where offering_id = '30000000-0000-0000-0000-000000000003') = 'needs_verification',
  'income bracket that straddles the ceiling needs verification');
select tests.ok((select result from public.matches where offering_id = '30000000-0000-0000-0000-000000000004') = 'needs_verification',
  'an offering with no rules is never "eligible"');
select tests.ok(not exists (select 1 from public.matches where offering_id = '30000000-0000-0000-0000-000000000002'),
  'no matches against drafts');

select tests.throws($$update public.matches set result = 'eligible'$$, '42501', 'students cannot change match results');
update public.matches set saved = true where offering_id = '30000000-0000-0000-0000-000000000001';
select tests.ok((select saved from public.matches where offering_id = '30000000-0000-0000-0000-000000000001'),
  'students can save a match');

select tests.ok((select count(*) from public.raw_documents) = 0, 'students see no raw documents');
select tests.ok((select count(*) from public.audit_log) = 0, 'students see no audit log');
select tests.ok((select count(*) from public.job_runs) = 0, 'students see no job runs');
select tests.ok((select count(*) from public.source_health) = 0, 'students see no source health rows');
select tests.throws($$insert into public.user_roles values ('00000000-0000-0000-0000-00000000000a', 'admin')$$,
  '42501', 'students cannot make themselves admin');
-- RLS makes an unauthorized update affect 0 rows rather than raise an error.
update public.offerings set benefits = 'tampered';
select tests.ok(not exists (select 1 from public.offerings where benefits = 'tampered'),
  'student updates to offerings affect no rows');

select tests.throws('select private.recompute_user(''00000000-0000-0000-0000-00000000000b'')', '42501',
  'students cannot call private functions');

-- sensitive answers need consent
select tests.throws(
  $$insert into public.profile_sensitive (user_id, is_pwd) values ('00000000-0000-0000-0000-00000000000a', true)$$,
  '42501', 'a sensitive answer without consent is refused');
insert into public.consents (user_id, consent_type, notice_version)
values ('00000000-0000-0000-0000-00000000000a', 'sensitive:is_pwd', 'v1');
insert into public.profile_sensitive (user_id, is_pwd) values ('00000000-0000-0000-0000-00000000000a', true);
select tests.ok((select is_pwd from public.profile_sensitive), 'with consent the answer is stored');
select tests.throws(
  $$update public.profile_sensitive set is_indigenous = true$$,
  '42501', 'consent for one field does not cover another');

update public.consents set withdrawn_at = now() where consent_type = 'sensitive:is_pwd';
select tests.ok((select is_pwd from public.profile_sensitive) is null, 'withdrawing consent deletes the answer');
select tests.throws($$update public.consents set withdrawn_at = null$$, '42501', 'a withdrawal is final');

insert into public.submissions (user_id, url, note)
values ('00000000-0000-0000-0000-00000000000a', 'https://example.org/poster', 'Seen on a town page');
select tests.ok((select public.export_my_data() -> 'profile' ->> 'user_id') = '00000000-0000-0000-0000-00000000000a',
  'export returns the student''s own data');
select tests.ok(jsonb_array_length(public.export_my_data() -> 'submissions') = 1, 'export includes submissions');
reset role;

-- ---------------------------------------------------------------- student B (17, Pampanga)
select tests.login('00000000-0000-0000-0000-00000000000b');
set role authenticated;

select tests.ok((select count(*) from public.profiles) = 0, 'B cannot see A''s profile');
select tests.ok((select count(*) from public.matches) = 0, 'B cannot see A''s matches');
select tests.ok((select count(*) from public.consents) = 0, 'B cannot see A''s consents');
select tests.ok((select count(*) from public.submissions) = 0, 'B cannot see A''s submissions');
select tests.ok((select public.export_my_data() -> 'profile') = 'null'::jsonb, 'B''s export holds nothing of A''s');

select tests.throws(
  $$insert into public.profiles (user_id, birth_date) values ('00000000-0000-0000-0000-00000000000b', current_date - 6300)$$,
  '42501', 'a profile cannot be saved before agreeing to the privacy notice');
insert into public.consents (user_id, consent_type, notice_version)
values ('00000000-0000-0000-0000-00000000000b', 'privacy_notice', 'test');
select tests.throws(
  $$insert into public.profiles (user_id, citizenship) values ('00000000-0000-0000-0000-00000000000b', 'martian')$$,
  '23514', 'citizenship must be one of the listed answers');
select tests.throws(
  $$insert into public.profiles (user_id, ched_discipline) values ('00000000-0000-0000-0000-00000000000b', 'basket weaving')$$,
  '23503', 'course field must come from the shared list');

select tests.throws(
  $$insert into public.profiles (user_id, grade_value, grade_scale) values ('00000000-0000-0000-0000-00000000000b', 120, 'percent')$$,
  '23514', 'a grade outside its scale is refused');
select tests.throws(
  $$insert into public.profiles (user_id, grade_value) values ('00000000-0000-0000-0000-00000000000b', 90)$$,
  '23514', 'a grade without its scale is refused');

insert into public.profiles (user_id, birth_date, education_level, grade_value, grade_scale, grade_source,
  residence_province_id)
values ('00000000-0000-0000-0000-00000000000b', (current_date - interval '17 years')::date, 'incoming_freshman',
  90, 'percent', 'report_card', (select id from public.localities where name = 'Pampanga'));

select tests.ok((select result from public.matches where offering_id = '30000000-0000-0000-0000-000000000001') = 'not_eligible',
  'B is not eligible for a Tarlac-only offering');
select tests.ok((select result from public.matches where offering_id = '30000000-0000-0000-0000-000000000005') = 'needs_verification',
  'a percentage grade against a 1-5 rule with no authoritative conversion needs verification');
select tests.ok((select result from public.matches where offering_id = '30000000-0000-0000-0000-000000000003') = 'missing_information',
  'an unanswered income question gives "missing information"');

insert into public.consents (user_id, consent_type, notice_version)
values ('00000000-0000-0000-0000-00000000000b', 'sensitive:is_first_gen', 'v1');
select tests.throws(
  $$insert into public.profile_sensitive (user_id, is_first_gen) values ('00000000-0000-0000-0000-00000000000b', true)$$,
  '42501', 'a minor needs guardian consent before sensitive answers');
select tests.throws(
  $$insert into public.consents (user_id, consent_type, notice_version) values ('00000000-0000-0000-0000-00000000000b', 'guardian', 'v1')$$,
  '23514', 'guardian consent needs the guardian''s name and contact');
insert into public.consents (user_id, consent_type, notice_version, guardian_name, guardian_contact)
values ('00000000-0000-0000-0000-00000000000b', 'guardian', 'v1', 'Test Guardian', 'guardian@example.test');
insert into public.profile_sensitive (user_id, is_first_gen) values ('00000000-0000-0000-0000-00000000000b', true);
select tests.ok((select is_first_gen from public.profile_sensitive), 'with guardian consent the answer is stored');
update public.consents set withdrawn_at = now() where consent_type = 'guardian';
select tests.ok((select is_first_gen from public.profile_sensitive) is null,
  'withdrawing guardian consent deletes a minor''s sensitive answers');
reset role;
select tests.logout();
