import test from "node:test";
import assert from "node:assert/strict";
import { checklistState, sentByOwner } from "../src/lib/onboarding.js";
import { summarise, requestStage, STAGE_LABELS, formatPercent, formatRating, feedbackList } from "../src/lib/responses.js";

const NOW = new Date("2026-11-05T10:00:00Z");
const ago = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();

test("checklist: config -> data -> first send, shown until complete, dismissible after", () => {
  let s = checklistState({ configConfirmed: false, customers: [], jobs: [], requests: [], dismissed: true });
  assert.equal(s.next, "config"); assert.equal(s.show, true, "can't be dismissed while incomplete");
  s = checklistState({ configConfirmed: true, customers: [{ id: 1 }], requests: [] });
  assert.equal(s.next, "action"); assert.equal(s.count, 2);
  s = checklistState({ configConfirmed: true, customers: [{}], requests: [{ created_at: ago(0.01), sent_at: ago(0) }], dismissed: false });
  assert.equal(s.complete, true); assert.equal(s.canDismiss, true); assert.equal(s.show, true);
  assert.equal(checklistState({ configConfirmed: true, customers: [{}], requests: [{ created_at: ago(0.01), sent_at: ago(0) }], dismissed: true }).show, false);
});

test("seeded demo sends (created now, sent in the past) don't count as the owner's first send", () => {
  assert.equal(sentByOwner({ created_at: ago(0), sent_at: ago(8) }), false);
  assert.equal(sentByOwner({ created_at: ago(0.001), sent_at: ago(0) }), true);
  assert.equal(sentByOwner({ created_at: ago(0), sent_at: null }), false);
});

test("stages never say reviewed: the furthest is 'Went to Google'", () => {
  assert.equal(requestStage({ sent_at: null }), "draft");
  assert.equal(requestStage({ sent_at: ago(2) }), "sent");
  assert.equal(requestStage({ sent_at: ago(2), clicked_at: ago(1) }), "opened");
  assert.equal(requestStage({ sent_at: ago(2), clicked_at: ago(1), feedback_at: ago(1) }), "feedback");
  assert.equal(requestStage({ sent_at: ago(2), google_clicked_at: ago(1) }), "google");
  assert.ok(Object.values(STAGE_LABELS).every((l) => !/review(ed)?\b/i.test(l.label)));
});

test("hero numbers come from real rows: response rate, Google taps, average private score", () => {
  const rows = [
    { sent_at: ago(1) },
    { sent_at: ago(2), clicked_at: ago(1) },
    { sent_at: ago(3), feedback_at: ago(2), feedback_rating: 5, google_clicked_at: ago(2) },
    { sent_at: ago(4), feedback_at: ago(3), feedback_rating: 2 },
    { sent_at: ago(40), clicked_at: ago(39) }, // outside the window
    { sent_at: null },                           // never sent
  ];
  const s = summarise(rows, { now: NOW });
  assert.equal(s.sent, 4); assert.equal(s.responded, 3); assert.equal(formatPercent(s.responseRate), "75%");
  assert.equal(s.googleTaps, 1); assert.equal(s.avgRating, 3.5); assert.equal(s.ratingCount, 2); assert.equal(formatRating(s.avgRating), "3.5");
  assert.equal(s.includesDemo, false);
});

test("nothing sent: no rate and no average, rather than 0", () => {
  const s = summarise([], { now: NOW });
  assert.equal(s.responseRate, null); assert.equal(s.avgRating, null);
  assert.equal(formatPercent(null), "–"); assert.equal(formatRating(null), "–");
});

test("demo rows in the window are flagged so the strip can label them", () => {
  assert.equal(summarise([{ sent_at: ago(1), is_demo: true }], { now: NOW }).includesDemo, true);
});

test("feedback list: answered requests only, newest first", () => {
  const l = feedbackList([{ id: "a", feedback_at: ago(3), feedback_rating: 4 }, { id: "b" }, { id: "c", feedback_at: ago(1), feedback_rating: 1 }]);
  assert.deepEqual(l.map((r) => r.id), ["c", "a"]);
});
