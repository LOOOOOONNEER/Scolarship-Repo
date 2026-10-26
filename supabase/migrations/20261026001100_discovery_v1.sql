-- Phase 2: discovery pipeline support and the review workflow.

-- The worker uses pg_trgm (installed in the extensions schema) for duplicate lookup.
grant usage on schema extensions to discovery_worker;

-- Links a queued fetch back to the student submission it came from (no student id).
alter table public.fetch_queue
  add column submission_id uuid references public.submissions (id) on delete set null,
  add column parent_url text;

-- Which offering of a multi-offering page a candidate is, and the evidence-checked summary.
alter table public.extracted_candidates
  add column offering_index smallint not null default 0,
  add column suggested_status public.application_status,
  add column summary text;

grant update (offering_id) on public.extracted_candidates to authenticated;

-- ---------------------------------------------------------------- duplicate lookup

create or replace function public.similar_programs(p_name text, p_limit integer default 5)
returns table (program_id uuid, program_name text, provider_name text, similarity real)
language sql stable security invoker set search_path = ''
as $$
  select p.id, p.name, pr.name,
         extensions.similarity(p.normalized_name, lower(trim(p_name)))
  from public.scholarship_programs p
  join public.providers pr on pr.id = p.provider_id
  where extensions.similarity(p.normalized_name, lower(trim(p_name))) > 0.3
  order by 4 desc
  limit greatest(1, least(p_limit, 20));
$$;

revoke all on function public.similar_programs(text, integer) from public;
grant execute on function public.similar_programs(text, integer) to authenticated, discovery_worker;

-- ---------------------------------------------------------------- review decisions
-- Security invoker: the reviewer's own grants and RLS apply to every write, and
-- the offerings_publish_requires_verification check still guards publishing.

create or replace function public.approve_candidate(p_candidate uuid, p_data jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  c public.extracted_candidates;
  v_provider uuid := nullif(p_data ->> 'provider_id', '')::uuid;
  v_program uuid := nullif(p_data ->> 'program_id', '')::uuid;
  v_offering uuid;
  r jsonb;
begin
  if not public.is_reviewer() then
    raise exception 'only reviewers can approve candidates' using errcode = '42501';
  end if;

  select * into c from public.extracted_candidates where id = p_candidate for update;
  if c.id is null then
    raise exception 'candidate not found' using errcode = 'P0002';
  end if;
  if c.status not in ('pending', 'needs_review') then
    raise exception 'candidate was already %', c.status using errcode = '22023';
  end if;

  if v_provider is null then
    insert into public.providers (name, kind, official_domains, region_code)
    values (
      trim(p_data #>> '{provider,name}'),
      (p_data #>> '{provider,kind}')::public.provider_kind,
      coalesce(array(select jsonb_array_elements_text(p_data #> '{provider,official_domains}')), '{}'),
      'R3'
    )
    on conflict (name, kind) do update set name = excluded.name
    returning id into v_provider;
  end if;

  if v_program is null then
    insert into public.scholarship_programs (provider_id, name, normalized_name, region_code)
    values (v_provider, trim(p_data ->> 'program_name'), lower(trim(p_data ->> 'program_name')), 'R3')
    on conflict (provider_id, normalized_name) do update set name = excluded.name
    returning id into v_program;
  end if;

  insert into public.offerings (
    program_id, academic_year, publish_state, application_status, opens_on, closes_on,
    rolling_admission, status_verified_at, status_source_url, status_evidence, benefits, apply_url
  ) values (
    v_program,
    p_data ->> 'academic_year',
    'in_review',
    coalesce(nullif(p_data ->> 'application_status', ''), 'unknown')::public.application_status,
    nullif(p_data ->> 'opens_on', '')::date,
    nullif(p_data ->> 'closes_on', '')::date,
    coalesce((p_data ->> 'rolling_admission')::boolean, false),
    case when (p_data ->> 'status_verified')::boolean then now() end,
    nullif(p_data ->> 'status_source_url', ''),
    nullif(p_data ->> 'status_evidence', ''),
    nullif(p_data ->> 'benefits', ''),
    nullif(p_data ->> 'apply_url', '')
  )
  returning id into v_offering;

  for r in select * from jsonb_array_elements(coalesce(p_data -> 'rules', '[]'::jsonb)) loop
    insert into public.eligibility_rules (offering_id, kind, field, operator, value, grade_scale, description)
    values (
      v_offering,
      coalesce(r ->> 'kind', 'criterion'),
      nullif(r ->> 'field', ''),
      nullif(r ->> 'operator', ''),
      r -> 'value',
      nullif(r ->> 'grade_scale', ''),
      r ->> 'description'
    );
  end loop;

  insert into public.offering_sources (offering_id, raw_document_id, is_primary)
  values (v_offering, c.raw_document_id, true);

  if coalesce((p_data ->> 'publish')::boolean, false) then
    update public.offerings set publish_state = 'published' where id = v_offering;
  end if;

  update public.extracted_candidates set status = 'approved', offering_id = v_offering where id = p_candidate;
  update public.review_tasks
     set status = 'resolved', resolved_at = now(),
         resolution = case when coalesce((p_data ->> 'publish')::boolean, false) then 'approved and published' else 'approved as draft' end
   where ref_table = 'extracted_candidates' and ref_id = p_candidate and status = 'open';

  return v_offering;
end;
$$;

create or replace function public.reject_candidate(p_candidate uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.is_reviewer() then
    raise exception 'only reviewers can reject candidates' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.extracted_candidates set status = 'rejected'
   where id = p_candidate and status in ('pending', 'needs_review');
  if not found then
    raise exception 'candidate not found or already decided' using errcode = 'P0002';
  end if;
  update public.review_tasks
     set status = 'dismissed', resolved_at = now(), resolution = 'rejected: ' || left(trim(p_reason), 500)
   where ref_table = 'extracted_candidates' and ref_id = p_candidate and status = 'open';
end;
$$;

revoke all on function public.approve_candidate(uuid, jsonb) from public;
revoke all on function public.reject_candidate(uuid, text) from public;
grant execute on function public.approve_candidate(uuid, jsonb) to authenticated;
grant execute on function public.reject_candidate(uuid, text) to authenticated;
