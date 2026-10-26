-- Test fixtures. Obviously fictional names and example.* URLs; never real records.
-- Users:   A = adult student in Tarlac, B = 17-year-old student in Pampanga,
--          AD = admin
-- Offerings:
--   O1 published: province = Tarlac AND grade <= 2.00 (1-5 scale)
--   O2 draft (not verified)
--   O3 published: income ceiling 200,000
--   O4 published: no rules recorded
--   O5 published: grade <= 2.00 (1-5 scale) only

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'student.a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'student.b@example.test'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.test');

insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000ad', 'admin');

insert into public.providers (id, name, kind, official_domains, region_code)
values ('10000000-0000-0000-0000-000000000001', 'Test Provincial Government', 'lgu', '{example.gov.ph}', 'R3');

insert into public.scholarship_programs (id, provider_id, name, normalized_name)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        'Test Merit Scholarship', 'test merit scholarship');

insert into public.offerings (id, program_id, academic_year, publish_state, application_status,
  opens_on, closes_on, status_verified_at, status_source_url, apply_url)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '2027-2028', 'published',
   'open_verified', current_date - 10, current_date + 20, now() - interval '1 day',
   'https://example.gov.ph/test-status', 'https://example.gov.ph/test-apply'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '2028-2029', 'draft',
   'unknown', null, null, null, null, null),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '2026-2027', 'published',
   'open_verified', current_date - 10, current_date + 20, now() - interval '1 day',
   'https://example.gov.ph/test-status', 'https://example.gov.ph/test-apply'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '2025-2026', 'published',
   'open_verified', current_date - 10, current_date + 20, now() - interval '1 day',
   'https://example.gov.ph/test-status', 'https://example.gov.ph/test-apply'),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '2024-2025', 'published',
   'open_verified', current_date - 10, current_date + 20, now() - interval '1 day',
   'https://example.gov.ph/test-status', 'https://example.gov.ph/test-apply');

insert into public.eligibility_rules (offering_id, kind, field, operator, value, grade_scale, description) values
  ('30000000-0000-0000-0000-000000000001', 'criterion', 'residence_province_id', 'eq',
   to_jsonb((select id from public.localities where name = 'Tarlac')), null, 'Resident of Tarlac'),
  ('30000000-0000-0000-0000-000000000001', 'criterion', 'grade', 'lte', '2.00', 'ph_1_to_5',
   'General weighted average of 2.00 or better'),
  ('30000000-0000-0000-0000-000000000001', 'also_required', null, null, null, null, 'Essay and interview'),
  ('30000000-0000-0000-0000-000000000003', 'criterion', 'income', 'income_max_php', '200000', null,
   'Annual household income of ₱200,000 or less'),
  ('30000000-0000-0000-0000-000000000005', 'criterion', 'grade', 'lte', '2.00', 'ph_1_to_5',
   'General weighted average of 2.00 or better');

select tests.ok(true, 'fixtures loaded');
