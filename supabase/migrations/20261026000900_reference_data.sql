-- Reference data needed in every environment.
-- No scholarship records are seeded: every record must come from a real, checked source.

insert into public.regions (code, name) values ('R3', 'Central Luzon (Region III)');

-- The seven provinces of Region III. Cities and municipalities, and all PSGC
-- codes, are imported from the official PSGC publication (see docs/reference-data.md).
insert into public.localities (region_code, kind, name) values
  ('R3', 'province', 'Aurora'),
  ('R3', 'province', 'Bataan'),
  ('R3', 'province', 'Bulacan'),
  ('R3', 'province', 'Nueva Ecija'),
  ('R3', 'province', 'Pampanga'),
  ('R3', 'province', 'Tarlac'),
  ('R3', 'province', 'Zambales');

-- Scale definitions describe the shape of each scale only; they are not equivalencies.
insert into public.grade_scales (code, label, min_value, max_value, lower_is_better) values
  ('ph_1_to_5', '1.00 to 5.00 (1.00 is highest)', 1.00, 5.00, true),
  ('percent', 'Percentage (0 to 100)', 0, 100, false),
  ('gpa_4', '0.00 to 4.00 (4.00 is highest)', 0, 4.00, false);

-- The app's own answer options for annual household income, in pesos.
-- Upper bounds are exclusive. Reviewers can adjust these before launch.
insert into public.income_brackets (id, label, min_php_annual, max_php_annual) values
  (1, 'Below ₱120,000 a year', 0, 120000),
  (2, '₱120,000 to ₱249,999 a year', 120000, 250000),
  (3, '₱250,000 to ₱399,999 a year', 250000, 400000),
  (4, '₱400,000 to ₱799,999 a year', 400000, 800000),
  (5, '₱800,000 to ₱1,599,999 a year', 800000, 1600000),
  (6, '₱1,600,000 a year or more', 1600000, null);
