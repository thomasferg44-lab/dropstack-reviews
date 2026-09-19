// Run with: npm test   (node's built-in runner — no test dependency)
import test from "node:test";
import assert from "node:assert/strict";
import { buildQueue } from "./eligibility.js";

const NOW = new Date("2026-09-19T12:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const inDays = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

const C = (id, extra = {}) => ({ id, name: `C${id}`, phone: "+27000000000", ...extra });
const J = (cid, days, extra = {}) => ({ id: `j${cid}`, customer_id: cid, description: "job", completed_at: daysAgo(days), ...extra });
const R = (cid, days, extra = {}) => ({ id: `r${cid}`, customer_id: cid, sent_at: days === null ? null : daysAgo(days), ...extra });
const run = (o) => buildQueue({ cooldownDays: 90, now: NOW, ...o });
const ids = (list) => list.map((e) => e.customer.id);
const reasons = (list) => list.map((e) => e.reason);

test("a customer with a completed job who has never been asked is ready", () => {
  assert.deepEqual(ids(run({ customers: [C("1")], jobs: [J("1", 3)] }).ready), ["1"]);
});

test("a customer with no completed job never enters the queue", () => {
  assert.deepEqual(run({ customers: [C("1")], jobs: [] }), { ready: [], suppressed: [] });
  assert.equal(run({ customers: [C("1")], jobs: [{ id: "j", customer_id: "1", completed_at: null }] }).ready.length, 0);
});

test("a job dated in the future does not make a customer eligible", () => {
  assert.equal(run({ customers: [C("1")], jobs: [{ id: "j", customer_id: "1", completed_at: inDays(2) }] }).ready.length, 0);
});

test("cooldown suppresses a customer asked inside the window", () => {
  assert.deepEqual(reasons(run({ customers: [C("1")], jobs: [J("1", 1)], requests: [R("1", 89)] }).suppressed), ["cooldown"]);
});

test("cooldown releases a customer at exactly cooldownDays", () => {
  assert.deepEqual(ids(run({ customers: [C("1")], jobs: [J("1", 1)], requests: [R("1", 90)] }).ready), ["1"]);
  assert.deepEqual(ids(run({ customers: [C("1")], jobs: [J("1", 1)], requests: [R("1", 91)] }).ready), ["1"]);
});

test("cooldownDays of 0 disables the guard", () => {
  assert.equal(run({ cooldownDays: 0, customers: [C("1")], jobs: [J("1", 0)], requests: [R("1", 1)] }).ready.length, 1);
});

test("a customer is not re-asked about a job they were already asked about", () => {
  assert.deepEqual(reasons(run({ customers: [C("1")], jobs: [J("1", 200)], requests: [R("1", 120)] }).suppressed),
    ["asked-about-this-job"]);
});

test("a new completed job makes a previously-asked customer eligible again", () => {
  assert.deepEqual(ids(run({ customers: [C("1")], jobs: [J("1", 200), J("1", 10, { id: "jnew" })], requests: [R("1", 120)] }).ready), ["1"]);
});

test("an unsent request row does not count as an ask", () => {
  assert.deepEqual(ids(run({ customers: [C("1")], jobs: [J("1", 5)], requests: [R("1", null)] }).ready), ["1"]);
});

test("cooldown is measured from the most recent ask, not the first", () => {
  assert.deepEqual(reasons(run({ customers: [C("1")], jobs: [J("1", 1)], requests: [R("1", 300), R("1", 5, { id: "r2" })] }).suppressed),
    ["cooldown"]);
});

test("a customer with no phone and no email is flagged, not silently dropped", () => {
  assert.deepEqual(reasons(run({ customers: [C("1", { phone: null, email: null })], jobs: [J("1", 5)] }).suppressed), ["no-contact"]);
});

test("an email-only customer is reachable", () => {
  assert.equal(run({ customers: [C("1", { phone: null, email: "test@example.com" })], jobs: [J("1", 5)] }).ready.length, 1);
});

test("the queue is ordered longest-waiting first", () => {
  assert.deepEqual(ids(run({ customers: [C("1"), C("2"), C("3")], jobs: [J("1", 5), J("2", 30), J("3", 12)] }).ready),
    ["2", "3", "1"]);
});

test("the most recent completed job is the one shown", () => {
  const q = run({ customers: [C("1")], jobs: [J("1", 50, { description: "old" }), J("1", 2, { id: "jx", description: "new" })] });
  assert.equal(q.ready[0].job.description, "new");
});

test("a suppressed row reports how long ago and when it frees up", () => {
  const s = run({ customers: [C("1")], jobs: [J("1", 1)], requests: [R("1", 30)] }).suppressed[0];
  assert.equal(s.daysSinceAsk, 30);
  assert.equal(s.availableOn.slice(0, 10), "2026-11-18");
});

test("one customer's job never qualifies another customer", () => {
  assert.deepEqual(ids(run({ customers: [C("1"), C("2")], jobs: [J("2", 5)] }).ready), ["2"]);
});
