-- Discovery pipeline tables. Written by the discovery worker role; read by reviewers.

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.providers (id) on delete set null,
  url text not null unique check (url ~ '^https?://'),
  tier smallint not null check (tier between 1 and 4),
  region_code text references public.regions (code),
  crawl_interval interval not null default interval '7 days',
  active boolean not null default true,
  submission_only boolean not null default false,  -- e.g. Facebook pages: never crawled
  robots_allowed boolean,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_changed_at timestamptz,
  consecutive_failures integer not null default 0,
  valid_offerings_found integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table public.source_suggestions (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~ '^https?://'),
  domain text not null,
  found_via text not null check (found_via in ('search', 'audit', 'link', 'submission')),
  query text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  unique (url)
);

create table public.fetch_queue (
  id bigint generated always as identity primary key,
  url text not null check (url ~ '^https?://'),
  source_id uuid references public.sources (id) on delete cascade,
  priority smallint not null default 5,
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'in_progress', 'done', 'dead')),
  last_error text,
  created_at timestamptz not null default now()
);
create unique index fetch_queue_one_pending_per_url
  on public.fetch_queue (url) where status in ('queued', 'in_progress');

create table public.raw_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources (id) on delete set null,
  url text not null,
  retrieved_at timestamptz not null default now(),
  http_status smallint,
  content_type text,
  content_hash text not null,
  text_content text,
  storage_path text,
  etag text,
  last_modified text
);
create index raw_documents_url_idx on public.raw_documents (url, retrieved_at desc);

create table public.extracted_candidates (
  id uuid primary key default gen_random_uuid(),
  raw_document_id uuid not null references public.raw_documents (id) on delete cascade,
  model text not null,
  schema_version text not null,
  payload jsonb not null,
  validation_flags jsonb not null default '[]',
  confidence numeric(4, 3) check (confidence between 0 and 1),
  status public.candidate_status not null default 'pending',
  offering_id uuid references public.offerings (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Provenance for every important extracted field.
create table public.field_evidence (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.extracted_candidates (id) on delete cascade,
  field_name text not null,
  extracted_value text,
  parsed_value jsonb,
  source_url text not null,
  retrieved_at timestamptz not null,
  evidence_text text,
  evidence_found boolean not null default false,
  validation_result text not null check (validation_result in ('pass', 'warn', 'fail')),
  validation_notes text
);
create index field_evidence_candidate_idx on public.field_evidence (candidate_id);

create table public.offering_sources (
  offering_id uuid not null references public.offerings (id) on delete cascade,
  raw_document_id uuid not null references public.raw_documents (id) on delete restrict,
  is_primary boolean not null default false,
  primary key (offering_id, raw_document_id)
);
