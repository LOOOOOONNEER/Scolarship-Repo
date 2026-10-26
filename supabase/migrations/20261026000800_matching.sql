-- Deterministic eligibility matching, run entirely inside Postgres.
-- Student answers never leave the database.
--
-- Each rule evaluates to: pass | fail | missing | verify
-- An offering's result:   any fail    -> not_eligible
--                         any missing -> missing_information
--                         any verify  -> needs_verification
--                         otherwise   -> eligible
-- An offering with no structured rules is never "eligible".

create or replace function private.field_label(p_field text)
returns text language sql immutable set search_path = ''
as $$
  select case p_field
    when 'education_level' then 'year level'
    when 'enrollment_status' then 'enrollment status'
    when 'school_type' then 'type of school'
    when 'ched_discipline' then 'course discipline'
    when 'grade' then 'latest grade and its grading scale'
    when 'residence_province_id' then 'home province'
    when 'residence_locality_id' then 'home city or municipality'
    when 'residency_years' then 'years of residency'
    when 'parent_registered_voter' then 'whether a parent is a registered voter there'
    when 'income' then 'household income bracket'
    when 'is_4ps' then '4Ps or Listahanan status'
    when 'citizenship' then 'citizenship'
    when 'holds_other_scholarship' then 'whether you hold another scholarship'
    when 'age' then 'birth date'
    else 'answer to a related question'
  end;
$$;

create or replace function private.profile_facts(p_user uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'education_level', p.education_level,
    'enrollment_status', p.enrollment_status,
    'school_type', p.school_type,
    'ched_discipline', p.ched_discipline,
    'grade_value', p.grade_value,
    'grade_scale', p.grade_scale,
    'residence_province_id', p.residence_province_id,
    'residence_locality_id', p.residence_locality_id,
    'residency_years', p.residency_years,
    'parent_registered_voter', p.parent_registered_voter,
    'income_bracket', p.income_bracket,
    'is_4ps', p.is_4ps,
    'citizenship', p.citizenship,
    'holds_other_scholarship', p.holds_other_scholarship,
    'age', case when p.birth_date is not null
                then date_part('year', age(current_date, p.birth_date))::int end,
    'is_pwd', s.is_pwd,
    'is_indigenous', s.is_indigenous,
    'is_solo_parent_child', s.is_solo_parent_child,
    'is_ofw_dependent', s.is_ofw_dependent,
    'is_athlete', s.is_athlete,
    'is_first_gen', s.is_first_gen
  ))
  from public.profiles p
  left join public.profile_sensitive s on s.user_id = p.user_id
  where p.user_id = p_user;
$$;

create or replace function private.rule_outcome(
  p_rule public.eligibility_rules, p_outcome text, p_detail text default null, p_conversion uuid default null
)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'rule_id', p_rule.id,
    'outcome', p_outcome,
    'text', p_rule.description,
    'detail', p_detail,
    'conversion_id', p_conversion
  ));
$$;

create or replace function private.eval_rule(p_facts jsonb, p_rule public.eligibility_rules)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  fact jsonb;
  fact_num numeric;
  target numeric;
  converted numeric;
  conv record;
  conv_id uuid;
  br public.income_brackets;
  ok boolean;
  fact_txt text;
