-- Student-owned data. Never readable by the discovery worker.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  birth_date date check (birth_date > date '1900-01-01'),
  education_level public.education_level,
  enrollment_status public.enrollment_status,
  school_name text,
  school_type public.school_type,
  program_name text,
  ched_discipline text,
  -- Grade exactly as written, with its scale and where it came from.
  grade_value numeric(6, 2),
  grade_scale text references public.grade_scales (code),
  grade_source text check (grade_source in ('report_card', 'transcript', 'self_reported')),
  residence_province_id bigint references public.localities (id),
  residence_locality_id bigint references public.localities (id),
  residency_years numeric(4, 1) check (residency_years >= 0),
  parent_registered_voter boolean,
  income_bracket smallint references public.income_brackets (id),
  is_4ps boolean,
  citizenship text,
  holds_other_scholarship boolean,
  notify_push boolean not null default true,
  notify_email boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  constraint profiles_grade_complete check ((grade_value is null) = (grade_scale is null))
);

-- Sensitive categories live in their own table so consent can be enforced and
-- withdrawn field by field. Asked only when a scholarship for that group exists.
create table public.profile_sensitive (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  is_pwd boolean,
  is_indigenous boolean,
  is_solo_parent_child boolean,
  is_ofw_dependent boolean,
  is_athlete boolean,
  is_first_gen boolean,
  updated_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  consent_type text not null check (consent_type in (
    'privacy_notice', 'guardian',
    'sensitive:is_pwd', 'sensitive:is_indigenous', 'sensitive:is_solo_parent_child',
    'sensitive:is_ofw_dependent', 'sensitive:is_athlete', 'sensitive:is_first_gen'
  )),
  notice_version text not null,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  guardian_name text,
  guardian_contact text,
  constraint consents_guardian_details check (
    consent_type <> 'guardian' or (guardian_name is not null and guardian_contact is not null)
  ),
  constraint consents_withdraw_after_grant check (withdrawn_at is null or withdrawn_at >= granted_at)
);
create unique index consents_one_active_per_type
  on public.consents (user_id, consent_type) where withdrawn_at is null;

create table public.matches (
  user_id uuid not null references auth.users (id) on delete cascade,
  offering_id uuid not null references public.offerings (id) on delete cascade,
  result public.match_result not null,
  reasons jsonb not null default '[]',
  conversion_ids uuid[] not null default '{}',
  computed_at timestamptz not null default now(),
  saved boolean not null default false,
  dismissed boolean not null default false,
  primary key (user_id, offering_id)
);
create index matches_offering_idx on public.matches (offering_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  offering_id uuid references public.offerings (id) on delete cascade,
  kind text not null check (kind in ('new_match', 'deadline', 'offering_changed', 'offering_closed', 'system')),
  channel text not null check (channel in ('push', 'email', 'inbox')),
  title text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);

-- Links or poster images students submit (the only route for Facebook-only posts).
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  url text check (url ~ '^https?://'),
  note text check (char_length(note) <= 1000),
  image_path text,
  status text not null default 'new' check (status in ('new', 'processing', 'processed', 'rejected')),
  created_at timestamptz not null default now(),
  check (url is not null or image_path is not null)
);

create table public.error_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  offering_id uuid not null references public.offerings (id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);
