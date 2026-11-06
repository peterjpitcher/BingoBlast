-- Behaviour of public.app_errors and list_app_errors_safe
-- (20261106194703_app_errors.sql), run against the fully replayed database in
-- suites D and E of supabase/tests/run.sh.
--
-- WHAT THIS PROVES
--   anon and authenticated can neither read nor write the table, whoever the
--   JWT says they are, an admin included; the service role can; the admin read
--   works for an admin only and anon cannot even call it; and the table's
--   length checks hold. Each check acts as the role itself, because a
--   catalogue row cannot show what the REST API will actually do.
--
-- Run via supabase/tests/run.sh, never against a real project.

create table if not exists test_results (seq serial, name text, ok boolean, detail text);

create or replace function t(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into test_results (name, ok, detail) values (p_name, p_ok, p_detail);
$$;

-- Fixtures: an admin and a host of this file's own. The trigger makes each
-- profile pending; the promotions are the deliberate second step.
insert into auth.users (id, email) values
  ('ae000000-0000-4000-8000-000000000001', 'errors-admin@example.invalid'),
  ('ae000000-0000-4000-8000-000000000002', 'errors-host@example.invalid');
update public.profiles set role = 'admin' where id = 'ae000000-0000-4000-8000-000000000001';
update public.profiles set role = 'host' where id = 'ae000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------
select t('app_errors :: row level security is on',
         (select relrowsecurity from pg_class where oid = 'public.app_errors'::regclass));

select t('app_errors :: no policy exists, so RLS lets no API role see a row',
         not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_errors'));

select t('app_errors :: anon and authenticated hold no table privilege at all',
         not exists (
           select 1
             from unnest(array['anon','authenticated']) r,
                  unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
            where has_table_privilege(r, 'public.app_errors', p)),
         (select string_agg(r || ':' || p, ',')
            from unnest(array['anon','authenticated']) r,
                 unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
           where has_table_privilege(r, 'public.app_errors', p)));

select t('app_errors :: anon cannot execute list_app_errors_safe; authenticated and service_role can',
         not has_function_privilege('anon', 'public.list_app_errors_safe(integer)', 'EXECUTE')
           and has_function_privilege('authenticated', 'public.list_app_errors_safe(integer)', 'EXECUTE')
           and has_function_privilege('service_role', 'public.list_app_errors_safe(integer)', 'EXECUTE'));

select t('app_errors :: list_app_errors_safe is security definer with a pinned search_path',
         (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
            from pg_proc p where p.oid = 'public.list_app_errors_safe(integer)'::regprocedure));

-- ---------------------------------------------------------------------------
-- The service role writes and reads
-- ---------------------------------------------------------------------------
do $$
declare v_ok boolean; v_detail text;
begin
  begin
    set local role service_role;
    insert into public.app_errors (source, message, context)
    values ('test:service', 'stored by the service role', '{"code":"P0001"}'::jsonb);
    perform count(*) from public.app_errors;
    v_ok := true; v_detail := 'inserted and read';
  exception when others then
    v_ok := false; v_detail := sqlerrm;
  end;
  reset role;
  perform t('app_errors :: the service role can insert and read', v_ok, v_detail);
end $$;

-- ---------------------------------------------------------------------------
-- anon and authenticated, acting as themselves, are refused with 42501
-- ---------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_sub text;
  v_stmt text;
  v_ok boolean;
  v_detail text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    -- authenticated is tried as the admin: even an admin's JWT gets nothing
    -- from the table directly.
    v_sub := case when v_role = 'authenticated' then 'ae000000-0000-4000-8000-000000000001' else '' end;
    foreach v_stmt in array array[
      'select count(*) from public.app_errors',
      $q$insert into public.app_errors (source, message) values ('test:' || current_user, 'should not land')$q$,
      $q$update public.app_errors set message = 'changed'$q$,
      'delete from public.app_errors'
    ] loop
      begin
        execute format('set local role %I', v_role);
        perform set_config('request.jwt.claim.sub', v_sub, true);
        execute v_stmt;
        v_ok := false;
        v_detail := v_role || ' ran: ' || v_stmt;
      exception
        when insufficient_privilege then v_ok := true; v_detail := sqlerrm;
        when others then v_ok := false; v_detail := v_role || ' got past the privilege check: ' || sqlerrm;
      end;
      reset role;
      perform t('app_errors :: ' || v_role || ' is refused: ' || split_part(v_stmt, ' ', 1), v_ok, v_detail);
    end loop;
  end loop;
end $$;

select t('app_errors :: nothing anon or authenticated tried has landed',
         not exists (select 1 from public.app_errors where source like 'test:anon%' or source like 'test:authenticated%'
                                                      or message = 'changed'),
         (select string_agg(source, ',') from public.app_errors));

-- ---------------------------------------------------------------------------
-- The admin read
-- ---------------------------------------------------------------------------
do $$
declare v_ok boolean; v_detail text;
begin
  begin
    set local role anon;
    perform * from public.list_app_errors_safe(10);
    v_ok := false; v_detail := 'anon read the error list';
  exception
    when insufficient_privilege then v_ok := true; v_detail := sqlerrm;
    -- Reaching the body (and its admin check) means anon held EXECUTE.
    when others then v_ok := false; v_detail := 'anon reached the function body: ' || sqlerrm;
  end;
  reset role;
  perform t('app_errors :: anon cannot call list_app_errors_safe', v_ok, v_detail);

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'ae000000-0000-4000-8000-000000000002', true);
    perform * from public.list_app_errors_safe(10);
    v_ok := false; v_detail := 'a host read the error list';
  exception when others then
    v_ok := sqlerrm like 'unauthorized%'; v_detail := sqlerrm;
  end;
  reset role;
  perform t('app_errors :: a host is refused by list_app_errors_safe', v_ok, v_detail);
end $$;

do $$
declare v_count int; v_newest text; v_capped int;
begin
  insert into public.app_errors (source, message, created_at)
  select 'test:bulk', 'row ' || g, now() - make_interval(mins => g)
    from generate_series(1, 210) g;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'ae000000-0000-4000-8000-000000000001', true);
  select count(*) into v_count from public.list_app_errors_safe(5);
  select message into v_newest from public.list_app_errors_safe(1);
  select count(*) into v_capped from public.list_app_errors_safe(100000);
  reset role;

  perform t('app_errors :: an admin reads the newest reports, as many as asked for',
            v_count = 5 and v_newest = 'stored by the service role',
            format('count=%s newest=%s', v_count, v_newest));
  perform t('app_errors :: the admin read is capped at 200 rows', v_capped = 200, 'got ' || v_capped);
