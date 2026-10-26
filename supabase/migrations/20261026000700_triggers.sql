-- Triggers: timestamps, worker guards, consent enforcement, change and audit logs.

-- ---------------------------------------------------------------- updated_at

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_updated_at before update on public.providers
  for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.scholarship_programs
  for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.offerings
  for each row execute function private.touch_updated_at();
create trigger touch_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- worker guards
-- Security invoker on purpose: current_user is the role making the change.

create or replace function private.guard_worker_offerings()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user <> 'discovery_worker' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.publish_state not in ('draft', 'in_review') then
      raise exception 'the discovery worker cannot publish offerings' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.publish_state is distinct from old.publish_state then
    raise exception 'the discovery worker cannot change publish state' using errcode = '42501';
  end if;

  if old.publish_state = 'published' then
    if new.opens_on is distinct from old.opens_on
       or new.closes_on is distinct from old.closes_on
       or new.apply_url is distinct from old.apply_url
       or new.academic_year is distinct from old.academic_year
       or new.program_id is distinct from old.program_id
       or new.rolling_admission is distinct from old.rolling_admission then
      raise exception 'changes to dates, apply link or identity of a published offering need review'
        using errcode = '42501';
    end if;

    if new.application_status is distinct from old.application_status then
      if new.application_status = 'open_unconfirmed' and old.application_status = 'open_verified' then
        null;  -- downgrade when a recheck is overdue or fails
      elsif new.application_status = 'open_verified'
            and old.application_status in ('open_verified', 'open_unconfirmed')
            and new.status_verified_at > old.status_verified_at then
        null;  -- a fresh recheck confirmed it is still open
      elsif new.application_status = 'closed'
            and old.closes_on is not null and old.closes_on < current_date then
        null;  -- deadline passed and the final recheck found no extension
      else
        raise exception 'this application status change needs review' using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_worker before insert or update on public.offerings
  for each row execute function private.guard_worker_offerings();

create or replace function private.guard_worker_rules()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_offering uuid := coalesce(new.offering_id, old.offering_id);
begin
  if current_user = 'discovery_worker' and exists (
    select 1 from public.offerings where id = v_offering and publish_state = 'published'
  ) then
    raise exception 'eligibility changes on a published offering need review' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_worker before insert or update or delete on public.eligibility_rules
  for each row execute function private.guard_worker_rules();

-- ---------------------------------------------------------------- profile validation

create or replace function private.validate_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  s public.grade_scales;
  prov_kind text;
  loc_parent bigint;
begin
  if new.grade_scale is not null then
    select * into s from public.grade_scales where code = new.grade_scale;
    if new.grade_value < s.min_value or new.grade_value > s.max_value then
      raise exception 'grade % is outside the % scale (% to %)', new.grade_value, s.label, s.min_value, s.max_value
        using errcode = '23514';
    end if;
  end if;

  if new.residence_province_id is not null then
    select kind into prov_kind from public.localities where id = new.residence_province_id;
    if prov_kind is distinct from 'province' then
      raise exception 'residence_province_id must be a province' using errcode = '23514';
    end if;
  end if;

  if new.residence_locality_id is not null then
    select parent_id into loc_parent from public.localities where id = new.residence_locality_id;
    if loc_parent is distinct from new.residence_province_id then
      raise exception 'residence city or municipality must be inside the chosen province' using errcode = '23514';
    end if;
  end if;

  new.last_active_at := now();
  return new;
end;
$$;

create trigger validate_profile before insert or update on public.profiles
  for each row execute function private.validate_profile();

-- ---------------------------------------------------------------- consent enforcement

create or replace function private.sensitive_fields()
returns text[] language sql immutable set search_path = ''
as $$
  select array['is_pwd', 'is_indigenous', 'is_solo_parent_child', 'is_ofw_dependent', 'is_athlete', 'is_first_gen'];
$$;

create or replace function private.enforce_sensitive_consent()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  k text;
  v jsonb := to_jsonb(new);
  bd date;
  checked_age boolean := false;
begin
  foreach k in array private.sensitive_fields() loop
    if v ->> k is not null then
      if not exists (
        select 1 from public.consents c
        where c.user_id = new.user_id and c.consent_type = 'sensitive:' || k and c.withdrawn_at is null
      ) then
        raise exception 'consent is required before answering %', k using errcode = '42501';
      end if;

      if not checked_age then
        select birth_date into bd from public.profiles where user_id = new.user_id;
        if bd is null then
          raise exception 'birth date is required before sensitive questions' using errcode = '22023';
        end if;
        if age(current_date, bd) < interval '18 years' and not exists (
          select 1 from public.consents c
          where c.user_id = new.user_id and c.consent_type = 'guardian' and c.withdrawn_at is null
        ) then
          raise exception 'guardian consent is required for users under 18' using errcode = '42501';
        end if;
        checked_age := true;
      end if;
    end if;
  end loop;

  new.updated_at := now();
  return new;
