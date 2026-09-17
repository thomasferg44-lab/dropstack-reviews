# CLAUDE.md — DropStack Review Request Engine

Read automatically by Claude Code at session start. Source of truth for this repo. Follow it over any conflicting default behavior.

## Project

**Name:** DropStack Review Engine
**Owner:** Thomas — DropStack
**Purpose:** Make it effortless for a service business to ask every finished customer for a Google review, and to know who's been asked. One deploy per client.

**Why it matters:** for local service businesses, review count and recency drive map-pack ranking, which drives inbound enquiries. Most small operators know they should ask and simply never do, because the asking is awkward and they've lost track of who they've already asked. This tool removes both problems.

This is one of four tools sold as a package. It is standalone — no cross-tool dependencies.

## Tech stack — do not introduce others without asking

- React + Vite, Tailwind CSS
- Supabase (Postgres + Auth)
- Resend for email, via Netlify Functions (server-side only)
- Netlify hosting

## Supabase arrangement — read carefully

During development this tool shares a Supabase project (`dropstack-dev`) with two siblings. **Every table here is prefixed `reviews_`.** Never touch a table without that prefix. At client deploy time it gets its own project; the prefix stays.

## Non-negotiable workflow rules

- **Never push directly to main.** Branch + PR every time.
- **Do not deploy.** Thomas handles that.
- **Never send real messages during development.** `+27000000000`, `test@example.com`.
- **No secrets in committed code.**
- **Ask before adding a dependency.**

## ⚠️ Review gating is prohibited — read this before building anything

A common pattern in this category is to first ask "how did we do?", then route happy customers to Google and unhappy ones to a private feedback form. **Do not build this.** Google's policies explicitly prohibit selectively soliciting positive reviews, and businesses caught doing it risk having their reviews stripped or their listing penalized. Shipping it would expose Thomas's clients to real harm.

**What to build instead:** every customer gets the same request with the same link to the public review page, regardless of predicted sentiment. If the client wants private feedback, that's a separate, clearly-labelled "send us feedback" option offered to *everyone* — never a filter placed in front of the review link.

If you find yourself designing a flow where the destination depends on a satisfaction answer, stop and flag it rather than building it.

## Design tokens — shared across all four DropStack tools

**Public pages** (the redirect/landing page a customer hits) — *client-branded*, from `companyConfig.js`.

**Owner dashboard** — *DropStack-branded*, dark, fixed tokens:
```
--bg:        #0B0F1A
--surface:   #151D31
--border:    #243250
--text:      #FFFFFF
--text-mute: #8B95A8
--text-dim:  #5B6B8C
--accent-1:  #00D4FF
--accent-2:  #7B5CFF
/* gradient: linear-gradient(90deg, #00D4FF, #7B5CFF) */
```
Identical across all four package tools. Gradient for primary actions only.

## Data model

```sql
create table reviews_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  unique nulls not distinct (phone)   -- prevent obvious duplicates
);

create table reviews_jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references reviews_customers(id) on delete cascade,
  description text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table reviews_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references reviews_customers(id) on delete cascade,
  job_id uuid references reviews_jobs(id) on delete set null,
  channel text not null,            -- 'whatsapp' | 'email'
  token text not null unique,       -- unguessable, used in the public redirect URL
  sent_at timestamptz,
  clicked_at timestamptz,           -- set when the customer opens the redirect page
  created_at timestamptz not null default now()
);
```

### Honesty about what can be tracked

You can track that a request was sent and that the link was clicked. **You cannot track whether a review was actually left** — Google provides no such signal. Do not build UI that implies otherwise, do not label a clicked link as "reviewed," and do not invent a completion state. Label it exactly what it is: "link opened." Overstating this would make the client distrust every other number in the product.

### RLS

- anon: `SELECT` on `reviews_requests` by `token` only, and `UPDATE` limited to stamping `clicked_at` once. Nothing else. No access to `reviews_customers` or `reviews_jobs` beyond the business name needed to render the page — pass that from config, not from the DB.
- authenticated owner: full access.
- Guard the anon update with a trigger so it can only move `clicked_at` from null to now(), and cannot touch any other column.

**Write `supabase/verify-rls.sql`** printing PASS/FAIL for: anon cannot list customers; anon cannot list requests without a token; anon can read exactly one request by token; anon can stamp `clicked_at` once but cannot change `token`, `sent_at`, or `customer_id`; authenticated has full access.

Check `current_user` as the primary role condition — `auth.role()` is null outside API calls and will silently no-op your guard. This exact bug shipped undetected on a previous project.

## Product spec

### Owner dashboard (`/`, auth required)

**"Ask now" queue** — the default view and the point of the product. Customers with a completed job who have not been asked, or who were last asked more than `cooldownDays` ago. Each row shows name, job, completion date, and two buttons: **WhatsApp** and **Email**.

- **WhatsApp** opens `wa.me/<number>` pre-filled with a message from the configured template, including the tracked review link. The owner sends it from their own number — no messaging cost.
- **Email** calls a Netlify Function that sends a branded request via Resend.

Either action creates a `reviews_requests` row and stamps `sent_at`.

**Cooldown guard:** never surface a customer who has been asked within `cooldownDays` (config, default 90). Nagging customers for reviews damages the client's relationship with them — this guard protects the client from themselves.

**Customers tab** — add/edit customers, CSV import (a new client will arrive with a contact list, not a database; make the import forgiving about column names).

**Jobs tab** — log a completed job against a customer. Minimal: customer, description, completion date.

**History tab** — every request sent: who, when, channel, whether the link was opened.

**Header stats** — requests sent in last 30 days, link-open rate. Nothing about review counts (see honesty note).

### Public redirect page (`/r/:token`)

1. Customer opens the link
2. Stamps `clicked_at` (once — subsequent opens are no-ops)
3. Shows a brief client-branded page: logo, one line of thanks, and a prominent button to the review page
4. Optionally auto-redirects after ~2 seconds, with a manual button as fallback for anyone who doesn't want to wait

Keep it near-instant on mobile. Every second of friction loses reviews.

### Message templates

In `companyConfig.js`, with placeholders: `{customerName}`, `{businessName}`, `{jobDescription}`, `{reviewLink}`. Ship 2–3 sensible defaults, short and human — not corporate. The client can edit them.

```js
reviewUrl: "",        // the client's Google review link
cooldownDays: 90,
templates: {
  whatsapp: [],       // array of variants
  email: { subject: "", body: "" },
}
```

Rotating between template variants keeps repeated sends from looking robotic.

### Auth
Supabase Auth, email + password, no public signup. Owner created manually in the dashboard. Document in README.

## Build order

1. Schema + RLS + `verify-rls.sql`
2. Auth + dashboard shell + customers list/add/edit
3. CSV import for customers
4. Jobs: log a completed job against a customer
5. "Ask now" queue with cooldown logic
6. Link generation + wa.me deep links + template rendering
7. Public redirect page + click stamping
8. Email channel via Netlify Function + Resend
9. History tab + header stats

## Definition of done

- `verify-rls.sql` returns PASS on every row
- The wa.me link opens with correct pre-filled text and a working tracked link
- Opening the tracked link stamps `clicked_at` once and redirects to the correct Google URL
- Cooldown correctly suppresses recently-asked customers
- CSV import handles a messy real file without silently dropping rows
- No UI anywhere implies a review was left

## What NOT to do

- **No review gating.** See the section above.
- No paid SMS/WhatsApp API — `wa.me` links and Resend email only.
- No cron or scheduled sending in v1 — flag as v2.
- No fake review-count metrics.
- Don't deploy, and don't claim something is live.
