-- =============================================================================
-- DropStack Review Engine — RLS verification
-- Run in the Supabase SQL editor AFTER schema.sql, as the default postgres role.
-- Output: one row per check with PASS / FAIL. Every row must be PASS.
--
-- It creates its own throwaway test rows (customer "RLS VERIFY", phone
-- +27000000000) and deletes them at the end. Safe to re-run.
--
-- Why current_user and not auth.role():
--   auth.role() is derived from the API JWT. Here there is no API request, so
--   it is NULL for every check — a guard written on it would never fire and
--   this script would "pass" against a wide-open table. `set role anon`
--   changes current_user, which is what Postgres privileges, RLS, and the
--   trigger guard actually key on.
--
-- Design under test: anon has ZERO grants on every reviews_* table. Its only
-- door is reviews_open_link(token), a SECURITY DEFINER function that stamps
-- clicked_at once and returns a bare boolean.
-- =============================================================================

drop table if exists pg_temp.reviews_verify;
create temp table reviews_verify (
  n       int,
  "check" text,
  status  text,
  detail  text
);

create or replace function pg_temp.reviews_verify_record(
  p_n int, p_check text, p_pass boolean, p_detail text
) returns void language sql as $$
  insert into pg_temp.reviews_verify (n, "check", status, detail)
  values (p_n, p_check, case when coalesce(p_pass, false) then 'PASS' else 'FAIL' end, p_detail);
$$;

-- -----------------------------------------------------------------------------
-- Fixtures (inserted as postgres, who owns the tables and bypasses RLS)
-- -----------------------------------------------------------------------------
reset role;
delete from public.reviews_customers where id = '00000000-0000-4000-8000-0000000000c0';

insert into public.reviews_customers (id, name, phone, email)
values ('00000000-0000-4000-8000-0000000000c0', 'RLS VERIFY', '+27000000000', 'test@example.com');

insert into public.reviews_jobs (id, customer_id, description, completed_at)
values ('00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-0000000000c0', 'verify job', now());

-- Two requests: A is the one "our" anon caller holds the token for, B is someone else's.
insert into public.reviews_requests (id, customer_id, job_id, channel, token, sent_at)
values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c0',
   '00000000-0000-4000-8000-0000000000b0', 'whatsapp', 'verify-token-A', now()),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c0',
   '00000000-0000-4000-8000-0000000000b0', 'email',    'verify-token-B', now());

-- -----------------------------------------------------------------------------
-- 1. anon cannot list customers
-- -----------------------------------------------------------------------------
do $$
declare v_count int; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    select count(name) into v_count from public.reviews_customers;
    v_pass := false; v_detail := format('query succeeded, %s rows visible', v_count);
  exception
    when insufficient_privilege then v_pass := true; v_detail := 'permission denied (no grant) — correct';
    when others then v_pass := false; v_detail := 'unexpected error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.reviews_verify_record(1, 'anon cannot list customers', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 2. anon cannot list jobs
-- -----------------------------------------------------------------------------
do $$
declare v_count int; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    select count(description) into v_count from public.reviews_jobs;
    v_pass := false; v_detail := format('query succeeded, %s rows visible', v_count);
  exception
    when insufficient_privilege then v_pass := true; v_detail := 'permission denied (no grant) — correct';
    when others then v_pass := false; v_detail := 'unexpected error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.reviews_verify_record(2, 'anon cannot list jobs', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 3. anon cannot list requests (no token, no grant, no policy)
-- -----------------------------------------------------------------------------
do $$
declare v_count int; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    select count(token) into v_count from public.reviews_requests;
    v_pass := false; v_detail := format('query succeeded, %s rows visible', v_count);
  exception
    when insufficient_privilege then v_pass := true; v_detail := 'permission denied (no grant) — correct';
    when others then v_pass := false; v_detail := 'unexpected error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.reviews_verify_record(3, 'anon cannot list requests without a token', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 4. anon cannot read a request directly even when it knows the token
--    (the only read path is the RPC, which returns a boolean, not the row)
-- -----------------------------------------------------------------------------
do $$
declare v_id uuid; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    select id into v_id from public.reviews_requests where token = 'verify-token-A';
    v_pass := false; v_detail := format('row readable directly, id = %s', v_id);
  exception
    when insufficient_privilege then v_pass := true; v_detail := 'permission denied — correct';
    when others then v_pass := false; v_detail := 'unexpected error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.reviews_verify_record(4, 'anon cannot read a request row directly by token', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 5. anon cannot update any column directly (clicked_at, token, sent_at, customer_id)
