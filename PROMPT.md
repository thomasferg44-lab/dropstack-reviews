# Paste this into Claude Code

Open this folder in VS Code, start Claude Code, switch to Fable with `/model fable`, then paste everything below the line.

---

Read CLAUDE.md in this repo before doing anything else.

Build in stages per the "Build order" section of CLAUDE.md. Do not skip ahead to later stages.

**Before anything else:** read the section in CLAUDE.md titled "Review gating is prohibited" and confirm back to me that you have understood it. Do not build any flow where the destination depends on a predicted satisfaction answer, no matter how standard that pattern is in this product category. Google prohibits it and it can get my client's reviews stripped.

**Stage 1 only:** Scaffold the project (Vite + React + Tailwind + supabase-js), write `supabase/schema.sql` with the `reviews_*` tables and RLS policies as specified, and build the customers list view in the owner dashboard.

Also write `supabase/verify-rls.sql` printing PASS/FAIL per check — the required checks are listed in CLAUDE.md. Note the `auth.role()` vs `current_user` warning; that bug shipped undetected on a previous project of mine.

Before you write any code:
1. Confirm the review gating section, as above.
2. Confirm you have read the design tokens section and will use it exactly.
3. Propose the file structure you intend to create.

Then build Stage 1 only and stop. Show me what you've built before moving to Stage 2.

---

## Notes for you (Thomas) — not part of the prompt

**Test this first when Stage 1 comes back:** Generate a review request and open the wa.me link. The pre-filled text must be right and the tracked link must land on the correct Google review page. That's the whole product in one click.

**Rules that apply the whole way through:**
- Branch + PR. Never let it push to main.
- It does not deploy. You do.
- No real messages or emails sent during development — test data only.
- Review each stage before saying "continue to Stage 2". Redirecting after Stage 1 is cheap; after Stage 5 it isn't.
