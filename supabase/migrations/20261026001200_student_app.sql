-- Phase 3 (Student app): consent at sign-up, shared answer lists, and which
-- sensitive questions are currently needed.

-- ---------------------------------------------------------------- course fields
-- The app's own list of broad course fields. Student answers and reviewer rules
-- both use these codes, so they always compare. It is not an official CHED list.

create table public.course_fields (
  code text primary key check (code ~ '^[a-z_]+$'),
  label text not null,
  sort smallint not null
);

insert into public.course_fields (code, label, sort) values
  ('agriculture', 'Agriculture, forestry and fisheries', 10),
  ('architecture', 'Architecture and design', 20),
  ('arts', 'Fine and performing arts', 30),
  ('business', 'Business, accountancy and management', 40),
  ('education', 'Education and teacher training', 50),
  ('engineering', 'Engineering and technology', 60),
  ('health', 'Health sciences (nursing, medicine, allied health)', 70),
  ('humanities', 'Humanities, languages and communication', 80),
  ('it', 'Information technology and computer science', 90),
  ('law_criminology', 'Law and criminology', 100),
  ('maritime', 'Maritime', 110),
  ('mathematics', 'Mathematics and statistics', 120),
  ('natural_science', 'Natural and physical sciences', 130),
  ('social_science', 'Social and behavioral sciences', 140),
  ('tourism_hospitality', 'Tourism and hospitality', 150),
  ('other', 'Other', 999);

alter table public.course_fields enable row level security;
create policy "reference readable" on public.course_fields for select to anon, authenticated, discovery_worker using (true);
grant select on public.course_fields to anon, authenticated, discovery_worker;

-- Existing free-text values (none expected before launch) are cleared rather than guessed.
update public.profiles set ched_discipline = null
 where ched_discipline is not null and ched_discipline not in (select code from public.course_fields);
alter table public.profiles
  add constraint profiles_course_field_fk foreign key (ched_discipline) references public.course_fields (code);

update public.profiles set citizenship = null
 where citizenship is not null and lower(citizenship) not in ('filipino', 'other');
update public.profiles set citizenship = lower(citizenship) where citizenship is not null;
alter table public.profiles
  add constraint profiles_citizenship_values check (citizenship in ('filipino', 'other'));

-- ---------------------------------------------------------------- privacy notice before a profile

create or replace function private.require_privacy_notice()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.consents c
    where c.user_id = new.user_id and c.consent_type = 'privacy_notice' and c.withdrawn_at is null
  ) then
    raise exception 'please agree to the privacy notice before answering the questionnaire' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Named to fire before the other insert triggers (Postgres runs them alphabetically).
create trigger a_require_privacy_notice before insert on public.profiles
  for each row execute function private.require_privacy_notice();

-- Withdrawing the privacy notice removes the questionnaire answers and matches.
-- (Full account deletion is the delete-account function.)
create or replace function private.apply_privacy_withdrawal()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.withdrawn_at is null and new.withdrawn_at is not null and new.consent_type = 'privacy_notice' then
    delete from public.profiles where user_id = new.user_id;  -- cascades to profile_sensitive
    delete from public.matches where user_id = new.user_id;
  end if;
  return null;
end;
$$;

create trigger apply_privacy_withdrawal after update on public.consents
  for each row execute function private.apply_privacy_withdrawal();

revoke all on all functions in schema private from public;

-- ---------------------------------------------------------------- sensitive questions in use
-- A sensitive question is asked only when a published scholarship's rules use it.

create or replace function public.sensitive_questions_in_use()
returns setof text language sql stable security invoker set search_path = ''
as $$
  select distinct r.field
    from public.eligibility_rules r
    join public.offerings o on o.id = r.offering_id
   where o.publish_state = 'published'
     and o.application_status not in ('closed', 'suspended')
     and r.kind = 'criterion'
     and r.field in ('is_pwd', 'is_indigenous', 'is_solo_parent_child', 'is_ofw_dependent', 'is_athlete', 'is_first_gen')
   order by 1;
$$;

revoke all on function public.sensitive_questions_in_use() from public;
grant execute on function public.sensitive_questions_in_use() to anon, authenticated;