-- -----------------------------------------------------------------------------
do $$
declare v_denied int := 0; v_detail text := ''; v_stmt text;
begin
  foreach v_stmt in array array[
    $q$update public.reviews_requests set clicked_at  = now()             where token = 'verify-token-A'$q$,
    $q$update public.reviews_requests set token       = 'hijacked'        where token = 'verify-token-A'$q$,
    $q$update public.reviews_requests set sent_at     = null              where token = 'verify-token-A'$q$,
    $q$update public.reviews_requests set customer_id = gen_random_uuid() where token = 'verify-token-A'$q$
  ] loop
    begin
      set local role anon;
      execute v_stmt;
      v_detail := v_detail || 'NOT blocked: ' || v_stmt || '; ';
    exception
      when insufficient_privilege then v_denied := v_denied + 1;
      when others then v_detail := v_detail || 'got past grant/RLS: ' || sqlerrm || '; ';
    end;
    reset role;
  end loop;
  perform pg_temp.reviews_verify_record(5, 'anon cannot update clicked_at, token, sent_at or customer_id directly',
    v_denied = 4, coalesce(nullif(v_detail, ''), '4/4 updates denied'));
end $$;

-- -----------------------------------------------------------------------------
-- 6. anon cannot insert or delete requests
-- -----------------------------------------------------------------------------
do $$
declare v_ins boolean := false; v_del boolean := false; v_count int;
begin
  begin
    set local role anon;
    insert into public.reviews_requests (customer_id, channel, token)
      values ('00000000-0000-4000-8000-0000000000c0', 'email', 'verify-token-X');
  exception
    when insufficient_privilege then v_ins := true;
    when others then v_ins := false;
  end;
  reset role;
  begin
    set local role anon;
    delete from public.reviews_requests where token = 'verify-token-A';
  exception
    when insufficient_privilege then v_del := true;
    when others then v_del := false;
  end;
  reset role;
  select count(*) into v_count from public.reviews_requests
    where customer_id = '00000000-0000-4000-8000-0000000000c0';
  perform pg_temp.reviews_verify_record(6, 'anon cannot insert or delete requests',
    v_ins and v_del and v_count = 2,
    format('insert denied: %s, delete denied: %s, rows remaining: %s', v_ins, v_del, v_count));
end $$;

