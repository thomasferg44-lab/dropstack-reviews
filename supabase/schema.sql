-- =============================================================================
-- DropStack Review Engine — schema + RLS
-- Run once in the Supabase SQL editor (as the default postgres role).
-- Every object is prefixed reviews_ because dropstack-dev is shared with two
-- sibling tools. Never touch anything without that prefix.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Unguessable URL-safe token for the public redirect link (/r/:token).
-- 18 random bytes -> 24 chars of base64url. ~144 bits of entropy.
create or replace function public.reviews_new_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.reviews_customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  email       text,
  created_at  timestamptz not null default now(),
  -- Prevent obvious duplicates. NULLs must stay DISTINCT here: with
  -- "nulls not distinct" only ONE customer could ever have an empty phone,
  -- which breaks importing any list with two email-only contacts.
  constraint reviews_customers_phone_key unique (phone)
);

create table if not exists public.reviews_jobs (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.reviews_customers(id) on delete cascade,
  description   text,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists public.reviews_requests (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.reviews_customers(id) on delete cascade,
  job_id        uuid references public.reviews_jobs(id) on delete set null,
  channel       text not null check (channel in ('whatsapp', 'email')),
  token         text not null unique default public.reviews_new_token(),
  sent_at       timestamptz,
  clicked_at    timestamptz,          -- "link opened". NOT "reviewed" — Google gives no such signal.
  created_at    timestamptz not null default now()
);

-- If the table was created by an earlier version of this file with
-- "unique nulls not distinct (phone)", swap the constraint (idempotent):
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.reviews_customers'::regclass
                and contype = 'u' and conkey = array[
                  (select attnum from pg_attribute where attrelid = 'public.reviews_customers'::regclass and attname = 'phone')]
                and pg_get_constraintdef(oid) ilike '%nulls not distinct%') then
    execute (select format('alter table public.reviews_customers drop constraint %I', conname)
               from pg_constraint
              where conrelid = 'public.reviews_customers'::regclass and contype = 'u'
                and pg_get_constraintdef(oid) ilike '%nulls not distinct%' limit 1);
    alter table public.reviews_customers add constraint reviews_customers_phone_key unique (phone);
  end if;
end $$;

create index if not exists reviews_jobs_customer_id_idx     on public.reviews_jobs (customer_id);
create index if not exists reviews_jobs_completed_at_idx    on public.reviews_jobs (completed_at);
create index if not exists reviews_requests_customer_id_idx on public.reviews_requests (customer_id);
create index if not exists reviews_requests_sent_at_idx     on public.reviews_requests (sent_at);

-- -----------------------------------------------------------------------------
-- Anon update guard (trigger)
-- Defence in depth. In normal operation anon has NO table grants and only reaches
-- this table through reviews_open_link() (which runs as the owner, so this guard
-- does not fire for it). If a grant to anon is ever added by mistake, this still
-- limits anon to moving clicked_at from NULL to now(), once, and nothing else.
-- -----------------------------------------------------------------------------

create or replace function public.reviews_guard_anon_click()
returns trigger
language plpgsql
-- Deliberately SECURITY INVOKER (the default): current_user must be the caller.
set search_path = public
as $$
begin
  -- Use current_user, NOT auth.role().
  -- auth.role() reads the JWT claim and is NULL when there is no API request
  -- (SQL editor, verify-rls.sql, psql, cron). A guard written on it silently
  -- passes in exactly the place you test it.
  if current_user <> 'anon' then
    return new;
  end if;

  if (to_jsonb(new) - 'clicked_at') is distinct from (to_jsonb(old) - 'clicked_at') then
    raise exception 'anon may only stamp clicked_at on reviews_requests'
      using errcode = 'insufficient_privilege';
  end if;

  if old.clicked_at is not null or new.clicked_at is null then
    return null;
  end if;

  new.clicked_at := now();
  return new;
end;
$$;

drop trigger if exists reviews_requests_guard_anon_click on public.reviews_requests;
create trigger reviews_requests_guard_anon_click
  before update on public.reviews_requests
  for each row execute function public.reviews_guard_anon_click();

-- -----------------------------------------------------------------------------
-- Privileges
-- Supabase grants ALL on new public tables to anon/authenticated by default.
-- Revoke that first, then grant only what each role needs.
-- -----------------------------------------------------------------------------

