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
  values (p_n, p_check, case when p_pass then 'PASS' else 'FAIL' end, p_detail);
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
    v_pass := (v_count = 0);
    v_detail := format('query succeeded, %s rows visible', v_count);
  exception
    when insufficient_privilege then
      v_pass := true; v_detail := 'permission denied (no grant) — correct';
    when others then
      v_pass := false; v_detail := 'unexpected error: ' || sqlerrm;
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
    v_pass := (v_count = 0);
    v_detail := format('query succeeded, %s rows visible', v_count);
  exception
    when insufficient_privilege then
      v_pass := true; v_detail := 'permission denied (no grant) — correct';
    when others then
      v_pass := false; v_detail := 'unexpected error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.reviews_verify_record(2, 'anon cannot list jobs', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 3. anon cannot list requests without a token
-- -----------------------------------------------------------------------------
do $$
declare v_count int; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    perform set_config('request.headers', '{}', true);
    select count(token) into v_count from public.reviews_requests;
    v_pass := (v_count = 0);
    v_detail := format('%s rows visible with no token header', v_count);
  exception
    when insufficient_privilege then
      v_pass := true; v_detail := 'permission denied — correct';
    when others then
      v_pass := false; v_detail := 'unexpected error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.reviews_verify_record(3, 'anon cannot list requests without a token', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 4. anon can read exactly one request by token (and not the other one)
