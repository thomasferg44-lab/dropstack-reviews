-- =============================================================================
-- Review Engine: verification for the 2026-11-05 compete patch
-- Run in the Supabase SQL editor AFTER schema.sql (or the patch), as the
-- default postgres role, and after verify-rls.sql. One row per check; every
-- row must read PASS.
--
-- Uses its own fixtures (name 'VERIFY CU%', non-numeric sentinel phones) and
-- deletes them at the end. It never loads or removes demo data on a database
-- that already holds demo rows (check 12 reports SKIP-as-PASS with a reason
-- instead), so it is safe on a live project.
--
-- Roles are switched with `set local role`, which changes current_user, which
-- is what grants, RLS and the guards key on (auth.role() is NULL here).
-- =============================================================================

drop table if exists pg_temp.reviews_cu_verify;
create temp table reviews_cu_verify (n int, "check" text, status text, detail text);

create or replace function pg_temp.cu_record(p_n int, p_check text, p_pass boolean, p_detail text)
returns void language sql as $$
  insert into pg_temp.reviews_cu_verify (n, "check", status, detail)
  values (p_n, p_check, case when coalesce(p_pass, false) then 'PASS' else 'FAIL' end, p_detail);
$$;

reset role;
delete from public.reviews_customers where phone in ('CU-VERIFY-1', 'CU-VERIFY-2') or name like 'VERIFY CU%';
delete from public.reviews_showcase where author_name like 'VERIFY CU%';

insert into public.reviews_customers (id, name, phone, email)
values ('00000000-0000-4000-8000-0000000ce0c1', 'VERIFY CU', 'CU-VERIFY-1', 'test@example.com');
insert into public.reviews_jobs (id, customer_id, description, completed_at)
values ('00000000-0000-4000-8000-0000000ce0b1', '00000000-0000-4000-8000-0000000ce0c1', 'verify job', now());
insert into public.reviews_requests (id, customer_id, job_id, channel, token, sent_at)
values
  ('00000000-0000-4000-8000-0000000ce0a1', '00000000-0000-4000-8000-0000000ce0c1', '00000000-0000-4000-8000-0000000ce0b1', 'whatsapp', 'cu-verify-token-A', now() - interval '6 days'),
  ('00000000-0000-4000-8000-0000000ce0a2', '00000000-0000-4000-8000-0000000ce0c1', '00000000-0000-4000-8000-0000000ce0b1', 'email',    'cu-verify-token-B', null);
insert into public.reviews_showcase (author_name, rating, body, published, is_demo) values
  ('VERIFY CU published', 5, 'verify body', true,  false),
  ('VERIFY CU hidden',    4, 'verify body', false, false),
  ('VERIFY CU demo',      5, 'verify body', true,  true);

-- 1. new columns + table exist
do $$
declare v_cols int; v_tab boolean;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'reviews_requests'
     and column_name in ('is_demo', 'google_clicked_at', 'feedback_rating', 'feedback_comment', 'feedback_at', 'followed_up_at', 'follow_up_channel');
  v_tab := to_regclass('public.reviews_showcase') is not null;
  perform pg_temp.cu_record(1, 'patch columns and reviews_showcase exist', v_cols = 7 and v_tab,
    format('%s/7 request columns, showcase table: %s', v_cols, v_tab));
end $$;

-- 2. the owner can follow a sent request up once
do $$
declare v_ok boolean := false; v_detail text;
begin
  begin
    set local role authenticated;
    update public.reviews_requests set followed_up_at = now(), follow_up_channel = 'whatsapp'
     where id = '00000000-0000-4000-8000-0000000ce0a1';
    v_ok := found;
    v_detail := 'first follow-up recorded';
  exception when others then v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.cu_record(2, 'owner can record the first follow-up on a sent request', v_ok, v_detail);
end $$;

