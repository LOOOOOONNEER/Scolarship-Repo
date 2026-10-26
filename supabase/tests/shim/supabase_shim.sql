-- LOCAL TESTING ONLY. Recreates the small part of a Supabase database that the
-- migrations rely on (roles, auth schema, auth.uid()), so tests run on plain Postgres.
-- Never apply this file to a real Supabase project.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;

create schema if not exists extensions;
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid language sql stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated;
grant usage on schema extensions to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Supabase grants new public tables to API roles by default; mimic that so the
-- migrations' explicit revokes are actually tested.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
