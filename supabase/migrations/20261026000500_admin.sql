-- Admin and operations tables.

-- Roles are granted with SQL only (see README), never through the API.
create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.job_status not null default 'running',
  pages_fetched integer not null default 0,
  llm_calls integer not null default 0,
  errors integer not null default 0,
  error_summary text,
  details jsonb not null default '{}'
);
create index job_runs_recent_idx on public.job_runs (job_name, started_at desc);

create table public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  kind public.review_kind not null,
  ref_table text not null,
  ref_id uuid not null,
  summary text not null,
  status public.task_status not null default 'open',
  assigned_to uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create index review_tasks_open_idx on public.review_tasks (status, created_at);

-- Monthly manual coverage audits (recall = found_by_system / available).
create table public.coverage_audits (
  id uuid primary key default gen_random_uuid(),
  audit_month date not null,
  province_ids bigint[] not null,
  available_count integer not null check (available_count >= 0),
  found_by_system_count integer not null check (found_by_system_count >= 0),
  recall numeric(5, 4) generated always as (
    case when available_count > 0 then found_by_system_count::numeric / available_count end
  ) stored,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (found_by_system_count <= available_count)
);

-- Who did what. Never stores questionnaire answers or other personal values.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_role text not null,
  action text not null,
  table_name text not null,
  record_id text,
  changed_fields text[]
);
create index audit_log_at_idx on public.audit_log (at desc);