begin
  if p_rule.kind = 'also_required' then
    return null;  -- shown to students, never evaluated
  end if;

  if p_rule.kind = 'unstructured' then
    return private.rule_outcome(p_rule, 'verify', 'This condition could not be checked automatically.');
  end if;

  -- income: compare the student's bracket with a peso ceiling or floor
  if p_rule.field = 'income' then
    if not p_facts ? 'income_bracket' then
      return private.rule_outcome(p_rule, 'missing', 'We need your ' || private.field_label('income') || '.');
    end if;
    select * into br from public.income_brackets where id = (p_facts ->> 'income_bracket')::smallint;
    target := (p_rule.value #>> '{}')::numeric;
    if p_rule.operator = 'income_max_php' then
      if br.max_php_annual is not null and br.max_php_annual <= target then
        return private.rule_outcome(p_rule, 'pass');
      elsif br.min_php_annual > target then
        return private.rule_outcome(p_rule, 'fail');
      end if;
    else
      if br.min_php_annual >= target then
        return private.rule_outcome(p_rule, 'pass');
      elsif br.max_php_annual is not null and br.max_php_annual <= target then
        return private.rule_outcome(p_rule, 'fail');
      end if;
    end if;
    return private.rule_outcome(p_rule, 'verify',
      'Your income bracket spans this program''s income limit, so the provider must confirm.');
  end if;

  -- grade: compare on the rule's scale, converting only with an authoritative equivalency
  if p_rule.field = 'grade' then
    if not (p_facts ? 'grade_value' and p_facts ? 'grade_scale') then
      return private.rule_outcome(p_rule, 'missing', 'We need your ' || private.field_label('grade') || '.');
    end if;
    fact_num := (p_facts ->> 'grade_value')::numeric;
    if p_facts ->> 'grade_scale' = p_rule.grade_scale then
      converted := fact_num;
    else
      select gc.id, gc.mapping into conv
      from public.grade_conversions gc
      where gc.from_scale = p_facts ->> 'grade_scale'
        and gc.to_scale = p_rule.grade_scale
        and (gc.offering_id = p_rule.offering_id or gc.offering_id is null)
      order by (gc.offering_id is null), gc.created_at desc
      limit 1;
      if conv.id is not null then
        select (e ->> 'to')::numeric into converted
        from jsonb_array_elements(conv.mapping) e
        where fact_num between (e ->> 'from_min')::numeric and (e ->> 'from_max')::numeric
        limit 1;
        conv_id := conv.id;
      end if;
      if converted is null then
        return private.rule_outcome(p_rule, 'verify',
          'There is no authoritative conversion from your grading scale to the one this program uses.');
      end if;
    end if;
    fact := to_jsonb(converted);
  else
    if not p_facts ? p_rule.field then
      return private.rule_outcome(p_rule, 'missing', 'We need your ' || private.field_label(p_rule.field) || '.');
    end if;
    fact := p_facts -> p_rule.field;
  end if;

  fact_txt := lower(fact #>> '{}');
  ok := case p_rule.operator
    when 'eq' then fact_txt = lower(p_rule.value #>> '{}')
    when 'neq' then fact_txt <> lower(p_rule.value #>> '{}')
    when 'in' then exists (select 1 from jsonb_array_elements(p_rule.value) e where lower(e #>> '{}') = fact_txt)
    when 'not_in' then not exists (select 1 from jsonb_array_elements(p_rule.value) e where lower(e #>> '{}') = fact_txt)
    when 'lt' then (fact #>> '{}')::numeric < (p_rule.value #>> '{}')::numeric
    when 'lte' then (fact #>> '{}')::numeric <= (p_rule.value #>> '{}')::numeric
    when 'gt' then (fact #>> '{}')::numeric > (p_rule.value #>> '{}')::numeric
    when 'gte' then (fact #>> '{}')::numeric >= (p_rule.value #>> '{}')::numeric
    when 'is_true' then fact = 'true'::jsonb
    when 'is_false' then fact = 'false'::jsonb
  end;

  if ok is null then
    return private.rule_outcome(p_rule, 'verify', 'This rule could not be compared with your answer.', conv_id);
  end if;
  return private.rule_outcome(p_rule, case when ok then 'pass' else 'fail' end, null, conv_id);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return private.rule_outcome(p_rule, 'verify', 'This rule could not be compared with your answer.');
end;
$$;

create or replace function private.compute_match(p_user uuid, p_offering uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  facts jsonb := private.profile_facts(p_user);
  r public.eligibility_rules;
  res jsonb;
  reasons jsonb := '[]';
  convs uuid[] := '{}';
  any_fail boolean := false;
  any_missing boolean := false;
  any_verify boolean := false;
  n integer := 0;
  v_result public.match_result;
begin
  if facts is null then
    delete from public.matches where user_id = p_user and offering_id = p_offering;
    return;
  end if;

  for r in
    select * from public.eligibility_rules where offering_id = p_offering order by created_at, id
  loop
    res := private.eval_rule(facts, r);
    continue when res is null;
    n := n + 1;
    reasons := reasons || jsonb_build_array(res);
    any_fail := any_fail or res ->> 'outcome' = 'fail';
    any_missing := any_missing or res ->> 'outcome' = 'missing';
    any_verify := any_verify or res ->> 'outcome' = 'verify';
    if res ? 'conversion_id' then
      convs := convs || (res ->> 'conversion_id')::uuid;
    end if;
  end loop;

  if n = 0 then
    any_verify := true;
    reasons := reasons || jsonb_build_array(jsonb_build_object(
      'outcome', 'verify', 'text', 'No checkable eligibility rules are recorded for this offering yet.'));
  end if;

  v_result := case
    when any_fail then 'not_eligible'
    when any_missing then 'missing_information'
    when any_verify then 'needs_verification'
    else 'eligible'
  end;

  insert into public.matches (user_id, offering_id, result, reasons, conversion_ids, computed_at)
  values (p_user, p_offering, v_result, reasons, convs, now())
  on conflict (user_id, offering_id) do update
    set result = excluded.result,
        reasons = excluded.reasons,
        conversion_ids = excluded.conversion_ids,
        computed_at = excluded.computed_at;
end;
$$;

create or replace function private.recompute_user(p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  o uuid;
begin
  delete from public.matches m
  where m.user_id = p_user
    and not exists (select 1 from public.offerings x where x.id = m.offering_id and x.publish_state = 'published');
  for o in select id from public.offerings where publish_state = 'published' loop
    perform private.compute_match(p_user, o);
  end loop;
end;
$$;

create or replace function private.recompute_offering(p_offering uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  u uuid;
begin
  if not exists (select 1 from public.offerings where id = p_offering and publish_state = 'published') then
    delete from public.matches where offering_id = p_offering;
    return;
  end if;
  for u in select user_id from public.profiles loop
    perform private.compute_match(u, p_offering);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- triggers

create or replace function private.on_profile_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.recompute_user(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;

create trigger recompute_matches after insert or update on public.profiles
  for each row execute function private.on_profile_change();
create trigger recompute_matches after insert or update or delete on public.profile_sensitive
  for each row execute function private.on_profile_change();

create or replace function private.on_rules_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.recompute_offering(coalesce(new.offering_id, old.offering_id));
  return null;
end;
$$;

create trigger recompute_matches after insert or update or delete on public.eligibility_rules
  for each row execute function private.on_rules_change();

create or replace function private.on_offering_publish_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.publish_state is distinct from old.publish_state then
    perform private.recompute_offering(new.id);
  end if;
  return null;
end;
$$;

create trigger recompute_matches after insert or update of publish_state on public.offerings
  for each row execute function private.on_offering_publish_change();

create or replace function private.on_conversion_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  c public.grade_conversions := coalesce(new, old);
  o uuid;
begin
  for o in
    select distinct r.offering_id from public.eligibility_rules r
    where r.field = 'grade' and r.grade_scale = c.to_scale
      and (c.offering_id is null or r.offering_id = c.offering_id)
  loop
    perform private.recompute_offering(o);
  end loop;
  return null;
end;
$$;

create trigger recompute_matches after insert or update or delete on public.grade_conversions
  for each row execute function private.on_conversion_change();

-- ---------------------------------------------------------------- student-facing functions

create or replace function public.recompute_my_matches()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  perform private.recompute_user(auth.uid());
end;
$$;

-- Security invoker: RLS limits every row to the caller's own data.
create or replace function public.export_my_data()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = auth.uid()),
    'sensitive_answers', (select to_jsonb(s) from public.profile_sensitive s where s.user_id = auth.uid()),
    'consents', coalesce((select jsonb_agg(c) from public.consents c where c.user_id = auth.uid()), '[]'),
    'matches', coalesce((select jsonb_agg(m) from public.matches m where m.user_id = auth.uid()), '[]'),
    'notifications', coalesce((select jsonb_agg(n) from public.notifications n where n.user_id = auth.uid()), '[]'),
    'submissions', coalesce((select jsonb_agg(x) from public.submissions x where x.user_id = auth.uid()), '[]'),
    'error_reports', coalesce((select jsonb_agg(e) from public.error_reports e where e.user_id = auth.uid()), '[]')
  );
$$;

revoke all on function public.recompute_my_matches() from public;
revoke all on function public.export_my_data() from public;
grant execute on function public.recompute_my_matches() to authenticated;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------- retention (scheduled later with pg_cron)

create or replace function private.purge_expired()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  n_notifications integer;
  n_documents integer;
  n_jobs integer;
begin
  delete from public.notifications where created_at < now() - interval '12 months';
  get diagnostics n_notifications = row_count;

  delete from public.raw_documents d
  where d.retrieved_at < now() - interval '12 months'
    and not exists (select 1 from public.offering_sources s where s.raw_document_id = d.id);
  get diagnostics n_documents = row_count;

  delete from public.job_runs where started_at < now() - interval '12 months';
  get diagnostics n_jobs = row_count;

  return jsonb_build_object('notifications', n_notifications, 'raw_documents', n_documents, 'job_runs', n_jobs);
end;
$$;

-- No private function is callable by API roles or the worker.
revoke all on all functions in schema private from public;