end $$;

-- ---------------------------------------------------------------------------
-- The length checks match src/lib/error-sink.ts
-- ---------------------------------------------------------------------------
do $$
declare
  v_stmt text;
  v_ok boolean;
  v_detail text;
begin
  foreach v_stmt in array array[
    $q$insert into public.app_errors (source, message) values ('', 'm')$q$,
    $q$insert into public.app_errors (source, message) values ('s', '')$q$,
    $q$insert into public.app_errors (source, message) values (repeat('s', 121), 'm')$q$,
    $q$insert into public.app_errors (source, message) values ('s', repeat('m', 2001))$q$,
    $q$insert into public.app_errors (source, message, path) values ('s', 'm', repeat('p', 501))$q$,
    $q$insert into public.app_errors (source, message, user_agent) values ('s', 'm', repeat('u', 301))$q$,
    $q$insert into public.app_errors (source, message, context) values ('s', 'm', '[]'::jsonb)$q$
  ] loop
    begin
      execute v_stmt;
      v_ok := false; v_detail := 'accepted: ' || left(v_stmt, 90);
    exception when check_violation then
      v_ok := true; v_detail := sqlerrm;
    end;
    perform t('app_errors :: a check constraint refuses ' || left(split_part(v_stmt, 'values ', 2), 40), v_ok, v_detail);
  end loop;
end $$;

delete from public.app_errors where source like 'test:%';
