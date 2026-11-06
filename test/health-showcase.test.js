import test from "node:test";
import assert from "node:assert/strict";
import { checkHealth, healthSummary, configPresence } from "../src/lib/health.js";
import { reviewUrlStatus, REVIEW_URL_WARNINGS } from "../src/lib/reviewUrl.js";
import { mergeShowcase, stars, embedSnippet } from "../src/lib/showcase.js";
import { companyConfig } from "../companyConfig.js";

const ENV = { supabaseUrl: "https://proj.supabase.co", supabaseAnonKey: "anon-secret-value", resendApiKey: "re_secret", devBlockRealSends: undefined };

test("health returns booleans only and never echoes a secret, URL or number", async () => {
  const h = await checkHealth({ config: { ...companyConfig, whatsappNumber: "27000000999", reviewUrl: "https://g.page/r/x/review" }, env: ENV,
    fetchImpl: async () => new Response(JSON.stringify({ code: "42501" }), { status: 401 }) });
  assert.equal(h.ok, true); assert.equal(h.database, true); assert.equal(h.healthy, true);
  const s = JSON.stringify(h);
  for (const secret of ["anon-secret-value", "re_secret", "proj.supabase.co", "27000000999", "g.page"]) assert.ok(!s.includes(secret), secret);
  for (const v of Object.values(h.config)) assert.equal(typeof v, "boolean");
  for (const v of Object.values(h.functions)) assert.equal(typeof v, "boolean");
});

test("database down or unreachable reads false, never throws", async () => {
  const h = await checkHealth({ config: companyConfig, env: ENV, fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(h.database, false); assert.equal(h.healthy, false);
  assert.equal(healthSummary(h).text, "Database not reachable");
  const h5 = await checkHealth({ config: companyConfig, env: ENV, fetchImpl: async () => new Response("<html>", { status: 503 }) });
  assert.equal(h5.database, false);
});

test("the status line calls out a missing review link before anything else", async () => {
  const h = await checkHealth({ config: companyConfig, env: ENV, fetchImpl: async () => new Response("[]", { status: 200 }) });
  assert.equal(h.config.reviewUrl, false);
  assert.deepEqual(healthSummary(h), { tone: "bad", text: "Connected · review link not set" });
  assert.equal(configPresence(companyConfig, ENV).fromEmail, false, "example.com sender is a placeholder");
});

test("reviewUrl guardrail: missing / invalid / ok, with a loud specific warning", () => {
  assert.equal(reviewUrlStatus("").state, "missing");
  assert.equal(reviewUrlStatus("g.page/r/x").state, "invalid");
  assert.equal(reviewUrlStatus("http://g.page/r/x").state, "invalid");
  assert.deepEqual(reviewUrlStatus("https://g.page/r/abc/review"), { ok: true, state: "ok", notGoogle: false, url: "https://g.page/r/abc/review" });
  assert.equal(reviewUrlStatus("https://example.com/review").notGoogle, true);
  assert.equal(REVIEW_URL_WARNINGS.missing.title, "Customer links currently lead nowhere");
  assert.equal(companyConfig.reviewUrl, "", "the demo config's review URL is left for the owner to set");
});

test("showcase: config first, cleaned, invalid entries dropped, max 12", () => {
  const out = mergeShowcase([{ author_name: " Thandi  M. ", rating: 5, body: "Great  work" }, { author_name: "", rating: 5, body: "x" }],
    [{ author_name: "Pieter V.", rating: 7, body: "x" }, { author_name: "Thandi M.", rating: 5, body: "Great work" }, { author_name: "Ayesha P.", rating: 4, body: "Tidy", reviewed_on: "2026-10-01" }]);
  assert.deepEqual(out.map((r) => r.author), ["Thandi M.", "Ayesha P."]);
  assert.equal(out[1].date, "2026-10-01");
  assert.equal(mergeShowcase(Array.from({ length: 20 }, (_, i) => ({ author_name: `A${i}`, rating: 5, body: `b${i}` }))).length, 12);
  assert.deepEqual(stars(4), { filled: 4, empty: 1, label: "4 out of 5 stars" });
  assert.equal(embedSnippet("https://reviews.example.com/"), '<script src="https://reviews.example.com/showcase.js" async></script>');
  assert.deepEqual(companyConfig.showcase.reviews, [], "no invented testimonials ship in config");
});
