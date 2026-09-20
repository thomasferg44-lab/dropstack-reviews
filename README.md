# DropStack Review Request Engine

Makes it effortless for a service business to ask every finished customer for a Google review, and to know who's already been asked.

Part of the DropStack service-business package: Mini-site, Lead Capture, Review Engine, Invoice Chaser. Sold together as one offer — build fee plus monthly. Each tool is its own repo and its own deploy.

## Stack

React + Vite, Tailwind CSS, Supabase (Postgres + Auth), Resend via Netlify Functions, Netlify.

Secrets live in `.env` (copy from `.env.example`). Never commit it.

## Local setup

1. `npm install`
2. Create a Supabase project (or use the shared `dropstack-dev` project during the build phase)
3. Paste `supabase/schema.sql` into the Supabase SQL editor and run it
4. Run `supabase/verify-rls.sql` — every row must return PASS
5. Create your owner login: Supabase dashboard → Authentication → Users → Add user
6. `cp .env.example .env` and fill in the values
7. Put the client's Google review URL into `companyConfig.js` as `reviewUrl`
8. `npm run dev`

## White-labelling for a client

All client-specific values live in `companyConfig.js`. A new client deploy is: fork/copy this repo, swap `companyConfig.js`, create a fresh Supabase project and run `schema.sql`, connect a new Netlify site, point the domain. No code changes.

## Tests

`npm test` runs 68 offline checks with Node's built-in runner. No test
dependency, nothing sent, nothing written to a database.

| Suite | Covers |
|---|---|
| `eligibility.test.js` | who gets asked, cooldown boundary, repeat-ask guard |
| `templates.test.js` | placeholder rendering, variant rotation, wa.me links |
| `email.test.js` | subject/body rendering, HTML escaping, refusal cases |
| `send-review-request.test.mjs` | the function's auth and anti-relay behaviour |
| `redirectLogic.test.js` | token parsing, redirect target validation |
| `stats.test.js` | the 30-day window and the open-rate edge cases |

The RLS script is verified separately, in Supabase. See below.

## The public redirect page (`/r/:token`)

This page is its own Vite entry (`r.html`), not a route inside the dashboard, and
it uses neither React nor supabase-js. A customer opening a review link downloads
about 5KB rather than the dashboard's ~230KB. The spec is explicit that every
second of friction here costs reviews, and this page's whole job is one `fetch`
and one redirect.

It stamps `clicked_at` through the public RPC, shows a client-branded thank-you,
and redirects after two seconds with a button for anyone who does not want to
wait. The redirect never waits on the tracking call: if Supabase is slow or the
keys are missing, the customer still reaches the review page.

`netlify.toml` rewrites `/r/*` to `r.html` ahead of the dashboard's catch-all, and
`vite.config.js` does the same in dev so `npm run dev` behaves like production.

If you would rather this page matched the rest of the codebase in React and
Tailwind, say so — it is a small file and the tradeoff is purely size versus
stylistic consistency.

## The email channel

`netlify/functions/send-review-request.mjs` sends through Resend. Two properties
keep it from becoming an open relay, and both are covered by tests:

1. **The caller's own Supabase token does the database read.** The function does
   not decode or trust the token; it uses it against PostgREST, so RLS decides.
   An anon or forged token reads nothing and gets a 401.
2. **The recipient never comes from the request body.** The browser sends only a
   request id. The address, name and job are read from the database. Without
   this, a signed-in caller could still mail strangers from the client's domain.

### Setting it up

1. Add the client's sending domain in Resend and verify its DNS records.
2. Put the verified sender into `fromEmail` in `companyConfig.js`.
3. Put `RESEND_API_KEY` into Netlify's environment variables. **Never prefix it
   with `VITE_`** — that would inline the secret into the browser bundle.
4. Leave `DEV_BLOCK_REAL_SENDS=true` everywhere except the production Netlify
   environment. While it is true, the function logs what it would have sent and
   returns without calling Resend, and the dashboard says so plainly.

A failed send rolls the request row back, so a customer is never hidden behind
the cooldown because of an email that did not go out.

## What the numbers mean

The header and the History tab report requests sent and how many of those links
were opened. That is the whole truth available: Google publishes no signal about
whether a review was actually left, so there is no review count, no "reviewed"
state and no completion tick anywhere in this app. A link open is labelled
exactly that. Please keep it that way.

## Sending a request

Clicking **WhatsApp** on a queue row creates a `reviews_requests` row, stamps
`sent_at`, and takes the token the database generated to build the tracked link
`/r/<token>`. The rendered message and a real `Open WhatsApp` anchor then appear
for review before anything goes out.

It is an anchor, not a scripted `window.open`, because popup blockers silently
discard windows opened after an `await` — the owner would click and see nothing.

Because a click marks the customer as asked, the panel carries an **Undo** that
deletes the request row. Without it, opening WhatsApp and then changing your mind
would hide that customer for the whole cooldown period.

Message variants rotate by how many requests have been sent, so consecutive sends
do not read identically.

## Who the queue surfaces

A customer appears in "Ask now" when all of these hold:

1. They have a job completed on or before today.
2. That job is newer than the last request sent to them, or they have never been asked.
3. Their last request was sent at least `cooldownDays` ago, or never.

Rule 2 is stricter than a literal reading of the spec, which would resurface a
customer every cooldown period even with no new work. That is the nagging the
cooldown guard exists to prevent, so a *new completed job* is what re-qualifies
someone. Change it in `src/features/queue/eligibility.js` if you disagree; the
tests pin the current behaviour.

Nobody is dropped silently. Customers held back are listed under "Show hidden
customers" with the reason, and anyone with a finished job but no phone or email
is called out separately so the gap is visible.

## Owner login

There is no signup page. Create the single owner account in the Supabase dashboard
(Authentication → Users → Add user, email + password, confirm the email) and sign in
with it at `/`. Anyone without an account sees only the login form and, under RLS,
can read nothing.

## How the public link is locked down (read before changing schema.sql)

The anon role has **zero grants** on every `reviews_*` table and no RLS policies.
The public redirect page (`/r/:token`, Stage 7) calls one thing: the RPC
`reviews_open_link(token)`. It is `SECURITY DEFINER` (runs as the table owner),
stamps `clicked_at` with server time on the first open only, and returns a bare
boolean saying whether the token exists. Nothing about the customer, job or
request is returned. The token column defaults to 24 URL-safe random characters.

A defence-in-depth trigger (`reviews_guard_anon_click`) stays on the table: it does
not fire in normal operation, but if a grant to anon is ever added by mistake it still
limits anon to moving `clicked_at` from NULL to now(), once. It checks `current_user`,
not `auth.role()` — the latter is NULL outside an API request and would make
`verify-rls.sql` pass against a broken guard.

`supabase/verify-rls.sql` has 15 checks and prints one PASS/FAIL row each. It creates
and removes its own test rows and is safe to re-run.

## Build status

**v1 complete.** All nine steps of the build order are done. Nothing from the
"What NOT to do" list was built: no review gating, no paid messaging API, no
cron, no invented review metrics.

Not deployed. That is Thomas's step. See `CLAUDE.md` for the full spec, build order and definition of done. See `PROMPT.md` for the Claude Code starting prompt.

## Scope discipline

`CLAUDE.md` has a "What NOT to do" section. It's there because scope creep is what kills solo builds. Anything listed there is deliberately v2 or later — including anything needing paid SMS/WhatsApp messaging or scheduled cron jobs, neither of which is in the budget yet.
