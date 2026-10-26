-- Scholarship Finder: extensions, schemas and enum types.
-- Applies to a Supabase project (Postgres 15+).

create extension if not exists pg_trgm with schema extensions;

-- Helper functions that must never be exposed through the REST API live here.
-- PostgREST only exposes the `public` schema.
create schema if not exists private;
revoke all on schema private from public;

create type public.provider_kind as enum (
  'national_agency', 'lgu', 'suc', 'luc', 'private_hei', 'foundation', 'corporate', 'other'
);

-- Publication workflow of a record (separate from whether applications are open).
create type public.publish_state as enum ('draft', 'in_review', 'published', 'rejected', 'archived');

-- Whether applications are actually being accepted. Set from evidence, never from dates alone.
create type public.application_status as enum (
  'open_verified',     -- confirmed open within the last 7 days
  'open_unconfirmed',  -- last known open, not recently rechecked
  'upcoming',          -- announced, window not started
  'closed',            -- ended, or closed early by the provider
  'suspended',         -- paused or cancelled by the provider
  'unknown'            -- never confirmed
);

create type public.match_result as enum (
  'eligible', 'needs_verification', 'missing_information', 'not_eligible'
);

create type public.candidate_status as enum ('pending', 'needs_review', 'approved', 'rejected', 'merged');
create type public.job_status as enum ('running', 'succeeded', 'failed');
create type public.review_kind as enum (
  'new_offering', 'offering_change', 'duplicate', 'error_report', 'submission', 'source_suggestion'
);
create type public.task_status as enum ('open', 'resolved', 'dismissed');
create type public.app_role as enum ('admin', 'reviewer');

create type public.education_level as enum (
  'incoming_freshman', 'first_year', 'second_year', 'third_year', 'fourth_year', 'fifth_year'
);
create type public.enrollment_status as enum ('not_yet_enrolled', 'enrolled', 'on_leave', 'irregular');
create type public.school_type as enum ('suc', 'luc', 'private', 'other');
