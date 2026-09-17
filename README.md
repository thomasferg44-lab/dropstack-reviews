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

## Build status

**v1 in progress.** See `CLAUDE.md` for the full spec, build order and definition of done. See `PROMPT.md` for the Claude Code starting prompt.

## Scope discipline

`CLAUDE.md` has a "What NOT to do" section. It's there because scope creep is what kills solo builds. Anything listed there is deliberately v2 or later — including anything needing paid SMS/WhatsApp messaging or scheduled cron jobs, neither of which is in the budget yet.