-- 3. a second follow-up is refused for every role (authenticated AND postgres),
--    including moving, clearing or switching the channel
do $$
declare v_refused int := 0; v_detail text := ''; v_stmt text; v_role text;
begin
  foreach v_role in array array['authenticated', 'postgres'] loop
    foreach v_stmt in array array[
      $q$update public.reviews_requests set followed_up_at = now() + interval '1 day' where id = '00000000-0000-4000-8000-0000000ce0a1'$q$,
      $q$update public.reviews_requests set followed_up_at = null, follow_up_channel = null where id = '00000000-0000-4000-8000-0000000ce0a1'$q$,
      $q$update public.reviews_requests set follow_up_channel = 'email' where id = '00000000-0000-4000-8000-0000000ce0a1'$q$
    ] loop
      begin
        if v_role = 'authenticated' then set local role authenticated; end if;
        execute v_stmt;
        v_detail := v_detail || 'NOT refused as ' || v_role || ': ' || v_stmt || '; ';
      exception when check_violation then v_refused := v_refused + 1;
      when others then v_detail := v_detail || v_role || ' unexpected: ' || sqlerrm || '; ';
      end;
      reset role;
    end loop;
  end loop;
  perform pg_temp.cu_record(3, 'a second follow-up is refused by the database (owner and postgres)', v_refused = 6,
    coalesce(nullif(v_detail, ''), '6/6 refused'));
end $$;

-- 4. an unsent request cannot be followed up
do $$
declare v_pass boolean := false; v_detail text;
begin
  begin
    set local role authenticated;
    update public.reviews_requests set followed_up_at = now(), follow_up_channel = 'email'
     where id = '00000000-0000-4000-8000-0000000ce0a2';
    v_detail := 'follow-up on an unsent request was accepted';
  exception when check_violation then v_pass := true; v_detail := 'refused: ' || sqlerrm;
  when others then v_detail := 'unexpected: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.cu_record(4, 'an unsent request cannot be followed up', v_pass, v_detail);
end $$;

-- 5. anon submits feedback by token; bad rating / unknown token / bad token change nothing
do $$
declare v_ok boolean; v_bad1 boolean; v_bad2 boolean; v_bad3 boolean; v_rating int; v_comment text; v_clicked timestamptz;
        v_other int; v_detail text;
begin
  begin
    set local role anon;
    select public.reviews_submit_feedback('cu-verify-token-A', 2, '  Took longer than quoted  ') into v_ok;
    select public.reviews_submit_feedback('cu-verify-token-A', 9, 'x') into v_bad1;
    select public.reviews_submit_feedback('no-such-token-000', 5, 'x') into v_bad2;
    select public.reviews_submit_feedback('short', 5, 'x') into v_bad3;
  exception when others then v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  select feedback_rating, feedback_comment, clicked_at into v_rating, v_comment, v_clicked
    from public.reviews_requests where token = 'cu-verify-token-A';
  select count(*) into v_other from public.reviews_requests where token = 'cu-verify-token-B' and feedback_at is not null;
  perform pg_temp.cu_record(5, 'anon stores feedback by token only; invalid input is refused',
    v_ok and not v_bad1 and not v_bad2 and not v_bad3 and v_rating = 2 and v_comment = 'Took longer than quoted'
      and v_clicked is not null and v_other = 0,
    coalesce(v_detail, format('ok=%s rating9=%s unknown=%s short=%s stored=%s/%s opened=%s other_touched=%s',
      v_ok, v_bad1, v_bad2, v_bad3, v_rating, v_comment, v_clicked is not null, v_other)));
end $$;

-- 6. a rating-only resubmit keeps the comment; a comment over 1000 chars is cut
do $$
declare v_rating int; v_comment text; v_len int;
begin
  set local role anon;
  perform public.reviews_submit_feedback('cu-verify-token-A', 3, null);
  reset role;
  select feedback_rating, feedback_comment into v_rating, v_comment from public.reviews_requests where token = 'cu-verify-token-A';
  set local role anon;
  perform public.reviews_submit_feedback('cu-verify-token-A', 3, repeat('a', 1500));
  reset role;
  select length(feedback_comment) into v_len from public.reviews_requests where token = 'cu-verify-token-A';
  perform pg_temp.cu_record(6, 'rating-only resubmit keeps the words; long comments are capped at 1000',
    v_rating = 3 and v_comment = 'Took longer than quoted' and v_len = 1000,
    format('rating %s, comment kept: %s, capped length %s', v_rating, v_comment = 'Took longer than quoted', v_len));
end $$;

