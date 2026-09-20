// Exercises the function with a stubbed fetch. Nothing leaves the machine.
import test from "node:test";
import assert from "node:assert/strict";

process.env.VITE_SUPABASE_URL = "https://proj.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "anon-key";

const { default: handler } = await import("./send-review-request.mjs");

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  token: "tok123456789012345678901",
  channel: "email",
  customer: { id: "c1", name: "Test Customer", email: "test@example.com" },
  job: { id: "j1", description: "geyser replacement" },
};

function stubFetch({ lookupStatus = 200, lookupBody = [ROW], resendStatus = 200 } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/rest/v1/")) {
      return new Response(JSON.stringify(lookupBody), { status: lookupStatus, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ id: "resend-1" }), { status: resendStatus, headers: { "content-type": "application/json" } });
  };
  return calls;
}

const post = (body, headers = { authorization: "Bearer owner-token" }) =>
  new Request("https://reviews.example.co.za/.netlify/functions/send-review-request", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });

test("a non-POST request is rejected", async () => {
  stubFetch();
  const res = await handler(new Request("https://x.test/f", { method: "GET" }));
  assert.equal(res.status, 405);
});

test("a request with no access token is rejected as unauthenticated", async () => {
  stubFetch();
  const res = await handler(post({ requestId: ROW.id }, {}));
  assert.equal(res.status, 401);
});

test("a malformed requestId is rejected before any database call", async () => {
  const calls = stubFetch();
  const res = await handler(post({ requestId: "'; drop table --" }));
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("the caller's own token is what reads the row, so RLS decides", async () => {
  process.env.DEV_BLOCK_REAL_SENDS = "true";
  const calls = stubFetch();
  await handler(post({ requestId: ROW.id }));
  const lookup = calls.find((c) => c.url.includes("/rest/v1/"));
  assert.equal(lookup.options.headers.Authorization, "Bearer owner-token");
});

test("a token the database rejects yields 401, not a send", async () => {
  const calls = stubFetch({ lookupStatus: 401, lookupBody: { message: "JWT expired" } });
  const res = await handler(post({ requestId: ROW.id }));
  assert.equal(res.status, 401);
  assert.equal(calls.filter((c) => c.url.includes("resend.com")).length, 0);
});

test("a request id that reads back nothing yields 404", async () => {
  stubFetch({ lookupBody: [] });
  const res = await handler(post({ requestId: ROW.id }));
  assert.equal(res.status, 404);
});

test("the recipient comes from the database and never from the request body", async () => {
  process.env.DEV_BLOCK_REAL_SENDS = "false";
  process.env.RESEND_API_KEY = "re_test";
  const calls = stubFetch();
  const res = await handler(post({ requestId: ROW.id, to: "attacker@evil.test", email: "attacker@evil.test" }));
  assert.equal(res.status, 200);
  const send = calls.find((c) => c.url.includes("resend.com"));
  const payload = JSON.parse(send.options.body);
  assert.deepEqual(payload.to, ["test@example.com"]);
  assert.ok(!JSON.stringify(payload).includes("evil.test"));
});

test("DEV_BLOCK_REAL_SENDS stops the send and reports what would have gone out", async () => {
  process.env.DEV_BLOCK_REAL_SENDS = "true";
  const calls = stubFetch();
  const res = await handler(post({ requestId: ROW.id }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.blocked, true);
  assert.equal(body.to, "test@example.com");
  assert.equal(calls.filter((c) => c.url.includes("resend.com")).length, 0);
});

test("an unset DEV_BLOCK_REAL_SENDS defaults to blocking", async () => {
  delete process.env.DEV_BLOCK_REAL_SENDS;
  const calls = stubFetch();
  const body = await (await handler(post({ requestId: ROW.id }))).json();
  assert.equal(body.blocked, true);
  assert.equal(calls.filter((c) => c.url.includes("resend.com")).length, 0);
});

test("the tracked link is built from the deploy's own origin", async () => {
  process.env.DEV_BLOCK_REAL_SENDS = "false";
  process.env.RESEND_API_KEY = "re_test";
  const calls = stubFetch();
  await handler(post({ requestId: ROW.id }));
  const payload = JSON.parse(calls.find((c) => c.url.includes("resend.com")).options.body);
  assert.ok(payload.text.includes(`https://reviews.example.co.za/r/${ROW.token}`));
});

test("a provider failure is reported rather than silently swallowed", async () => {
  process.env.DEV_BLOCK_REAL_SENDS = "false";
  process.env.RESEND_API_KEY = "re_test";
  stubFetch({ resendStatus: 422 });
  const res = await handler(post({ requestId: ROW.id }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /rejected/i);
});

test("a missing RESEND_API_KEY fails loudly instead of pretending to send", async () => {
  process.env.DEV_BLOCK_REAL_SENDS = "false";
  delete process.env.RESEND_API_KEY;
  stubFetch();
  const res = await handler(post({ requestId: ROW.id }));
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /RESEND_API_KEY/);
});

test("a customer with no email is refused before the provider is called", async () => {
  process.env.DEV_BLOCK_REAL_SENDS = "false";
  process.env.RESEND_API_KEY = "re_test";
  const calls = stubFetch({ lookupBody: [{ ...ROW, customer: { ...ROW.customer, email: null } }] });
  const res = await handler(post({ requestId: ROW.id }));
  assert.equal(res.status, 422);
  assert.equal(calls.filter((c) => c.url.includes("resend.com")).length, 0);
});