revoke all on table public.reviews_customers from anon, authenticated;
revoke all on table public.reviews_jobs      from anon, authenticated;
revoke all on table public.reviews_requests  from anon, authenticated;

-- Authenticated owner: full access (single-user tool, no public signup).
grant select, insert, update, delete on table public.reviews_customers to authenticated;
grant select, insert, update, delete on table public.reviews_jobs      to authenticated;
grant select, insert, update, delete on table public.reviews_requests  to authenticated;

-- Anon (public redirect page): NO table privileges at all. Its only door is the
-- reviews_open_link() function below. The business name the page renders comes
-- from companyConfig.js, not the DB.

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.reviews_customers enable row level security;
alter table public.reviews_jobs      enable row level security;
alter table public.reviews_requests  enable row level security;

-- customers / jobs: authenticated only. No anon policy exists, so anon sees nothing
-- even if a grant were ever added by mistake.
drop policy if exists reviews_customers_owner_all on public.reviews_customers;
create policy reviews_customers_owner_all on public.reviews_customers
  for all to authenticated using (true) with check (true);

drop policy if exists reviews_jobs_owner_all on public.reviews_jobs;
create policy reviews_jobs_owner_all on public.reviews_jobs
  for all to authenticated using (true) with check (true);

-- requests: owner full access.
drop policy if exists reviews_requests_owner_all on public.reviews_requests;
create policy reviews_requests_owner_all on public.reviews_requests
  for all to authenticated using (true) with check (true);

-- No anon policies exist on any table. With no grant and no policy, anon cannot
-- read or write a single row directly, even if a policy is later mis-written.

-- -----------------------------------------------------------------------------
-- Public-page RPC: the ONLY thing anon can call.
-- Stamps clicked_at once (first open only) and reports whether the token exists.
-- Returns a bare boolean: nothing about the customer, job or request leaks.
-- SECURITY DEFINER runs as the table owner, so the anon caller needs no grants.
-- -----------------------------------------------------------------------------