-- 7. anon stamps google_clicked_at once; a second tap doesn't move it
do $$
declare v_res boolean; v_first timestamptz; v_after timestamptz;
begin
  set local role anon;
  select public.reviews_google_click('cu-verify-token-A') into v_res;
  reset role;
  update public.reviews_requests set google_clicked_at = now() - interval '1 day' where token = 'cu-verify-token-A';
  select google_clicked_at into v_first from public.reviews_requests where token = 'cu-verify-token-A';
  set local role anon;
  perform public.reviews_google_click('cu-verify-token-A');
  reset role;
  select google_clicked_at into v_after from public.reviews_requests where token = 'cu-verify-token-A';
  perform pg_temp.cu_record(7, 'anon stamps google_clicked_at once (first tap wins)', v_res and v_first = v_after,
    format('returned %s, first %s, after second tap %s', v_res, v_first, v_after));
end $$;

-- 8. anon still has no direct access: cannot read feedback, cannot write any new column
do $$
declare v_denied int := 0; v_detail text := ''; v_stmt text;
begin
  foreach v_stmt in array array[
    $q$select feedback_comment from public.reviews_requests where token = 'cu-verify-token-A'$q$,
    $q$update public.reviews_requests set feedback_rating = 5 where token = 'cu-verify-token-A'$q$,
    $q$update public.reviews_requests set google_clicked_at = null where token = 'cu-verify-token-A'$q$,
    $q$update public.reviews_requests set followed_up_at = null where token = 'cu-verify-token-A'$q$,
    $q$select count(*) from public.reviews_showcase$q$,
    $q$insert into public.reviews_showcase (author_name, rating, body) values ('VERIFY CU anon', 5, 'x')$q$
  ] loop
    begin
      set local role anon;
      execute v_stmt;
      v_detail := v_detail || 'NOT denied: ' || v_stmt || '; ';
    exception when insufficient_privilege then v_denied := v_denied + 1;
    when others then v_detail := v_detail || 'unexpected: ' || sqlerrm || '; ';
    end;
    reset role;
  end loop;
  perform pg_temp.cu_record(8, 'anon cannot read feedback or touch new columns / showcase directly', v_denied = 6,
    coalesce(nullif(v_detail, ''), '6/6 denied'));
end $$;

-- 9. anon showcase door returns published, non-demo rows only
do $$
declare v_names text;
begin
  set local role anon;
  select string_agg(author_name, ',' order by author_name) into v_names
    from public.reviews_showcase_list() where author_name like 'VERIFY CU%';
  reset role;
  perform pg_temp.cu_record(9, 'showcase_list shows published, non-demo reviews only', v_names = 'VERIFY CU published',
    format('anon sees: %s', coalesce(v_names, '(none)')));
end $$;

-- 10. anon cannot load or remove demo data; the new doors are SECURITY DEFINER
do $$
declare v_load boolean := false; v_remove boolean := false; v_secdef int;
begin
  begin set local role anon; perform public.reviews_load_demo('{}'::jsonb);
  exception when insufficient_privilege then v_load := true; when others then v_load := false; end;
  reset role;
  begin set local role anon; perform public.reviews_remove_demo();
  exception when insufficient_privilege then v_remove := true; when others then v_remove := false; end;
  reset role;
  select count(*) into v_secdef from pg_proc
   where proname in ('reviews_submit_feedback', 'reviews_google_click', 'reviews_showcase_list') and prosecdef;
  perform pg_temp.cu_record(10, 'anon cannot load/remove demo; public doors are security definer',
    v_load and v_remove and v_secdef = 3, format('load denied %s, remove denied %s, secdef doors %s/3', v_load, v_remove, v_secdef));
end $$;

-- 11. a job or request for a demo customer inherits is_demo
do $$
declare v_c uuid; v_j boolean; v_r boolean;
begin
  insert into public.reviews_customers (name, phone, is_demo) values ('VERIFY CU demo cust', 'CU-VERIFY-2', true) returning id into v_c;
  insert into public.reviews_jobs (customer_id, description, completed_at) values (v_c, 'x', now()) returning is_demo into v_j;
  insert into public.reviews_requests (customer_id, channel) values (v_c, 'email') returning is_demo into v_r;
  delete from public.reviews_customers where id = v_c;
  perform pg_temp.cu_record(11, 'jobs/requests for a demo customer are demo too', v_j and v_r, format('job %s, request %s', v_j, v_r));
end $$;

