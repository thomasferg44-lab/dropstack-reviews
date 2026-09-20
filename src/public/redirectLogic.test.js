import test from "node:test";
import assert from "node:assert/strict";
import { tokenFromPath, redirectTarget, stampRequest } from "./redirectLogic.js";

test("the token is read from /r/<token>", () => {
  assert.equal(tokenFromPath("/r/Kd8sQp2xVn4mLr7wYt1bZc9f"), "Kd8sQp2xVn4mLr7wYt1bZc9f");
  assert.equal(tokenFromPath("/r/abc/"), "abc");
  assert.equal(tokenFromPath("/r/abc?utm_source=whatsapp"), "abc");
  assert.equal(tokenFromPath("/r/abc#x"), "abc");
});

test("a missing or empty token is reported rather than guessed at", () => {
  assert.equal(tokenFromPath("/r/"), null);
  assert.equal(tokenFromPath("/"), null);
  assert.equal(tokenFromPath(""), null);
  assert.equal(tokenFromPath(null), null);
});

test("a percent-encoded token is decoded, and a malformed one does not throw", () => {
  assert.equal(tokenFromPath("/r/ab%2Dc"), "ab-c");
  assert.equal(tokenFromPath("/r/ab%zz"), "ab%zz");
});

test("the redirect target is the configured review URL", () => {
  assert.deepEqual(redirectTarget("https://g.page/r/xyz/review"), { url: "https://g.page/r/xyz/review" });
});

test("an unset or non-http review URL is refused instead of redirecting somewhere useless", () => {
  assert.equal(redirectTarget("").error, "no-review-url");
  assert.equal(redirectTarget("   ").error, "no-review-url");
  assert.equal(redirectTarget(undefined).error, "no-review-url");
  assert.equal(redirectTarget("g.page/r/xyz").error, "bad-review-url");
  assert.equal(redirectTarget("javascript:alert(1)").error, "bad-review-url");
});

test("the stamp call posts the token to the public RPC and nothing else", () => {
  const req = stampRequest({ supabaseUrl: "https://abc.supabase.co/", anonKey: "anon-key", token: "tok1" });
  assert.equal(req.url, "https://abc.supabase.co/rest/v1/rpc/reviews_open_link");
  assert.equal(req.options.method, "POST");
  assert.equal(req.options.headers.apikey, "anon-key");
  assert.deepEqual(JSON.parse(req.options.body), { p_token: "tok1" });
  assert.equal(req.options.keepalive, true);
});

test("the stamp call is skipped when anything needed is missing", () => {
  assert.equal(stampRequest({ supabaseUrl: "", anonKey: "k", token: "t" }), null);
  assert.equal(stampRequest({ supabaseUrl: "u", anonKey: "", token: "t" }), null);
  assert.equal(stampRequest({ supabaseUrl: "u", anonKey: "k", token: null }), null);
});
