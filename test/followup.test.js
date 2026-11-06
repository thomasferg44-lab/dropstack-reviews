import test from "node:test";
import assert from "node:assert/strict";
import { canFollowUp, buildFollowUpQueue, followUpChannels, followUpSettings, FOLLOW_UP_REFUSALS } from "../src/lib/followup.js";

const NOW = new Date("2026-11-05T10:00:00+02:00");
const ago = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const C = (id, extra = {}) => ({ id, name: `Customer ${id}`, phone: "+27000000101", email: "c@example.com", ...extra });
const R = (id, cid, sentDays, extra = {}) => ({ id, customer_id: cid, channel: "whatsapp", sent_at: sentDays === null ? null : ago(sentDays), ...extra });
const opts = { now: NOW, afterDays: 5, maxDays: 30 };

test("a sent request with no response becomes due after afterDays", () => {
  assert.equal(canFollowUp(R("r", "c", 4.9), opts).reason, "too-soon");
  assert.deepEqual(canFollowUp(R("r", "c", 5), opts), { ok: true, reason: null, daysSince: 5 });
});

test("ONE follow-up: a request already followed up is refused, whatever else is true", () => {
  const done = R("r", "c", 12, { followed_up_at: ago(6), follow_up_channel: "whatsapp" });
  assert.equal(canFollowUp(done, opts).ok, false);
  assert.equal(canFollowUp(done, opts).reason, "already-followed-up");
  // even a half-written stamp (channel only) counts as used
  assert.equal(canFollowUp(R("r", "c", 12, { follow_up_channel: "email" }), opts).reason, "already-followed-up");
  assert.match(FOLLOW_UP_REFUSALS["already-followed-up"], /One follow-up per request/);
});

test("a followed-up request never re-enters the follow-up queue", () => {
  const q = buildFollowUpQueue({
    now: NOW, settings: followUpSettings({}), customers: [C("a"), C("b")],
    requests: [R("r1", "a", 20, { followed_up_at: ago(10), follow_up_channel: "whatsapp" }), R("r2", "b", 8)],
  });
  assert.deepEqual(q.map((e) => e.request.id), ["r2"]);
});

test("any recorded response (opened, feedback, Google tap) means no follow-up", () => {
  for (const extra of [{ clicked_at: ago(7) }, { feedback_at: ago(7), feedback_rating: 4 }, { google_clicked_at: ago(7) }]) {
    assert.equal(canFollowUp(R("r", "c", 8, extra), opts).reason, "responded");
  }
});

test("unsent and too-old requests are not offered a follow-up", () => {
  assert.equal(canFollowUp(R("r", "c", null), opts).reason, "not-sent");
  assert.equal(canFollowUp(R("r", "c", 31), opts).reason, "too-late");
});

test("only each customer's latest request is considered, oldest first", () => {
  const q = buildFollowUpQueue({
    now: NOW, settings: followUpSettings({}), customers: [C("a"), C("b")],
    requests: [R("old", "a", 25), R("new", "a", 2), R("b1", "b", 9)],
  });
  assert.deepEqual(q.map((e) => e.request.id), ["b1"]); // a's latest is too soon
});

test("WhatsApp is offered first; email only when enabled and present", () => {
  assert.deepEqual(followUpChannels(C("a")), ["whatsapp", "email"]);
  assert.deepEqual(followUpChannels(C("a"), { emailEnabled: false }), ["whatsapp"]);
  assert.deepEqual(followUpChannels(C("a", { phone: "0820000000" })), ["email"]);
  const q = buildFollowUpQueue({ now: NOW, settings: { ...followUpSettings({}), emailEnabled: false },
    customers: [C("a", { phone: null })], requests: [R("r", "a", 8)] });
  assert.equal(q.length, 0, "unreachable on any allowed channel: not queued");
});

test("settings fall back to safe defaults", () => {
  assert.deepEqual(followUpSettings(undefined), { afterDays: 5, maxDays: 30, emailEnabled: true });
  assert.deepEqual(followUpSettings({ followUp: { afterDays: "x", maxDays: 10, emailEnabled: false } }), { afterDays: 5, maxDays: 10, emailEnabled: false });
});
