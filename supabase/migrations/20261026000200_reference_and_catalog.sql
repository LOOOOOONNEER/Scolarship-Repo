-- Reference data and the scholarship catalog.

-- ---------------------------------------------------------------- reference

create table public.regions (
  code text primary key,
  name text not null
);

-- Provinces, cities and municipalities. psgc_code is filled from the official
-- PSGC publication when it is imported; it is never guessed.
create table public.localities (
  id bigint generated always as identity primary key,
  region_code text not null references public.regions (code),
  parent_id bigint references public.localities (id),
  kind text not null check (kind in ('province', 'city', 'municipality')),
  name text not null,
  psgc_code text unique,
  constraint localities_unique_name unique nulls not distinct (region_code, parent_id, kind, name),
  constraint localities_province_has_no_parent check (kind <> 'province' or parent_id is null)
);

-- Grading scales. A grade is always stored with its scale; conversions between
-- scales happen only through grade_conversions (authoritative sources only).
create table public.grade_scales (
  code text primary key,
  label text not null,
  min_value numeric(6, 2) not null,
  max_value numeric(6, 2) not null,
  lower_is_better boolean not null,
  check (min_value < max_value)
);

-- Income brackets are the app's own answer options (annual household income).
-- Provider ceilings are compared against them; a bracket that straddles a
-- ceiling yields "needs verification", never a guess.
create table public.income_brackets (
  id smallint primary key,
  label text not null,
  min_php_annual numeric(12, 2) not null,
  max_php_annual numeric(12, 2),
  check (max_php_annual is null or min_php_annual < max_php_annual)
);

-- ---------------------------------------------------------------- catalog

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.provider_kind not null,
  official_domains text[] not null default '{}',
  region_code text references public.regions (code),
  locality_id bigint references public.localities (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, kind)
);

-- A recurring program (e.g. a provincial scholarship that runs every year).
create table public.scholarship_programs (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete restrict,
  name text not null,
  normalized_name text not null,
  description text,
  region_code text references public.regions (code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, normalized_name)
);
create index scholarship_programs_name_trgm
  on public.scholarship_programs using gin (normalized_name extensions.gin_trgm_ops);

-- One application cycle of a program.
create table public.offerings (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.scholarship_programs (id) on delete cascade,
  academic_year text not null check (academic_year ~ '^\d{4}-\d{4}$'),
  publish_state public.publish_state not null default 'draft',
  application_status public.application_status not null default 'unknown',
  opens_on date,
  closes_on date,
  rolling_admission boolean not null default false,
  status_verified_at timestamptz,
  status_source_url text check (status_source_url ~ '^https?://'),
  status_evidence text,
  benefits text,
  apply_url text check (apply_url ~ '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid,
  constraint offerings_window check (opens_on is null or closes_on is null or opens_on <= closes_on),
  constraint offerings_rolling_has_no_close check (not rolling_admission or closes_on is null),
  -- Never published with an unverified deadline, status or apply link.
  constraint offerings_publish_requires_verification check (
    publish_state <> 'published' or (
      apply_url is not null
      and status_verified_at is not null
      and status_source_url is not null
      and application_status <> 'unknown'
      and (closes_on is not null or rolling_admission)
    )
  )
);
create index offerings_program_idx on public.offerings (program_id);
create index offerings_published_idx on public.offerings (publish_state, application_status, closes_on);

-- Eligibility, stored as structured rules where possible.
--   criterion     : evaluated against the student profile
--   unstructured  : an eligibility condition that could not be structured -> "needs verification"
--   also_required : essays, interviews, exams; shown to students, never evaluated
create table public.eligibility_rules (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.offerings (id) on delete cascade,
  kind text not null default 'criterion' check (kind in ('criterion', 'unstructured', 'also_required')),
  field text check (field in (
    'education_level', 'enrollment_status', 'school_type', 'ched_discipline',
    'grade', 'residence_province_id', 'residence_locality_id', 'residency_years',
    'parent_registered_voter', 'income', 'is_4ps', 'citizenship', 'holds_other_scholarship', 'age',
    'is_pwd', 'is_indigenous', 'is_solo_parent_child', 'is_ofw_dependent', 'is_athlete', 'is_first_gen'
  )),
  operator text check (operator in (
    'eq', 'neq', 'in', 'not_in', 'lt', 'lte', 'gt', 'gte', 'is_true', 'is_false',
    'income_max_php', 'income_min_php'
  )),
  value jsonb,
  grade_scale text references public.grade_scales (code),
  description text not null,   -- plain-language wording shown to students
  created_at timestamptz not null default now(),
  constraint eligibility_rules_criterion_complete check (
    kind <> 'criterion' or (field is not null and operator is not null)
  ),
  constraint eligibility_rules_grade_has_scale check (field is distinct from 'grade' or grade_scale is not null),
  constraint eligibility_rules_income_ops check (
    (field = 'income') = (operator in ('income_max_php', 'income_min_php'))
    or kind <> 'criterion'
  )
);
create index eligibility_rules_offering_idx on public.eligibility_rules (offering_id);

-- Authoritative grade equivalencies only (the scholarship's own table, or a
-- school's published scale). mapping = [{"from_min":1.0,"from_max":1.25,"to":97}, ...]
create table public.grade_conversions (
  id uuid primary key default gen_random_uuid(),
  from_scale text not null references public.grade_scales (code),
  to_scale text not null references public.grade_scales (code),
  mapping jsonb not null check (jsonb_typeof(mapping) = 'array' and jsonb_array_length(mapping) > 0),
  offering_id uuid references public.offerings (id) on delete cascade,
  school_name text,
  source_url text not null check (source_url ~ '^https?://'),
  source_description text not null,
  verified_by uuid,
  created_at timestamptz not null default now(),
  check (from_scale <> to_scale)
);
create index grade_conversions_lookup_idx on public.grade_conversions (from_scale, to_scale);

-- Field-level history of offerings.
create table public.change_log (
  id bigint generated always as identity primary key,
  offering_id uuid not null references public.offerings (id) on delete cascade,
  field_name text not null,
  old_value text,
  new_value text,
  source_url text,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  auto_applied boolean not null default false
);
create index change_log_offering_idx on public.change_log (offering_id, changed_at desc);