create or replace function public.reviews_open_link(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  if p_token is null or length(p_token) < 8 or length(p_token) > 128 then
    return false;
  end if;

  -- First open: stamp with server time. Later opens match zero rows (no-op).
  update public.reviews_requests
     set clicked_at = now()
   where token = p_token
     and clicked_at is null;

  select exists (select 1 from public.reviews_requests where token = p_token)
    into v_found;
  return v_found;
end;
$$;

-- Lock function privileges down explicitly. Two separate things to undo:
--   1. Postgres grants EXECUTE on new functions to PUBLIC.
--   2. Supabase's default privileges ALSO grant EXECUTE directly to anon,
--      authenticated and service_role. Revoking from PUBLIC alone leaves those
--      direct grants in place (verify-rls check 11 catches this).
-- reviews_new_token() is the token column default, so the owner (who inserts
-- requests) keeps EXECUTE on it; anon does not need it.
revoke all on function public.reviews_open_link(text)    from public, anon, authenticated;
revoke all on function public.reviews_new_token()        from public, anon, authenticated;
revoke all on function public.reviews_guard_anon_click() from public, anon, authenticated;
grant execute on function public.reviews_open_link(text) to anon, authenticated;
grant execute on function public.reviews_new_token()     to authenticated;

-- =============================================================================
-- Compete pass, 2026-11-05 (identical to supabase/patches/2026-11-05-compete-upgrades.sql,
-- minus the guard above, which is already the widened version). Idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns + constraints
-- -----------------------------------------------------------------------------
alter table public.reviews_customers add column if not exists is_demo boolean not null default false;
alter table public.reviews_jobs      add column if not exists is_demo boolean not null default false;
alter table public.reviews_requests  add column if not exists is_demo boolean not null default false;

alter table public.reviews_requests add column if not exists google_clicked_at timestamptz;
alter table public.reviews_requests add column if not exists feedback_rating   smallint;
alter table public.reviews_requests add column if not exists feedback_comment  text;
alter table public.reviews_requests add column if not exists feedback_at       timestamptz;
alter table public.reviews_requests add column if not exists followed_up_at    timestamptz;
alter table public.reviews_requests add column if not exists follow_up_channel text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reviews_requests_feedback_rating_range') then
    alter table public.reviews_requests add constraint reviews_requests_feedback_rating_range
      check (feedback_rating is null or feedback_rating between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reviews_requests_feedback_comment_len') then
    alter table public.reviews_requests add constraint reviews_requests_feedback_comment_len
      check (feedback_comment is null or length(feedback_comment) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reviews_requests_follow_up_channel_valid') then
    alter table public.reviews_requests add constraint reviews_requests_follow_up_channel_valid
      check (follow_up_channel is null or follow_up_channel in ('whatsapp', 'email'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reviews_requests_follow_up_pair') then
    alter table public.reviews_requests add constraint reviews_requests_follow_up_pair
      check ((followed_up_at is null) = (follow_up_channel is null));
  end if;
end $$;

create index if not exists reviews_customers_demo_idx on public.reviews_customers (is_demo) where is_demo;
create index if not exists reviews_jobs_demo_idx      on public.reviews_jobs (is_demo) where is_demo;
create index if not exists reviews_requests_demo_idx  on public.reviews_requests (is_demo) where is_demo;

-- -----------------------------------------------------------------------------
-- reviews_showcase: featured reviews the owner copied from their Google profile
-- -----------------------------------------------------------------------------
create table if not exists public.reviews_showcase (
  id           uuid primary key default gen_random_uuid(),
  author_name  text not null,
  rating       smallint not null,
  body         text not null,
  reviewed_on  date,
  published    boolean not null default true,
  sort_order   integer not null default 0,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),

  constraint reviews_showcase_author_len check (length(btrim(author_name)) between 1 and 60),
  constraint reviews_showcase_rating_range check (rating between 1 and 5),
  constraint reviews_showcase_body_len check (length(btrim(body)) between 1 and 600)
);

revoke all on table public.reviews_showcase from anon, authenticated;
grant select, insert, update, delete on table public.reviews_showcase to authenticated;
alter table public.reviews_showcase enable row level security;
drop policy if exists reviews_showcase_owner_all on public.reviews_showcase;
create policy reviews_showcase_owner_all on public.reviews_showcase
  for all to authenticated using (true) with check (true);


-- -----------------------------------------------------------------------------
-- ONE follow-up per request, for every role. A request can be followed up only
-- after it was sent, and once followed up the stamp can never be moved,
-- cleared or replaced. (Deleting the request is still possible; that removes
-- the ask entirely, it doesn't make room for a second follow-up.)
-- -----------------------------------------------------------------------------
create or replace function public.reviews_guard_follow_up()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.followed_up_at is not null
     and (new.followed_up_at is distinct from old.followed_up_at
          or new.follow_up_channel is distinct from old.follow_up_channel) then
    raise exception 'This request has already been followed up. One follow-up per request is the limit.'
      using errcode = 'check_violation';
  end if;

  if new.followed_up_at is not null and (tg_op = 'INSERT' or old.followed_up_at is null) then
    if new.sent_at is null then
      raise exception 'A request has to be sent before it can be followed up.'
        using errcode = 'check_violation';
    end if;
    if new.followed_up_at < new.sent_at then
      raise exception 'A follow-up cannot be dated before the request it follows.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists reviews_requests_guard_follow_up on public.reviews_requests;
create trigger reviews_requests_guard_follow_up
  before insert or update on public.reviews_requests
  for each row execute function public.reviews_guard_follow_up();

-- -----------------------------------------------------------------------------
-- A job or request for a demo customer is demo too, so "Remove demo data"
-- takes it with the customer.
-- -----------------------------------------------------------------------------
create or replace function public.reviews_inherit_demo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not new.is_demo then
    select coalesce(c.is_demo, false) into new.is_demo
      from public.reviews_customers c where c.id = new.customer_id;
    new.is_demo := coalesce(new.is_demo, false);
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_jobs_inherit_demo on public.reviews_jobs;
create trigger reviews_jobs_inherit_demo
  before insert on public.reviews_jobs
  for each row execute function public.reviews_inherit_demo();

drop trigger if exists reviews_requests_inherit_demo on public.reviews_requests;
create trigger reviews_requests_inherit_demo
  before insert on public.reviews_requests
  for each row execute function public.reviews_inherit_demo();

-- -----------------------------------------------------------------------------
-- Public (anon) doors. Each takes the unguessable token, touches only that
-- row, and returns a bare boolean. Nothing about the customer leaks.
-- -----------------------------------------------------------------------------

-- The private feedback answer. Re-submitting replaces the rating; a comment is
-- kept unless a new non-empty one arrives (the landing saves the rating on tap
-- and the words separately). Also counts as opening the link.
create or replace function public.reviews_submit_feedback(p_token text, p_rating integer, p_comment text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment text := nullif(left(btrim(coalesce(p_comment, '')), 1000), '');
begin
  if p_token is null or length(p_token) < 8 or length(p_token) > 128 then
    return false;
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return false;
  end if;

  update public.reviews_requests
     set feedback_rating  = p_rating,
         feedback_comment = coalesce(v_comment, feedback_comment),
         feedback_at      = now(),
         clicked_at       = coalesce(clicked_at, now())
   where token = p_token;
  return found;
end;
$$;

-- The customer tapped "Review us on Google". First tap only; also counts as
-- opening the link. This is a click, NOT a review.
create or replace function public.reviews_google_click(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or length(p_token) < 8 or length(p_token) > 128 then
    return false;
  end if;

  update public.reviews_requests
     set google_clicked_at = coalesce(google_clicked_at, now()),
         clicked_at        = coalesce(clicked_at, now())
   where token = p_token
     and (google_clicked_at is null or clicked_at is null);

  return exists (select 1 from public.reviews_requests where token = p_token);
end;
$$;

-- What the showcase strip may show: published, never demo, newest first.
create or replace function public.reviews_showcase_list()
returns table (author_name text, rating smallint, body text, reviewed_on date)
language sql
stable
security definer
set search_path = public
as $$
  select s.author_name, s.rating, s.body, s.reviewed_on
    from public.reviews_showcase s
   where s.published and not s.is_demo
   order by s.sort_order, s.reviewed_on desc nulls last, s.created_at desc
   limit 12;
$$;

-- -----------------------------------------------------------------------------
-- Demo mode (authenticated only)
-- payload: { customers: [{key,name,phone,email}],
--            jobs:      [{key,customer_key,description,completed_at}],
--            requests:  [{customer_key,job_key,channel,sent_at,clicked_at,
--                         google_clicked_at,feedback_rating,feedback_comment,
--                         feedback_at,followed_up_at,follow_up_channel}],
--            showcase:  [{author_name,rating,body,reviewed_on}] }
-- Every row is forced is_demo = true. A demo phone that already belongs to a
-- real customer is dropped (the demo customer keeps its email) rather than
-- failing the load or touching the real row.
-- -----------------------------------------------------------------------------
create or replace function public.reviews_load_demo(p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  c jsonb; j jsonb; r jsonb; s jsonb;
  v_ids jsonb := '{}'::jsonb;  v_jobs jsonb := '{}'::jsonb;
  v_id uuid; v_phone text;
  n_c int := 0; n_j int := 0; n_r int := 0; n_s int := 0;
begin
  if exists (select 1 from public.reviews_customers where is_demo) then
    raise exception 'Demo data is already loaded. Remove it first.' using errcode = 'check_violation';
  end if;

  for c in select * from jsonb_array_elements(coalesce(p->'customers', '[]'::jsonb)) loop
    v_phone := nullif(c->>'phone', '');
    if v_phone is not null and exists (select 1 from public.reviews_customers where phone = v_phone) then
      v_phone := null;
    end if;
    insert into public.reviews_customers (name, phone, email, is_demo)
    values (c->>'name', v_phone, nullif(c->>'email', ''), true)
    returning id into v_id;
    v_ids := v_ids || jsonb_build_object(c->>'key', v_id);
    n_c := n_c + 1;
  end loop;

  for j in select * from jsonb_array_elements(coalesce(p->'jobs', '[]'::jsonb)) loop
    if v_ids->>(j->>'customer_key') is null then
      raise exception 'Unknown customer key %', j->>'customer_key';
    end if;
    insert into public.reviews_jobs (customer_id, description, completed_at, created_at, is_demo)
    values ((v_ids->>(j->>'customer_key'))::uuid, j->>'description', (j->>'completed_at')::timestamptz,
            coalesce((j->>'created_at')::timestamptz, (j->>'completed_at')::timestamptz, now()), true)
    returning id into v_id;
    if j ? 'key' then v_jobs := v_jobs || jsonb_build_object(j->>'key', v_id); end if;
    n_j := n_j + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p->'requests', '[]'::jsonb)) loop
    if v_ids->>(r->>'customer_key') is null then
      raise exception 'Unknown customer key %', r->>'customer_key';
    end if;
    insert into public.reviews_requests (customer_id, job_id, channel, sent_at, clicked_at, google_clicked_at,
                                         feedback_rating, feedback_comment, feedback_at,
                                         followed_up_at, follow_up_channel, created_at, is_demo)
    values ((v_ids->>(r->>'customer_key'))::uuid,
            (v_jobs->>(r->>'job_key'))::uuid,
            r->>'channel',
            (r->>'sent_at')::timestamptz,
            (r->>'clicked_at')::timestamptz,
            (r->>'google_clicked_at')::timestamptz,
            (r->>'feedback_rating')::smallint,
            nullif(r->>'feedback_comment', ''),
            (r->>'feedback_at')::timestamptz,
            (r->>'followed_up_at')::timestamptz,
            nullif(r->>'follow_up_channel', ''),
            -- created now, sent in the past: the onboarding checklist reads
            -- that as "seeded", not as the owner's own first send
            now(),
            true);
    n_r := n_r + 1;
  end loop;

  for s in select * from jsonb_array_elements(coalesce(p->'showcase', '[]'::jsonb)) loop
    insert into public.reviews_showcase (author_name, rating, body, reviewed_on, sort_order, is_demo)
    values (s->>'author_name', (s->>'rating')::smallint, s->>'body', (s->>'reviewed_on')::date,
            coalesce((s->>'sort_order')::int, n_s), true);
    n_s := n_s + 1;
  end loop;

  return jsonb_build_object('customers_created', n_c, 'jobs_created', n_j,
                            'requests_created', n_r, 'showcase_created', n_s);
end;
$$;

-- Deletes exactly the is_demo rows. A demo customer the owner has since given
-- a real (non-demo) job or request is kept and un-marked.
create or replace function public.reviews_remove_demo()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  n_r int; n_j int; n_s int; n_c int; n_kept int;
begin
  delete from public.reviews_requests where is_demo;  get diagnostics n_r = row_count;
  delete from public.reviews_jobs     where is_demo;  get diagnostics n_j = row_count;
  delete from public.reviews_showcase where is_demo;  get diagnostics n_s = row_count;

  update public.reviews_customers c set is_demo = false
   where c.is_demo
     and (exists (select 1 from public.reviews_jobs j where j.customer_id = c.id)
          or exists (select 1 from public.reviews_requests q where q.customer_id = c.id));
  get diagnostics n_kept = row_count;

  delete from public.reviews_customers where is_demo;  get diagnostics n_c = row_count;

  return jsonb_build_object('requests_removed', n_r, 'jobs_removed', n_j, 'showcase_removed', n_s,
                            'customers_removed', n_c, 'customers_kept', n_kept);
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges. Undo BOTH the PUBLIC default and Supabase's direct
-- anon/authenticated default grants, then grant back exactly what is used.
-- -----------------------------------------------------------------------------
revoke all on function public.reviews_guard_anon_click()                      from public, anon, authenticated;
revoke all on function public.reviews_guard_follow_up()                       from public, anon, authenticated;
revoke all on function public.reviews_inherit_demo()                          from public, anon, authenticated;
revoke all on function public.reviews_submit_feedback(text, integer, text)    from public, anon, authenticated;
revoke all on function public.reviews_google_click(text)                      from public, anon, authenticated;
revoke all on function public.reviews_showcase_list()                         from public, anon, authenticated;
revoke all on function public.reviews_load_demo(jsonb)                        from public, anon, authenticated;
revoke all on function public.reviews_remove_demo()                           from public, anon, authenticated;

grant execute on function public.reviews_submit_feedback(text, integer, text) to anon, authenticated;
grant execute on function public.reviews_google_click(text)                   to anon, authenticated;
grant execute on function public.reviews_showcase_list()                      to anon, authenticated;
grant execute on function public.reviews_load_demo(jsonb)                     to authenticated;
grant execute on function public.reviews_remove_demo()                        to authenticated;