-- -----------------------------------------------------------------------------
-- 7. reviews_open_link() with an unknown token returns false and changes nothing
-- -----------------------------------------------------------------------------
do $$
declare v_res boolean; v_stamped int; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    select public.reviews_open_link('no-such-token-000') into v_res;
  exception when others then
    v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  select count(*) into v_stamped from public.reviews_requests
    where customer_id = '00000000-0000-4000-8000-0000000000c0' and clicked_at is not null;
  v_pass := (v_res is false and v_stamped = 0);
  v_detail := coalesce(v_detail, format('returned %s, stamped rows: %s', v_res, v_stamped));
  perform pg_temp.reviews_verify_record(7, 'open_link with unknown token returns false, stamps nothing', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 8. anon can stamp clicked_at once via reviews_open_link() (server time)
-- -----------------------------------------------------------------------------
do $$
declare v_res boolean; v_clicked timestamptz; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    select public.reviews_open_link('verify-token-A') into v_res;
  exception when others then
    v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  select clicked_at into v_clicked from public.reviews_requests where token = 'verify-token-A';
  v_pass := (v_res is true and v_clicked is not null and v_clicked > now() - interval '1 minute');
  v_detail := coalesce(v_detail, format('returned %s, clicked_at = %s', v_res, v_clicked));
  perform pg_temp.reviews_verify_record(8, 'anon can stamp clicked_at once via open_link', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 9. a second open is a no-op (still returns true, clicked_at does not move)
-- -----------------------------------------------------------------------------
do $$
declare v_res boolean; v_before timestamptz; v_after timestamptz; v_pass boolean; v_detail text;
begin
  -- now() is frozen for the whole script (one transaction), so a re-stamp would be
  -- invisible. Push the stamp into the past first; a correct open_link leaves it there.
  update public.reviews_requests set clicked_at = now() - interval '1 day' where token = 'verify-token-A';
  select clicked_at into v_before from public.reviews_requests where token = 'verify-token-A';
  begin
    set local role anon;
    select public.reviews_open_link('verify-token-A') into v_res;
  exception when others then
    v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  select clicked_at into v_after from public.reviews_requests where token = 'verify-token-A';
  v_pass := (v_res is true and v_after = v_before);
  v_detail := coalesce(v_detail, format('returned %s, before %s, after %s', v_res, v_before, v_after));
  perform pg_temp.reviews_verify_record(9, 'second open is a no-op', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 10. opening A did not touch B
-- -----------------------------------------------------------------------------
do $$
declare v_b timestamptz;
begin
  select clicked_at into v_b from public.reviews_requests where token = 'verify-token-B';
  perform pg_temp.reviews_verify_record(10, 'opening one link does not stamp another request',
    v_b is null, format('B clicked_at = %s', v_b));
end $$;

-- -----------------------------------------------------------------------------
-- 11. reviews_open_link is SECURITY DEFINER, not owned by anon, not executable by PUBLIC,
--     and anon cannot call reviews_new_token()
-- -----------------------------------------------------------------------------
do $$
declare v_secdef boolean; v_owner text; v_public_exec boolean; v_anon_exec boolean;
        v_anon_token boolean := false; v_pass boolean;
begin
  select p.prosecdef, r.rolname
    into v_secdef, v_owner
    from pg_proc p join pg_roles r on r.oid = p.proowner
   where p.oid = 'public.reviews_open_link(text)'::regprocedure;
  v_public_exec := has_function_privilege('public', 'public.reviews_open_link(text)', 'execute');
  v_anon_exec   := has_function_privilege('anon',   'public.reviews_open_link(text)', 'execute');
  begin
    set local role anon;
    perform public.reviews_new_token();
  exception
    when insufficient_privilege then v_anon_token := true;
    when others then v_anon_token := false;
  end;
  reset role;
  v_pass := v_secdef and v_owner not in ('anon', 'authenticated') and not v_public_exec and v_anon_exec and v_anon_token;
  perform pg_temp.reviews_verify_record(11, 'open_link is security definer, owned by owner, anon-only execute', v_pass,
    format('security definer: %s, owner: %s, PUBLIC execute: %s, anon execute: %s, anon blocked from new_token: %s',
           v_secdef, v_owner, v_public_exec, v_anon_exec, v_anon_token));
end $$;

-- -----------------------------------------------------------------------------
-- 12. authenticated has full access (select / insert / update / delete on all three,
--     including inserting a request so the token default works for the owner)
-- -----------------------------------------------------------------------------
do $$
declare v_c int; v_j int; v_r int; v_new uuid; v_tok text; v_pass boolean; v_detail text;
begin
  begin
    set local role authenticated;
    select count(*) into v_c from public.reviews_customers where id = '00000000-0000-4000-8000-0000000000c0';
    select count(*) into v_j from public.reviews_jobs      where customer_id = '00000000-0000-4000-8000-0000000000c0';
    select count(*) into v_r from public.reviews_requests  where customer_id = '00000000-0000-4000-8000-0000000000c0';

    insert into public.reviews_customers (name, phone) values ('RLS VERIFY 2', '+27000000001') returning id into v_new;
    update public.reviews_customers set name = 'RLS VERIFY 2 (edited)' where id = v_new;
    insert into public.reviews_requests (customer_id, channel) values (v_new, 'email') returning token into v_tok;
    update public.reviews_requests set sent_at = now() where token = v_tok;
    delete from public.reviews_customers where id = v_new;   -- cascades to the request

    v_pass := (v_c = 1 and v_j = 1 and v_r = 2 and length(v_tok) >= 20);
    v_detail := format('read %s customer, %s job, %s requests; insert/update/delete ok; generated token length %s',
                       v_c, v_j, v_r, length(v_tok));
  exception when others then
    v_pass := false; v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.reviews_verify_record(12, 'authenticated has full access', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 13. the defence-in-depth trigger keys on current_user (not auth.role())
-- -----------------------------------------------------------------------------
do $$
declare v_src text; v_pass boolean;
begin
  select pg_get_functiondef('public.reviews_guard_anon_click'::regproc) into v_src;
  -- a comment mentioning auth.role() is fine; only a live call is a bug
  v_pass := (v_src like '%current_user <> ''anon''%')
            and (regexp_replace(v_src, '--[^\n]*', '', 'g') not like '%auth.role()%');
  perform pg_temp.reviews_verify_record(13, 'guard trigger checks current_user, not auth.role()', v_pass,
    case when v_pass then 'ok' else 'trigger source does not check current_user, or calls auth.role()' end);
end $$;

-- -----------------------------------------------------------------------------
-- 14. no reviews_* function is executable by anon or PUBLIC except the one
--     intended public door. Catches the Supabase default-privilege trap for any
--     function added later: Supabase grants EXECUTE directly to anon/authenticated
--     on every new public function, and `revoke ... from public` does not undo that.
-- -----------------------------------------------------------------------------
do $$
declare v_bad text := ''; v_total int := 0; r record;
begin
  for r in
    select p.oid::regprocedure::text as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'reviews\_%'
  loop
    v_total := v_total + 1;
    if has_function_privilege('anon', r.sig, 'execute') and r.proname <> 'reviews_open_link' then
      v_bad := v_bad || r.sig || ' (anon); ';
    end if;
    if has_function_privilege('public', r.sig, 'execute') then
      v_bad := v_bad || r.sig || ' (PUBLIC); ';
    end if;
  end loop;
  perform pg_temp.reviews_verify_record(14, 'no reviews_* function is executable by anon or PUBLIC except open_link',
    v_bad = '' and v_total >= 3,
    case when v_bad = '' then format('%s functions checked, all locked down', v_total)
         else 'stray EXECUTE grants: ' || v_bad end);
end $$;

-- -----------------------------------------------------------------------------
-- Cleanup + results
-- -----------------------------------------------------------------------------
reset role;
delete from public.reviews_customers where id = '00000000-0000-4000-8000-0000000000c0';

select n, "check", status, detail
from pg_temp.reviews_verify
order by n;
