# Review Engine: compete pass report (design spec §6 format)

Branch `compete/reviews-upgrades`, cut from `v1-review-engine` at `238cdc7`. Built and tested locally, then deployed on Nov 8 2026 with Tom's approval. See **§12 Deploy**.
The schema patch was applied to dropstack-dev and verified there, nothing else in the live database was changed, and nothing was sent to a real person.

The test for every decision was the one in Tom's Nov 5 addendum: does this make a real SA service business say yes faster?

---

## 1. Baseline (Gate 0)

| Check | Result |
|---|---|
| `npm test` at 238cdc7 | **68/68 pass** |
| `npm run build` at 238cdc7 | **green** |
| v1 flow on the v1 UI (`tools/gates/baseline.mjs`, local test backend copied in, 390px + desktop) | **4/4 PASS at both widths**: sign in; add customer + log a job; customer appears in Ask now; landing loads |
| What the baseline showed | With `reviewUrl` empty (the live config), v1 **disables every send** and the landing says "This link isn't available right now" with no fallback. The landing's logo was `public/logo.svg`, a blue box with the word LOGO in it. |

Baseline was green, so the work went ahead.

## 2. What changed

**Schema (file only, BLOCKED-BY-PATCH for live):** `supabase/patches/2026-11-05-compete-upgrades.sql`, folded into `schema.sql`.
It is additive, idempotent and runs as one transaction. It adds:
- `is_demo` on every table
- `google_clicked_at`, plus `feedback_rating`, `feedback_comment` and `feedback_at`
- `followed_up_at` and `follow_up_channel`, guarded by `reviews_guard_follow_up()`. The guard refuses a second follow-up, or any attempt to move or clear the first, for **every role including postgres**
- a `reviews_showcase` table
- three anon doors, all SECURITY DEFINER and token-scoped (or published-only), each returning a boolean or the published rows only: `reviews_submit_feedback`, `reviews_google_click`, `reviews_showcase_list`
- owner RPCs `reviews_load_demo` and `reviews_remove_demo`

The anon trigger guard now compares every column except `clicked_at`, so columns added later are covered automatically. `verify-rls.sql` check 14 has the three new doors on its allowlist. There is a new `verify-compete-upgrades.sql` with 14 checks.

**Local SQL harness** (`supabase/local-test`, PGlite with pgcrypto): **all PASS**.
- Fresh `schema.sql`: verify-rls 15/15, compete 14/14.
- Re-pasted: same result.
- v1 schema with existing rows → patch ×2: 15/15 and 14/14, existing rows untouched, no responses or follow-ups invented.

The app checks which schema it is talking to. Before the patch is applied, the core loop works and the patch-only features show a "waiting for the database update" card. Deploying before patching is therefore safe.

**Functional upgrades (BUILD_BRIEF §B), each with its proof:**