-- -----------------------------------------------------------------------------
do $$
declare v_count int; v_id uuid; v_other int; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    select count(token) into v_count from public.reviews_requests;
    select id into v_id from public.reviews_requests where token = 'verify-token-A';
    select count(token) into v_other from public.reviews_requests where token = 'verify-token-B';
    v_pass := (v_count = 1 and v_id = '00000000-0000-4000-8000-0000000000a1' and v_other = 0);
    v_detail := format('%s row(s) visible with token A; B visible: %s', v_count, v_other);
  exception when others then
    v_pass := false; v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.reviews_verify_record(4, 'anon can read exactly one request by token', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 5. anon cannot read non-public columns (customer_id, sent_at, ...)
-- -----------------------------------------------------------------------------
do $$
declare v_x uuid; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    select customer_id into v_x from public.reviews_requests where token = 'verify-token-A';
    v_pass := false; v_detail := 'customer_id was readable by anon';
  exception
    when insufficient_privilege then
      v_pass := true; v_detail := 'permission denied on customer_id — correct';
    when others then
      v_pass := false; v_detail := 'unexpected error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.reviews_verify_record(5, 'anon cannot read customer_id on a request', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 6. anon can stamp clicked_at once, and the server ignores the client's value
-- -----------------------------------------------------------------------------
do $$
declare v_clicked timestamptz; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    -- client tries to backdate; trigger must overwrite with now()
    update public.reviews_requests set clicked_at = '2000-01-01'::timestamptz
      where token = 'verify-token-A' and clicked_at is null;
  exception when others then
    v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  select clicked_at into v_clicked from public.reviews_requests where token = 'verify-token-A';
  v_pass := (v_clicked is not null and v_clicked > now() - interval '1 minute');
  v_detail := coalesce(v_detail, format('clicked_at = %s', v_clicked));
  perform pg_temp.reviews_verify_record(6, 'anon can stamp clicked_at once (server time, not client value)', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 7. a second stamp is a no-op (clicked_at does not move)
-- -----------------------------------------------------------------------------
do $$
declare v_before timestamptz; v_after timestamptz; v_pass boolean; v_detail text;
begin
  select clicked_at into v_before from public.reviews_requests where token = 'verify-token-A';
  perform pg_sleep(0.05);
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    update public.reviews_requests set clicked_at = now() where token = 'verify-token-A';
  exception when others then
    v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  select clicked_at into v_after from public.reviews_requests where token = 'verify-token-A';
  v_pass := (v_after = v_before);
  v_detail := coalesce(v_detail, format('before %s, after %s', v_before, v_after));
  perform pg_temp.reviews_verify_record(7, 'second stamp is a no-op', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 8. anon cannot clear clicked_at back to null
-- -----------------------------------------------------------------------------
do $$
declare v_after timestamptz; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    update public.reviews_requests set clicked_at = null where token = 'verify-token-A';
  exception when others then
    v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  select clicked_at into v_after from public.reviews_requests where token = 'verify-token-A';
  v_pass := (v_after is not null);
  v_detail := coalesce(v_detail, format('clicked_at still %s', v_after));
  perform pg_temp.reviews_verify_record(8, 'anon cannot clear clicked_at', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 9. anon cannot change token
-- -----------------------------------------------------------------------------
do $$
declare v_tok text; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    update public.reviews_requests set token = 'hijacked' where token = 'verify-token-A';
    v_detail := 'update was not rejected';
  exception
    when insufficient_privilege then
      v_detail := 'rejected: ' || sqlerrm;
    when others then
      -- any other error (e.g. a FK violation) means the write got PAST the
      -- grant/policy/trigger layer — that is a FAIL, not a pass.
      v_pass := false;
      v_detail := 'NOT blocked by grant/RLS/trigger, failed later on: ' || sqlerrm;
  end;
  reset role;
  select token into v_tok from public.reviews_requests where id = '00000000-0000-4000-8000-0000000000a1';
  v_pass := coalesce(v_pass, v_tok = 'verify-token-A');
  perform pg_temp.reviews_verify_record(9, 'anon cannot change token', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 10. anon cannot change sent_at
-- -----------------------------------------------------------------------------
do $$
declare v_before timestamptz; v_after timestamptz; v_pass boolean; v_detail text;
begin
  select sent_at into v_before from public.reviews_requests where token = 'verify-token-A';
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    update public.reviews_requests set sent_at = null where token = 'verify-token-A';
    v_detail := 'update was not rejected';
  exception
    when insufficient_privilege then
      v_detail := 'rejected: ' || sqlerrm;
    when others then
      -- any other error (e.g. a FK violation) means the write got PAST the
      -- grant/policy/trigger layer — that is a FAIL, not a pass.
      v_pass := false;
      v_detail := 'NOT blocked by grant/RLS/trigger, failed later on: ' || sqlerrm;
  end;
  reset role;
  select sent_at into v_after from public.reviews_requests where token = 'verify-token-A';
  v_pass := coalesce(v_pass, v_after = v_before);
  perform pg_temp.reviews_verify_record(10, 'anon cannot change sent_at', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 11. anon cannot change customer_id
-- -----------------------------------------------------------------------------
do $$
declare v_after uuid; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    update public.reviews_requests set customer_id = gen_random_uuid() where token = 'verify-token-A';
    v_detail := 'update was not rejected';
  exception
    when insufficient_privilege then
      v_detail := 'rejected: ' || sqlerrm;
    when others then
      -- any other error (e.g. a FK violation) means the write got PAST the
      -- grant/policy/trigger layer — that is a FAIL, not a pass.
      v_pass := false;
      v_detail := 'NOT blocked by grant/RLS/trigger, failed later on: ' || sqlerrm;
  end;
  reset role;
  select customer_id into v_after from public.reviews_requests where token = 'verify-token-A';
  v_pass := coalesce(v_pass, v_after = '00000000-0000-4000-8000-0000000000c0');
  perform pg_temp.reviews_verify_record(11, 'anon cannot change customer_id', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 12. anon holding token A cannot stamp request B
-- -----------------------------------------------------------------------------
do $$
declare v_after timestamptz; v_pass boolean; v_detail text;
begin
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    update public.reviews_requests set clicked_at = now() where token = 'verify-token-B';
  exception when others then
    v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  select clicked_at into v_after from public.reviews_requests where token = 'verify-token-B';
  v_pass := (v_after is null);
  v_detail := coalesce(v_detail, format('B clicked_at = %s', v_after));
  perform pg_temp.reviews_verify_record(12, 'anon cannot stamp a request it does not hold the token for', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 13. anon cannot insert or delete requests
-- -----------------------------------------------------------------------------
do $$
declare v_ins boolean := false; v_del boolean := false; v_count int;
begin
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    insert into public.reviews_requests (customer_id, channel)
      values ('00000000-0000-4000-8000-0000000000c0', 'email');
  exception
    when insufficient_privilege then v_ins := true;
    when others then v_ins := false;
  end;
  reset role;
  begin
    set local role anon;
    perform set_config('request.headers', '{"x-review-token":"verify-token-A"}', true);
    delete from public.reviews_requests where token = 'verify-token-A';
  exception
    when insufficient_privilege then v_del := true;
    when others then v_del := false;
  end;
  reset role;
  select count(*) into v_count from public.reviews_requests
    where customer_id = '00000000-0000-4000-8000-0000000000c0';
  perform pg_temp.reviews_verify_record(13, 'anon cannot insert or delete requests',
    v_ins and v_del and v_count = 2,
    format('insert denied: %s, delete denied: %s, rows remaining: %s', v_ins, v_del, v_count));
end $$;

-- -----------------------------------------------------------------------------
-- 14. authenticated has full access (select / insert / update / delete on all three)
-- -----------------------------------------------------------------------------
do $$
declare v_c int; v_j int; v_r int; v_new uuid; v_pass boolean; v_detail text;
begin
  begin
    set local role authenticated;
    select count(*) into v_c from public.reviews_customers where id = '00000000-0000-4000-8000-0000000000c0';
    select count(*) into v_j from public.reviews_jobs      where customer_id = '00000000-0000-4000-8000-0000000000c0';
    select count(*) into v_r from public.reviews_requests  where customer_id = '00000000-0000-4000-8000-0000000000c0';

    insert into public.reviews_customers (name, phone) values ('RLS VERIFY 2', '+27000000001') returning id into v_new;
    update public.reviews_customers set name = 'RLS VERIFY 2 (edited)' where id = v_new;
    update public.reviews_requests set sent_at = now() where token = 'verify-token-B';
    delete from public.reviews_customers where id = v_new;

    v_pass := (v_c = 1 and v_j = 1 and v_r = 2);
    v_detail := format('read %s customer, %s job, %s requests; insert/update/delete ok', v_c, v_j, v_r);
  exception when others then
    v_pass := false; v_detail := 'error: ' || sqlerrm;
  end;
  reset role;
  perform pg_temp.reviews_verify_record(14, 'authenticated has full access', v_pass, v_detail);
end $$;

-- -----------------------------------------------------------------------------
-- 15. the guard trigger keys on current_user (not auth.role())
-- -----------------------------------------------------------------------------
do $$
declare v_src text; v_pass boolean;
begin
  select pg_get_functiondef('public.reviews_guard_anon_click'::regproc) into v_src;
  -- a comment mentioning auth.role() is fine; only a live call is a bug
  v_pass := (v_src like '%current_user <> ''anon''%')
            and (regexp_replace(v_src, '--[^\n]*', '', 'g') not like '%auth.role()%');
  perform pg_temp.reviews_verify_record(15, 'guard trigger checks current_user, not auth.role()', v_pass,
    case when v_pass then 'ok' else 'trigger source does not check current_user, or calls auth.role()' end);
end $$;

-- -----------------------------------------------------------------------------
-- Cleanup + results
-- -----------------------------------------------------------------------------
reset role;
delete from public.reviews_customers where id = '00000000-0000-4000-8000-0000000000c0';

select n, "check", status, detail
from pg_temp.reviews_verify
order by n;
