// LOCAL TEST BACKEND: the public (anon) doors only, for the landing and the
// showcase strip in a VITE_MOCK_BACKEND=1 build. Never used in a real deploy:
// callers guard on import.meta.env.VITE_MOCK_BACKEND, which Vite replaces at
// build time, so a normal build drops this file entirely.
//
// Shares the dashboard mock's localStorage database (same origin), so a gate
// run can send a request in the dashboard, open /r/<token> as the customer,
// and see the result back in the dashboard. Mirrors supabase/schema.sql:
// each door takes a token, touches only that row, returns a boolean.
export const DB_KEY = "dropstack-mock-db-v1";

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const load = () => { try { return JSON.parse(get(DB_KEY) ?? "{}"); } catch { return {}; } };
const save = (db) => { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* ignore */ } };
const now = () => new Date().toISOString();
const okToken = (t) => typeof t === "string" && t.length >= 8 && t.length <= 128;

/** Same contract as the real call in redirect.js: "ok" | "invalid" | "offline" | "failed". */
export async function mockPublicRpc(fn, args = {}) {
  const ms = Number(get("dropstack-mock-latency") ?? 120);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  const fail = get("dropstack-mock-fail");
  if (fail === "all" || fail === "public") return navigator.onLine === false ? "offline" : "failed";
  if (fail === "offline") return "offline";
  if (fn === "reviews_showcase_list") {
    const rows = (load().reviews_showcase ?? []).filter((s) => s.published && !s.is_demo);
    return rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .slice(0, 12).map(({ author_name, rating, body, reviewed_on }) => ({ author_name, rating, body, reviewed_on }));
  }
  if (!okToken(args.p_token)) return "invalid";
  const db = load();
  const row = (db.reviews_requests ?? []).find((r) => r.token === args.p_token);
  if (!row) return "invalid";
  if (fn === "reviews_open_link") {
    row.clicked_at ??= now();
  } else if (fn === "reviews_google_click") {
    row.google_clicked_at ??= now();
    row.clicked_at ??= now();
  } else if (fn === "reviews_submit_feedback") {
    const r = Number(args.p_rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) return "invalid";
    const c = String(args.p_comment ?? "").trim().slice(0, 1000);
    row.feedback_rating = r;
    if (c) row.feedback_comment = c;
    row.feedback_at = now();
    row.clicked_at ??= now();
  } else {
    return "failed";
  }
  save(db);
  return "ok";
}
