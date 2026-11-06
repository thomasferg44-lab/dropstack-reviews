import test from "node:test";
import assert from "node:assert/strict";
import { landingModel, googleButton, RATINGS, unavailableModel, feedbackRequest, googleClickRequest, readDraft, writeDraft, RECOVERY_AT_OR_BELOW } from "../src/public/landing.js";
import { renderLanding, fillTemplate, landingTitle } from "../src/public/render.js";
import { readFileSync } from "node:fs";

const CONFIG = { businessName: "Quillbrook Plumbing", reviewUrl: "https://g.page/r/test-only/review", whatsappNumber: "27000000999", primaryColor: "#1D4ED8" };

test("REVIEW GATING GUARD: the Google button is identical for every rating, including the lowest", () => {
  const base = landingModel({ config: CONFIG }).google;
  assert.deepEqual(base, { href: CONFIG.reviewUrl, label: "Review us on Google" });
  for (const rating of [null, ...RATINGS.map((r) => r.value)]) {
    assert.deepEqual(landingModel({ config: CONFIG, rating }).google, base, `rating ${rating}`);
  }
});

test("REVIEW GATING GUARD: the rendered landing contains the Google link for the lowest rating, before the question", () => {
  for (const rating of [null, 1, 2, 3, 4, 5]) {
    const html = renderLanding(CONFIG, { rating });
    const g = html.indexOf(`href="${CONFIG.reviewUrl}"`);
    assert.ok(g > -1, `Google link missing for rating ${rating}`);
    assert.ok(g < html.indexOf("How was your experience"), "Google button must come before the optional question");
    assert.ok(!/hidden[^>]*data-google|data-google[^>]*hidden/.test(html), "Google button must not be hidden");
  }
});

test("a low rating ADDS a WhatsApp line to the owner; it never replaces the Google button", () => {
  const low = landingModel({ config: CONFIG, rating: 1 });
  assert.ok(low.google);
  assert.match(low.recovery.href, /^https:\/\/wa\.me\/27000000999\?text=/);
  const html = renderLanding(CONFIG, { rating: 1 });
  assert.ok(html.includes(`href="${CONFIG.reviewUrl}"`) && html.includes("https://wa.me/27000000999"));
  assert.equal(landingModel({ config: CONFIG, rating: RECOVERY_AT_OR_BELOW + 1 }).recovery, null);
});

test("with no WhatsApp number configured, no fake number is ever shown", () => {
  const m = landingModel({ config: { ...CONFIG, whatsappNumber: "" }, rating: 1 });
  assert.equal(m.recovery, null);
  assert.ok(m.google);
  assert.equal(unavailableModel({ businessName: "X", whatsappNumber: "" }).whatsapp, null);
});

test("empty reviewUrl: designed unavailable state with the business's WhatsApp, never a dead link", () => {
  const cfg = { ...CONFIG, reviewUrl: "" };
  assert.equal(googleButton(""), null);
  assert.equal(landingModel({ config: cfg }).unavailable, true);
  const html = renderLanding(cfg, {});
  assert.match(html, /isn.t ready yet|being set up/i);
  assert.ok(html.includes("https://wa.me/27000000999"));
  assert.ok(!html.includes('href="#"') && !html.includes('href=""'));
});

test("non-https review links are refused rather than linked", () => {
  assert.equal(googleButton("http://g.page/x"), null);
  assert.equal(googleButton("javascript:alert(1)"), null);
});

test("the landing never shows a placeholder box or the word LOGO; no logo means a monogram", () => {
  const html = renderLanding({ ...CONFIG, logoUrl: "" }, {});
  assert.ok(!/\bLOGO\b/.test(html));
  assert.match(html, /class="mono"[^>]*>QP</);
});

test("brand colours are inlined into the HTML, so there is no default-colour flash", () => {
  const config = { ...CONFIG, primaryColor: "#2F5233" };
  const tpl = readFileSync(new URL("../r.html", import.meta.url), "utf8");
  const html = fillTemplate(tpl, { body: renderLanding(config, {}), title: landingTitle(config), config });
  assert.match(html, /<style>:root\{--brand: #2F5233; --brand-ink: #ffffff;\}<\/style>/);
  assert.ok(html.indexOf("--brand: #2F5233") < html.indexOf("<main"), "colours arrive before the content paints");
  assert.ok(!/#1d4ed8/i.test(html), "no hard-coded default brand colour left in the page");
  assert.ok(html.includes("<title>Thank you · Quillbrook Plumbing</title>"));
});

test("feedback and Google-tap beacons post the token to the public RPCs only", () => {
  const f = feedbackRequest({ supabaseUrl: "https://p.supabase.co/", anonKey: "anon", token: "tok12345", rating: 2, comment: "  late  " });
  assert.equal(f.url, "https://p.supabase.co/rest/v1/rpc/reviews_submit_feedback");
  assert.deepEqual(JSON.parse(f.options.body), { p_token: "tok12345", p_rating: 2, p_comment: "late" });
  assert.equal(f.options.keepalive, true);
  assert.equal(feedbackRequest({ supabaseUrl: "u", anonKey: "k", token: "t", rating: 9 }), null);
  const g = googleClickRequest({ supabaseUrl: "https://p.supabase.co", anonKey: "anon", token: "tok12345" });
  assert.equal(g.url, "https://p.supabase.co/rest/v1/rpc/reviews_google_click");
  assert.deepEqual(JSON.parse(g.options.body), { p_token: "tok12345" });
});

test("the customer's words survive a dropped connection (saved on the phone until sent)", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  writeDraft(storage, "tok", { rating: 2, comment: "Left a mess", pending: true });
  assert.deepEqual(readDraft(storage, "tok"), { rating: 2, comment: "Left a mess", pending: true, sent: false });
  assert.equal(readDraft({ getItem: () => { throw new Error("blocked"); } }, "tok"), null);
});