| # | Upgrade | Where | Proof |
|---|---|---|---|
| B1 | WhatsApp-first composer: first name, the actual job, and when it was done ("yesterday", "on Tuesday"). Editable, keeps the tracked link. Email is the second channel. Channel logged on the row. | `src/lib/compose.js`, `src/components/ComposerSheet.jsx`, `src/lib/db.js` | `test/compose.test.js`, `test/db-mock.test.js` (channel logging), Gate 2 B1/B7 |
| B2 | Job-done trigger: saving a finished job, or tapping **Done** on a booked one, opens the composer pre-addressed with WhatsApp selected. The send is still the owner's tap. | `JobsPage`, `JobFormSheet`, `TodayPage` | Gate 2 B1 |
| B3 | One follow-up: a Follow up queue (no response after `followUp.afterDays`, default 5; none after `maxDays`, 30). Limited to one per request by the DB guard, the data layer and the email function (409). WhatsApp follow-up is manual. Email follow-up uses its own template ("we won't ask again"). | `src/lib/followup.js`, patch, `send-review-request.mjs` | `test/followup.test.js`, `test/db-mock.test.js`, function tests, SQL checks 2–4, Gate 2 B8/B9 |
| B4 | Compliant feedback step on the landing (details in §3a) | `src/public/*` | `test/landing.test.js` (REVIEW GATING GUARD tests), Gate 2 B3 |
| B5 | Showcase strip plus an ES5 embed (same pattern as Lead Capture's `embed.js`). Hand-entered reviews only; demo samples are never public. README section written. | `public/showcase.js`, `showcase.html`, Setup | `test/health-showcase.test.js`, SQL check 9, Gate 2 B10 (embedded on a plain cross-origin page) |
| B6 | reviewUrl guardrails (details below) | `src/lib/reviewUrl.js`, `Bits.jsx`, `render.js` | Gate 2 A2/A5/A6, `test/landing.test.js` |
| B7 | Tracking: sent (channel, time), link opened, feedback submitted, Google tapped (beacon with keepalive before Google opens). Response rate is computed from real rows. | `responses.js`, landing | `test/onboarding-responses.test.js`, Gate 2 B2–B6 |
| B8 | Demo mode (details below) | `src/lib/demoData.js`, `DemoSheet` | `test/demoData.test.js`, `test/db-mock.test.js`, SQL check 12, Gate 2 A3/A4/A8 |

**B6 detail.** When `reviewUrl` is empty:
- the dashboard shows "Customer links currently lead nowhere — set your Google review link"
- the shell status line and the Setup badge turn red
- the landing shows a designed unavailable state, with the WhatsApp fallback only if a real number is configured

Sends to **real** customers are held back, with the reason shown, so nobody's one ask is wasted. Sends to **demo** customers are allowed, so the live demo still works end to end. The URL was not invented.

**B8 detail.** Three trades (plumber, landscaper and electrician), each with 12 SA customers:
- every state is represented: ask, follow-up due, followed up, opened, feedback (including an unhappy one), went to Google, and booked
- numbers use the `+27 000 000 1xx/2xx/3xx` placeholder pattern; emails are `@example.com`
- a DEMO badge shows while demo data is present, and the hero strip says "Includes demo data"
- load and remove are one tap each, and remove deletes exactly the `is_demo` rows

**Addenda:**

- **Onboarding checklist:** confirm details → demo or first job → first request sent. It stays until complete and can be dismissed after. Every empty state has one primary action. The layout is one-handed (bottom tab bar, 44px+ targets).
- **Health:** `GET /api/health` (`netlify/functions/health.mjs`) returns booleans only. A status line in the shell uses it, plus a Status section in Setup. No external pinging is scheduled.
- **Pre-composed messages and reply drafts (deterministic, no AI call):** the Feedback view has reply drafts by band:
  - 5★ warm
  - 4★ thanks
  - ≤3★ service recovery, signed with `ownerName`

  Each draft has one tap to copy and one tap to open WhatsApp. A test checks that a low-score draft never discourages a review. The seams for an AI writer later are `composeMessage()` and `replyDraft()`.
- **Suite:**
  - The sign-in is the same screen and component as Quote & Invoice and Invoice Chaser; only the subtitle line names the tool.
  - `/customers?phone=+27…` opens that customer's record (the suite joins on phone).
  - Shared auth: this repo's `.env`, Lead Capture's and Quote's all reference the same `dropstack-dev` project ref (counted, not printed). Chaser has no local `.env`. Supabase Auth is per project, so the same login should work in every tool on dropstack-dev. **I did not verify this against the live project**: no live calls were allowed.
- **SA reality:**
  - The landing is one HTML document (≈3 KB gzipped for the HTML, 9 KB total cold) with brand colours inlined.
  - The customer's words survive a dropped connection: they are saved on the phone and sent when the connection returns (Gate 2 B4).
  - There are no sequences beyond the one follow-up.

**Reskin (BUILD_BRIEF §A):**
- The console design system and shell are shared with Chaser (charcoal glass sidebar with aura pill and live badges, bottom tab bar on phones, sheets, toasts).
- Review Engine aura is orange/yellow and is confined to the header band, hero strip and empty states.
- Hero strip: requests sent, response rate, and the average **private** score (labelled as such).
- There are no emojis, and no "Powered by Netlify" (Gate 2 checks every screen).

**Files:** see `git log 238cdc7..HEAD --stat`. The v1 UI (`Layout`, `LoginForm`, `ui.jsx`, the `features/*` components and hooks) was replaced. Its tested logic was kept: `eligibility.js`, `stats.js`, `importMapping.js`, `csv.js`, `templates.js`, `email.js`, `format.js`.

### 3a. The feedback step, and why it is compliant

The Google button:
- is rendered at build time from config alone
- is placed **before** the optional "How was your experience?" scale
- is identical for every rating
- needs no answer to be used

A rating of 3 or below **adds** "Message <business> on WhatsApp" underneath. That line appears only if a real number is in config; it never replaces anything. Tests assert the button renders, unchanged and first, for every rating including 1 (`test/landing.test.js`). Gate 2 B3 checks the button's outerHTML before and after tapping 1.

## 4. Gate 1 (unit/regression)

`npm test`: **127/127 pass** (baseline 68; all 68 original tests still pass). The new tests cover every item the brief named:
- **follow-up once:** `followup.test.js`, `db-mock.test.js`, function tests
- **Google path never hidden at the lowest rating:** `landing.test.js`
- **channel logging:** `db-mock.test.js`
- **demo seed marking:** `demoData.test.js`, `db-mock.test.js`

Further tests cover health (no secrets echoed), compose, reply drafts, checklist and stats. Build is green, and the production bundle contains no test-backend code (checked by grep).

## 5. Gate 2 (scripted flows, 390px and 1280px, test data only)

`tools/gates/gate2.mjs` runs against mock-backend builds. Every non-local request is blocked, Resend is a recorder, and the real Netlify functions run in-process.

| Flow | 390 | Desktop |
|---|---|---|
| A1 wrong password → inline error | PASS | PASS |
| A2 empty Today: loud reviewUrl warning, checklist 0/3, status line | PASS | PASS |
| A3 **timed first value**: sign in → checklist → confirm → demo → ask first customer → WhatsApp opened | PASS **7.4 s** | PASS **3.7 s** |
| A4 populated Today: DEMO badge, "Includes demo data", 2 follow-ups | PASS | PASS |
| A5 landing with empty reviewUrl: designed unavailable state, no dead link, no fake number | PASS | PASS |
| A6 real customer + empty reviewUrl: send held back with the reason | PASS | PASS |
| A7 messy CSV: 6 imported (2 with notes), 1 duplicate skipped with its reason, the blank row ignored | PASS | PASS |
| A8 remove demo: exactly the demo rows gone, real customer kept | PASS | PASS |
| B1 job done → composer, WhatsApp, "Hi Thandi, … DB board upgrade today … /r/<token>" | PASS | PASS |
| B2 customer opens link: branded landing, Google button = config URL, open stamped | PASS | PASS |
| B3 lowest rating: Google button byte-identical and visible, WhatsApp line added | PASS | PASS |
| B4 connection drops mid-feedback: kept, restored after reload, sent when back online | PASS | PASS |
| B5 Google tap beacons before opening | PASS | PASS |
| B6 owner sees "Went to Google", the comment, a recovery draft signed "Musa, Kloofnek Electrical"; hero 1 sent / 100% / 1.0 | PASS | PASS |
| B7 email request through the function, logged as email | PASS | PASS |
| B8 WhatsApp follow-up, leaves the queue | PASS | PASS |
| B9 email follow-up sends "One last thing from Kloofnek Electrical"; a second attempt gets **409** | PASS | PASS |
| B10 showcase: demo samples not public; a featured review appears in the widget on a plain page | PASS | PASS |
| B11 Gate 3 (below) | PASS | PASS |
| B12 `?phone=` lookup lands on the record | PASS | PASS |

**Totals:** 40/40 checks, 0 page errors, 0 blocked outbound requests.

The first-value times are scripted, with 60 ms of simulated latency per call. A human will be slower, but the path is five taps.

**Bugs Gate 2 found, now fixed:**
- A deep link that redirects on first render fired before the router's listener existed.
- A job marked finished "today" was stored at noon, so before noon it counted as future-dated and dropped out of Ask now.

## 6. Gate 3 (config swap)

Swapping in `configs/demo-config-2.js` (Kloofnek Electrical, `#0F7B5F`, monogram KE, WhatsApp `27000000999`, test review URL) rebrands:
- the dashboard (name, monogram, primary buttons in the client colour)
- the landing (name, monogram, Google button colour and URL)
- the WhatsApp prefill
- the email subjects
- the reply-draft signature
- the widget title and colour

No "Quillbrook" remains on any screen. **PASS** at both widths.

One harness note: the email function must be loaded from the swapped deploy's own source, as a real per-client deploy would be. The first run loaded it from the repo and caught the old name in a follow-up subject.

## 7. Review pack (Gate 4)

`review-pack/index.html` holds 64 screenshots: before (v1) and after, 390px and desktop. It covers:
- sign-in and its error state
- Today: empty, populated, and the follow-up queue
- the request composer (WhatsApp, email, follow-up, blocked) and its success state
- landing: happy, unhappy, offline, and unavailable
- Activity and Feedback
- Setup
- CSV import preview and result
- the widget embedded on a plain page

Raw results are in `review-pack/gate2.json` and `gate5-summary.json`.

## 8. Gate 5 (performance)

Lighthouse 12.8 mobile, local gzip server, 3 runs, lowest kept:

| Page | Perf (lowest) | A11y | LCP | Weight |
|---|---|---|---|---|
| Customer landing `/r/:token` | **100** (100/100/100) | 100 | 636–915 ms; LCP element is the text paragraph, not a spinner | 9 KB cold |
| **Landing, Fast 3G** (devtools: 562.5 ms RTT, 1.6 Mbps, 4× CPU) | – | – | **705–719 ms** (bar is 2.5 s) | 3 KB |
| Dashboard Today (populated) | **99** (99/100/100) | 100 | 1556 ms cold | 112 KB cold |

Runs 2–3 of each page hit a warm HTTP cache (1–3 KB). The cold first run is the honest number for weight.

The production dashboard bundle is 543 KB (156 KB gz), up from 482 KB, almost all React and supabase-js. The customer never downloads it.

No dedicated 44px or contrast measuring script was run this pass. Accessibility evidence is Lighthouse a11y at 100, plus the shared components' 44px minimums and labelled inputs.

---

## 9. Flagged: behaviour changes and Tom's calls

1. **Auto-redirect removed.** v1 forwarded the customer to Google after 2 s. That would cut the feedback step, so the Google button is now one tap, first on the page.
2. **Real sends wait for `reviewUrl`.** v1 disabled all sends; now demo sends are allowed. **Tom's call:** set the demo's `reviewUrl` and `whatsappNumber`. The gap audit suggested DropStack's own GBP link and the Mini-site demo already uses DropStack's number. I left both empty, per the brief, rather than point an invented business's buttons at DropStack without your say-so.
3. **Light app vs CLAUDE.md's dark dashboard tokens.** I followed design spec v2 (light, console system), which the brief names as law. CLAUDE.md's "Design tokens" section is now stale and wants updating.
4. **Brief vs CLAUDE.md honesty rule.** The brief's demo state "reviewed" is built as **"Went to Google"** (a tap). The hero's "average rating" is the **private** feedback score, labelled "Private score". Neither implies a review was left.
5. **Feedback step:** compliant as built (§3a). The extra WhatsApp line appears only for scores of 3 or below. Worth Tom confirming he is comfortable with that against Google's wording; the Google path is unchanged for everyone.
6. **Placeholder logo deleted.** `logoUrl` is now `""`, so the monogram shows. A real client logo goes in config.
7. **Email follow-up race.** Two simultaneous sends could both email, though the database records only one follow-up. This is negligible for one owner, and documented.
8. **Cut under the decision lens, and why:**
   - Rand amounts: n/a, the tool holds no money.
   - Multi-platform (Facebook/Yelp) and multi-location: not our buyer.
   - Google API monitoring and reply-from-dashboard: needs the API approval programme, flagged for later.
   - Staff leaderboards: banned quota schemes.
   - Scheduled or automated sending: doctrine, plus CLAUDE.md v1.

## 10. Not done / blocked

- ~~BLOCKED-BY-PATCH~~ Done on Nov 8: the patch is applied and both verify scripts pass on dropstack-dev (§12).
- ~~Push, deploy~~ Done on Nov 8 (§12). Gate 6 (Ziggy's live signed-in re-check) is still open.
- **The demo `reviewUrl` is still EMPTY on live** (§12).
- Mini-site wiring of the embed: snippet and README are ready, but the change goes in the Mini-site repo.
- Shared-login verification against live Auth: not possible without live calls.

## 11. Where this still loses to Birdeye / NiceJob

Honestly, on breadth and on automation:
- **Birdeye** watches Google and every other site in real time, replies from the dashboard, and handles many locations, staff and sentiment analysis. We see nothing on Google itself: we cannot tell whether a review was written, cannot show the business's rating, and cannot reply there.
- **NiceJob** auto-sends multi-touch SMS and email sequences, plugs into Jobber, ServiceM8 and QuickBooks so jobs flow in without typing, and has polished social proof widgets that pull reviews automatically. Our showcase is hand-entered, our jobs are logged by hand or CSV, and every WhatsApp send is a deliberate tap.

Where we win is narrower but real: the WhatsApp-first, personal, one-tap ask in the channel our customers actually answer, a compliant landing that loads in under a second on Fast 3G, a done-for-you setup, and a tenth of the price. If the job → WhatsApp → Google loop is what an SA tradesperson needs, we compete. If they need to *see and manage* their reputation across platforms, we do not yet.


## 12. Deploy (Nov 8 2026, approved by Tom)

**Schema patch on dropstack-dev (`idazmyjfroigagmjtekm`).**
- Before the patch, live had the v1 schema: 3 `reviews_` tables, with 1 customer, 1 job and 1 request.
- Applied `supabase/patches/2026-11-05-compete-upgrades.sql` as one transaction via `supabase db query --linked`. It returned no errors.
- `verify-rls.sql` passed 15/15 and `verify-compete-upgrades.sql` passed 14/14 on live.
- Both scripts delete their own fixtures. After they ran, the counts were back to 1 customer, 1 job and 1 request, with 0 showcase rows and 0 demo rows.
- Only `reviews_` objects were touched, and no other tool's tables.

**Push.**
- `compete/reviews-upgrades` was pushed to origin at **`d90c6ae7c5971d1959b6f7be8e771dbd142b9690`**. It contains the build; this report update is a docs-only commit on top.
- The deploy went out the same way as before. Netlify's production branch for this site is `v1-review-engine`, so `origin/v1-review-engine` was fast-forwarded `238cdc7..d90c6ae`. `main` was not touched.

**Deploy proof.**
- Netlify deploy **`6af12798cb41695c5a61ca1d`**, site `dropstack-reviews`.
- Context `production`, commit `d90c6ae`, state `ready`, published at `2026-11-09T01:53:45Z` (UTC).
- Deploy URL: https://v1-review-engine--dropstack-reviews.netlify.app. Live at https://reviews.dropstack.co.
- Admin: https://app.netlify.com/projects/dropstack-reviews/deploys/6af12798cb41695c5a61ca1d

**Live verification.** This was read-only, with no sign-in and no writes, run at 390px and 1280px.
- `GET /api/health` returned 200 with database reachable (381 ms) and config complete. `reviewUrl`: false. `whatsappNumber`: false. `fromEmail`: false. `resendKey`: false.
- The served bundle `/assets/main-Cmd3waVK.js` is the new build: it contains the WhatsApp-first composer, Follow up, "Load demo" and "Remove demo data", "Went to Google", and `is_demo` / `followed_up_at`. The mock backend is absent (`dropstack-mock-db`: false).
- The sign-in page shows the new subtitle "Sign in to ask for reviews". There were no page errors at either width.
- `/r/<dummy token>` shows the designed "Our review page isn't ready yet" page for Quillbrook Plumbing. This is correct while `reviewUrl` is empty.
- `/showcase` is empty, which is correct with no published reviews. `/showcase.js` returned 200 as `application/javascript`.
- **Not verified live:** the signed-in flow (composer, loading demo data). I have no owner password, and loading demo data would write rows, which is outside "no live DB changes beyond the patch". Gate 6 should do it while signed in as the owner.

**FLAG: the demo `reviewUrl` is empty.**
- Left as-is per the task; no URL was invented.
- Until Tom sets it in `companyConfig.js`, every live customer link lands on the "isn't ready yet" page and real sends are held back.
- Demo customers can still be sent to once demo data is loaded.
- `whatsappNumber` and `fromEmail` are also empty.

**FLAG: real sends are switched on in Netlify.**
- Health reports `realSendsEnabled: true` because the production environment has `DEV_BLOCK_REAL_SENDS=false`. That was already set before this deploy and was not changed.
- No `RESEND_API_KEY` is set, so email cannot actually send.
- If Tom adds the key before the demo is ready, set `DEV_BLOCK_REAL_SENDS=true` first.