-- 12. demo load marks every row; remove takes exactly those rows (skipped if demo already present)
do $$
declare v_pre int; v_fix int; v_res jsonb; v_rm jsonb; v_real_before int; v_real_after int; v_unmarked int; v_left int; v_detail text; v_pass boolean;
begin
  select (select count(*) from public.reviews_customers where is_demo)
       + (select count(*) from public.reviews_showcase where is_demo and author_name not like 'VERIFY CU%') into v_pre;
  -- this script's own demo showcase fixture (check 9) goes too
  select count(*) into v_fix from public.reviews_showcase where is_demo and author_name like 'VERIFY CU%';
  if v_pre > 0 then
    perform pg_temp.cu_record(12, 'demo load/remove round trip', true, format('SKIPPED: %s demo rows already loaded; not touched', v_pre));
    return;
  end if;
  select count(*) into v_real_before from public.reviews_requests where not is_demo;
  begin
    set local role authenticated;
    select public.reviews_load_demo(jsonb_build_object(
      'customers', jsonb_build_array(jsonb_build_object('key', 'k1', 'name', 'VERIFY CU demo', 'phone', 'CU-VERIFY-1', 'email', 'demo@example.com')),
      'jobs', jsonb_build_array(jsonb_build_object('key', 'j1', 'customer_key', 'k1', 'description', 'demo job', 'completed_at', now() - interval '3 days')),
      'requests', jsonb_build_array(jsonb_build_object('customer_key', 'k1', 'job_key', 'j1', 'channel', 'whatsapp',
         'sent_at', now() - interval '2 days', 'followed_up_at', now() - interval '1 day', 'follow_up_channel', 'whatsapp')),
      'showcase', jsonb_build_array(jsonb_build_object('author_name', 'VERIFY CU demo show', 'rating', 5, 'body', 'Sample review text'))
    )) into v_res;
    select count(*) into v_unmarked from (
      select is_demo from public.reviews_customers where name = 'VERIFY CU demo'
      union all select is_demo from public.reviews_jobs where description = 'demo job'
      union all select is_demo from public.reviews_showcase where author_name = 'VERIFY CU demo show') x where not is_demo;
    select public.reviews_remove_demo() into v_rm;
  exception when others then v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  select count(*) into v_left from public.reviews_customers where is_demo;
  select count(*) into v_real_after from public.reviews_requests where not is_demo;
  v_pass := v_detail is null and (v_res->>'customers_created')::int = 1 and (v_res->>'requests_created')::int = 1
            and v_unmarked = 0 and v_left = 0 and v_real_before = v_real_after
            and (v_rm->>'requests_removed')::int = 1 and (v_rm->>'showcase_removed')::int = 1 + v_fix;
  perform pg_temp.cu_record(12, 'demo load marks every row; remove deletes exactly the demo rows', v_pass,
    coalesce(v_detail, format('loaded %s; removed %s; unmarked %s; demo left %s; real requests %s -> %s (demo phone clash dropped the phone, not the load)',
      v_res, v_rm, v_unmarked, v_left, v_real_before, v_real_after)));
end $$;

-- 13. authenticated has full access to reviews_showcase
do $$
declare v_id uuid; v_pass boolean := false; v_detail text;
begin
  begin
    set local role authenticated;
    insert into public.reviews_showcase (author_name, rating, body) values ('VERIFY CU owner', 5, 'x') returning id into v_id;
    update public.reviews_showcase set published = false where id = v_id;
    delete from public.reviews_showcase where id = v_id;
    v_pass := true; v_detail := 'insert/update/delete ok';
  exception when others then v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.cu_record(13, 'authenticated has full access to reviews_showcase', v_pass, v_detail);
end $$;

-- 14. the follow-up guard is not keyed on auth.role()
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.reviews_guard_follow_up'::regproc) into v_src;
  perform pg_temp.cu_record(14, 'follow-up guard applies to every role (no auth.role() check)',
    regexp_replace(v_src, '--[^\n]*', '', 'g') not like '%auth.role()%' and v_src not like '%current_user%', 'ok');
end $$;

reset role;
delete from public.reviews_customers where phone in ('CU-VERIFY-1', 'CU-VERIFY-2') or name like 'VERIFY CU%';
delete from public.reviews_showcase where author_name like 'VERIFY CU%';

select n, "check", status, detail from pg_temp.reviews_cu_verify order by n;
