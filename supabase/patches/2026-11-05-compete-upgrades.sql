-- =============================================================================
-- Review Engine: compete pass, 2026-11-05
--
-- ADDITIVE ONLY. Paste into the Supabase SQL editor of a project that already
-- ran schema.sql (as the default postgres role). Idempotent: safe to run twice.
-- One transaction: it lands completely or not at all. Already folded into
-- schema.sql, so a fresh project only needs schema.sql.
--
-- NOT APPLIED to dropstack-dev by this build. Applying it is Tom's tap.
--
-- What it adds
--   is_demo on customers / jobs / requests / showcase
--       demo rows are marked so "Remove demo data" deletes exactly them
--   reviews_requests.google_clicked_at
--       the customer tapped the Google button on the landing (first tap only).
--       Still NOT "reviewed": Google reports nothing about whether a review
--       was actually left.
--   reviews_requests.feedback_rating / feedback_comment / feedback_at
--       the optional private "How was your experience?" answer. Stored for the
--       owner. It never changes where the customer can go: the Google button
--       is on the landing for everyone, before and after they answer.
--   reviews_requests.followed_up_at / follow_up_channel
--       the ONE allowed follow-up. reviews_guard_follow_up() refuses a second
--       one for every role (owner included), so the doctrine lives in the data
--       model, not just the UI.
--   reviews_showcase (new table, owner-only like the others)
--       hand-entered featured reviews for the embeddable showcase strip
--   reviews_guard_anon_click()   now compares every column except clicked_at,
--                                so new columns are covered automatically
--   reviews_inherit_demo()       jobs/requests for a demo customer are demo
--   reviews_submit_feedback()    anon door: store a rating (+comment) by token
--   reviews_google_click()       anon door: stamp google_clicked_at by token
--   reviews_showcase_list()      anon door: published, non-demo featured reviews
--   reviews_load_demo(jsonb)     owner: seed demo rows atomically, all is_demo
--   reviews_remove_demo()        owner: delete exactly the is_demo rows
--
-- RLS model unchanged: authenticated full access, anon NO table grants. anon's
-- only doors are SECURITY DEFINER functions that take a token and return a
-- boolean (or, for the showcase, only what the owner chose to publish).
-- verify-rls.sql and verify-compete-upgrades.sql must both read PASS on every
-- row afterwards.
-- =============================================================================

begin;

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
-- Anon update guard, widened: anon may move clicked_at from null to now() and
-- touch NOTHING else, including every column added above and any added later.
-- Still keyed on current_user (verify-rls check 13).
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
            coalesce((r->>'sent_at')::timestamptz, now()),
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

commit;