end;
$$;

create trigger enforce_consent before insert or update on public.profile_sensitive
  for each row execute function private.enforce_sensitive_consent();

-- Consents: a withdrawal is final and stamped by the server.
create or replace function private.guard_consent_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.withdrawn_at is not null then
    raise exception 'a withdrawn consent cannot be changed; grant a new one instead' using errcode = '42501';
  end if;
  if new.withdrawn_at is not null then
    new.withdrawn_at := now();
  end if;
  return new;
end;
$$;

create trigger guard_consent_update before update on public.consents
  for each row execute function private.guard_consent_update();

create or replace function private.stamp_consent_grant()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.granted_at := now();
  new.withdrawn_at := null;
  return new;
end;
$$;

create trigger stamp_consent_grant before insert on public.consents
  for each row execute function private.stamp_consent_grant();

-- Withdrawing consent deletes the related answers immediately.
create or replace function private.apply_consent_withdrawal()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  bd date;
begin
  if old.withdrawn_at is null and new.withdrawn_at is not null then
    if new.consent_type like 'sensitive:%' then
      -- consent_type is limited by a check constraint, so the column name is safe.
      execute format('update public.profile_sensitive set %I = null where user_id = $1',
                     substr(new.consent_type, 11))
        using new.user_id;
    elsif new.consent_type = 'guardian' then
      select birth_date into bd from public.profiles where user_id = new.user_id;
      if bd is null or age(current_date, bd) < interval '18 years' then
        update public.profile_sensitive
          set is_pwd = null, is_indigenous = null, is_solo_parent_child = null,
              is_ofw_dependent = null, is_athlete = null, is_first_gen = null
          where user_id = new.user_id;
      end if;
    end if;
  end if;
  return null;
end;
$$;

create trigger apply_consent_withdrawal after update on public.consents
  for each row execute function private.apply_consent_withdrawal();

-- ---------------------------------------------------------------- change log

create or replace function private.log_offering_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  f text;
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
begin
  foreach f in array array[
    'publish_state', 'application_status', 'opens_on', 'closes_on', 'rolling_admission',
    'apply_url', 'benefits', 'academic_year'
  ] loop
    if o -> f is distinct from n -> f then
      insert into public.change_log (offering_id, field_name, old_value, new_value, source_url, changed_by, auto_applied)
      values (new.id, f, o ->> f, n ->> f, new.status_source_url, auth.uid(), session_user = 'discovery_worker');
    end if;
  end loop;
  return null;
end;
$$;

create trigger log_changes after update on public.offerings
  for each row execute function private.log_offering_changes();

-- Stamp who published.
create or replace function private.stamp_publication()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.publish_state = 'published' and (tg_op = 'INSERT' or old.publish_state is distinct from 'published') then
    new.published_at := now();
    new.published_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger stamp_publication before insert or update on public.offerings
  for each row execute function private.stamp_publication();

-- ---------------------------------------------------------------- audit log
-- Records who changed which fields. Never the values.

create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  changed text[];
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into changed
    from jsonb_each(n) e
    where e.value is distinct from o -> e.key and e.key not in ('updated_at', 'last_active_at');
    if changed is null then
      return null;
    end if;
  end if;

  insert into public.audit_log (actor, actor_role, action, table_name, record_id, changed_fields)
  values (
    auth.uid(),
    case when session_user = 'discovery_worker' then 'discovery_worker'
         else coalesce(claims ->> 'role', session_user) end,
    lower(tg_op),
    tg_table_name,
    coalesce(n ->> 'id', o ->> 'id', n ->> 'user_id', o ->> 'user_id'),
    changed
  );
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'providers', 'scholarship_programs', 'offerings', 'eligibility_rules', 'grade_conversions',
    'sources', 'source_suggestions', 'extracted_candidates', 'review_tasks', 'coverage_audits',
    'submissions', 'error_reports', 'user_roles'
  ] loop
    execute format(
      'create trigger audit after insert or update or delete on public.%I
         for each row execute function private.audit_row_change()', t);
  end loop;
end
$$;
