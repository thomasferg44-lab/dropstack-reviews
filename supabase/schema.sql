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
