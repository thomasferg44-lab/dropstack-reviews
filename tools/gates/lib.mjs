// Shared helpers for the gate scripts (design spec §6). Not part of the app.
// playwright-core is borrowed from another local project (not a dependency of
// this app). Point PLAYWRIGHT_FROM at any package.json whose node_modules has it.
import { createRequire } from "node:module";
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? `${process.env.HOME}/dropstack-outreachv2/package.json`);
export const { chromium } = require("playwright-core");

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 };
export const DB_KEY = "dropstack-mock-db-v1";

// ---- the real Netlify Functions, run in this Node process -----------------
// send-review-request and health are answered by the repo's own handlers.
// Their outbound calls are stubbed: the PostgREST read returns the row from
// the browser's local test database (so RLS-by-token is simulated by "a mock
// session token is required"), and Resend is a recorder. Nothing leaves this
// machine.
export const outbound = { resend: [], lookups: 0 };
let currentDb = () => ({});
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("http://auth-stub.local/rest/v1/reviews_requests")) {
    outbound.lookups++;
    if ((init.headers?.Authorization ?? "") !== "Bearer mock") return new Response(JSON.stringify({ message: "JWT invalid" }), { status: 401 });
    const id = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1];
    const db = await currentDb();
    const r = (db.reviews_requests ?? []).find((x) => x.id === id);
    if (!r) return new Response("[]", { status: 200 });
    const customer = (db.reviews_customers ?? []).find((c) => c.id === r.customer_id) ?? null;
    const job = (db.reviews_jobs ?? []).find((j) => j.id === r.job_id) ?? null;
    return new Response(JSON.stringify([{ ...r, customer, job }]), { status: 200 });
  }
  if (u.startsWith("http://auth-stub.local/rest/v1/")) return new Response(JSON.stringify({ code: "42501" }), { status: 401 });
  if (u.startsWith("https://api.resend.com/")) {
    outbound.resend.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "re_test_" + outbound.resend.length }), { status: 200 });
  }
  if (u.startsWith("http://127.0.0.1") || u.startsWith("http://localhost")) return realFetch(url, init);
  throw new Error("gate harness blocked outbound fetch to " + u);
};
process.env.VITE_SUPABASE_URL = "http://auth-stub.local";
process.env.VITE_SUPABASE_ANON_KEY = "local-anon";
process.env.DEV_BLOCK_REAL_SENDS = "false"; // Resend is the recorder above
process.env.RESEND_API_KEY = "re_local_recorder";

const FUNCTIONS = {};
export async function useFunctions(repo) {
  FUNCTIONS["send-review-request"] = (await import(`${repo}/netlify/functions/send-review-request.mjs`)).default;
  try { FUNCTIONS.health = (await import(`${repo}/netlify/functions/health.mjs`)).default; } catch { /* baseline has none */ }
}

// Block every request that isn't the local server: proves no live DB/network.
export async function newContext(browser, profile, base) {
  const ctx = await browser.newContext({ ...profile, timezoneId: "Africa/Johannesburg", locale: "en-ZA", permissions: ["clipboard-read", "clipboard-write"] });
  const blocked = [];
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const u = req.url();
    const fn = /\/\.netlify\/functions\/([\w-]+)|\/api\/(health)$/.exec(new URL(u).pathname);
    if (u.startsWith(base) && fn) {
      const name = fn[1] ?? fn[2];
      if (!FUNCTIONS[name]) return route.fulfill({ status: 404, body: "not found" });
      const page = req.frame().page();
      currentDb = async () => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), DB_KEY)) ?? "{}");
      const res = await FUNCTIONS[name](new Request(u, { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined }));
      return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
    }
    if (u.startsWith(base) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    blocked.push(u);
    return route.abort();
  });
  // wa.me links are captured, never followed.
  await ctx.addInitScript(() => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
    document.addEventListener("click", (e) => {
      const a = e.target.closest?.("a[href^='https://wa.me'], a[href^='https://g.page'], a[href*='google']");
      if (a) { window.__opened.push(a.href); e.preventDefault(); }
    }, true);
  });
  ctx.blocked = blocked;
  return ctx;
}

export async function dumpDb(page) { return JSON.parse((await page.evaluate((k) => localStorage.getItem(k), DB_KEY)) ?? "{}"); }

export function recorder() {
  const rows = [];
  return {
    rows,
    async check(name, fn) {
      try { const d = await fn(); rows.push({ name, ok: true, detail: d ?? "" }); console.log(`PASS  ${name}${d ? "  — " + d : ""}`); }
      catch (e) { rows.push({ name, ok: false, detail: String(e.message).split("\n")[0] }); console.log(`FAIL  ${name}  — ${String(e.message).split("\n")[0]}`); }
    },
  };
}
export const clean = (s) => String(s).replace(/[  ]/g, " ");
export function expect(cond, msg) { if (!cond) throw new Error(msg); }
