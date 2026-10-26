-- Tiny assertion helpers (no extensions needed, so the same tests run locally and in CI).

create schema if not exists tests;
grant usage on schema tests to public;

create or replace function tests.ok(p_cond boolean, p_msg text)
returns void language plpgsql
as $$
begin
  if p_cond is not true then
    raise exception 'FAIL: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end;
$$;

-- Runs p_sql as the current role and passes only if it fails with p_state.
create or replace function tests.throws(p_sql text, p_state text, p_msg text)
returns void language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_state is null or sqlstate = p_state then
      raise notice 'ok - % (%)', p_msg, sqlstate;
      return;
    end if;
    raise exception 'FAIL: % (expected %, got %: %)', p_msg, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % (no error was raised)', p_msg;
end;
$$;

create or replace function tests.login(p_user uuid)
returns void language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;

create or replace function tests.logout()
returns void language sql
as $$
  select set_config('request.jwt.claims', '', false);
$$;

grant execute on all functions in schema tests to public;
