-- Admin behaviour. Admins manage the catalog but cannot read student answers.

select tests.login('00000000-0000-0000-0000-0000000000ad');
set role authenticated;

select tests.ok(public.is_admin(), 'is_admin() is true for the admin');
select tests.ok((select count(*) from public.offerings) = 5, 'admin sees drafts as well as published offerings');
select tests.ok((select count(*) from public.profiles) = 0, 'admin cannot read student profiles');
select tests.ok((select count(*) from public.profile_sensitive) = 0, 'admin cannot read sensitive answers');
select tests.ok((select count(*) from public.consents) = 0, 'admin cannot read consents');
select tests.ok((select count(*) from public.matches) = 0, 'admin cannot read matches');
select tests.ok((select count(*) from public.submissions) = 1, 'admin can triage submissions');

select tests.throws(
  $$update public.offerings set publish_state = 'published' where id = '30000000-0000-0000-0000-000000000002'$$,
  '23514', 'an offering without a verified status, deadline and apply link cannot be published');

update public.offerings set closes_on = closes_on + 7 where id = '30000000-0000-0000-0000-000000000001';
select tests.ok(exists (
  select 1 from public.change_log
  where offering_id = '30000000-0000-0000-0000-000000000001' and field_name = 'closes_on' and not auto_applied
), 'deadline changes are recorded in the change log');

-- An authoritative equivalency lets B's percentage grade be compared.
insert into public.grade_conversions (from_scale, to_scale, mapping, offering_id, source_url, source_description)
values ('percent', 'ph_1_to_5', '[{"from_min": 89, "from_max": 91.99, "to": 1.75}]',
        '30000000-0000-0000-0000-000000000005', 'https://example.gov.ph/test-equivalency',
        'Test equivalency table published by the provider');

select tests.ok(exists (select 1 from public.audit_log where table_name = 'offerings' and action = 'update'),
  'admin actions are written to the audit log');
select tests.ok(not exists (select 1 from public.audit_log where table_name in ('profiles', 'profile_sensitive', 'consents')),
  'the audit log holds no student answers');
reset role;

select tests.login('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select tests.ok((select result from public.matches where offering_id = '30000000-0000-0000-0000-000000000005') = 'eligible',
  'with an authoritative conversion, B''s 90% compares as 1.75 and is eligible');
select tests.ok((select cardinality(conversion_ids) from public.matches
                 where offering_id = '30000000-0000-0000-0000-000000000005') = 1,
  'the match records which conversion rule it used');
reset role;
select tests.logout();
