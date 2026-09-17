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

-- The token the *public page* presents, read from the request header
-- `x-review-token` that supabase-js sends on the anon client.
-- Anon RLS policies are scoped to this single token, so an anon caller can
-- never list requests — it can only see the one row whose token it already
-- holds. Returns NULL outside an API request (SQL editor, psql), which makes
-- every anon policy evaluate to false there.
create or replace function public.reviews_request_token()
returns text
language sql
stable
set search_path = public
as $$
  select nullif(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-review-token',
    ''
  );
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
  unique nulls not distinct (phone)   -- prevent obvious duplicates
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

create index if not exists reviews_jobs_customer_id_idx     on public.reviews_jobs (customer_id);
create index if not exists reviews_jobs_completed_at_idx    on public.reviews_jobs (completed_at);
create index if not exists reviews_requests_customer_id_idx on public.reviews_requests (customer_id);
create index if not exists reviews_requests_sent_at_idx     on public.reviews_requests (sent_at);

-- -----------------------------------------------------------------------------
-- Anon update guard (trigger)
-- Belt-and-braces on top of the column-level GRANT below: even if a grant is
-- widened by mistake later, anon can still only move clicked_at from NULL to
-- now(), once, and cannot touch any other column.
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
  -- (SQL editor, verify-rls.sql, psql, cron). A guard written on auth.role()
  -- silently passes in exactly the place you test it. This bug shipped
  -- undetected on a previous project.
  if current_user <> 'anon' then
    return new;
  end if;

  if new.id          is distinct from old.id
  or new.customer_id is distinct from old.customer_id
  or new.job_id      is distinct from old.job_id
  or new.channel     is distinct from old.channel
  or new.token       is distinct from old.token
  or new.sent_at     is distinct from old.sent_at
  or new.created_at  is distinct from old.created_at
  then
    raise exception 'anon may only stamp clicked_at on reviews_requests'
      using errcode = 'insufficient_privilege';
  end if;

  -- Already stamped, or not actually stamping: silent no-op.
  if old.clicked_at is not null or new.clicked_at is null then
    return null;
  end if;

  -- Server time. The client's value is ignored so it cannot backdate.
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

-- Anon (public redirect page): read three columns of one request, and write
-- exactly one column. Nothing on customers or jobs — the business name the
-- page renders comes from companyConfig.js, not the DB.
grant select (id, token, clicked_at) on table public.reviews_requests to anon;
grant update (clicked_at)            on table public.reviews_requests to anon;

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

-- requests: owner full access; anon scoped to the single token it presents.
drop policy if exists reviews_requests_owner_all on public.reviews_requests;
create policy reviews_requests_owner_all on public.reviews_requests
  for all to authenticated using (true) with check (true);

drop policy if exists reviews_requests_anon_select on public.reviews_requests;
create policy reviews_requests_anon_select on public.reviews_requests
  for select to anon
  using (token = public.reviews_request_token());

drop policy if exists reviews_requests_anon_stamp on public.reviews_requests;
create policy reviews_requests_anon_stamp on public.reviews_requests
  for update to anon
  using (token = public.reviews_request_token())
  with check (token = public.reviews_request_token());
