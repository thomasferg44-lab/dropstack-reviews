import test from "node:test";
import assert from "node:assert/strict";
import { summariseRequests, formatRate } from "./stats.js";

const NOW = new Date("2026-09-20T12:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const req = (sentDays, clicked = false) => ({
  sent_at: sentDays === null ? null : daysAgo(sentDays),
  clicked_at: clicked ? daysAgo(sentDays) : null,
});

test("counts requests sent inside the window", () => {
  const s = summariseRequests([req(1), req(10), req(29)], { now: NOW });
  assert.equal(s.sent, 3);
});

test("ignores requests older than the window", () => {
  const s = summariseRequests([req(1), req(31), req(400)], { now: NOW });
  assert.equal(s.sent, 1);
});

test("ignores rows that were never sent", () => {
  const s = summariseRequests([req(null), req(2)], { now: NOW });
  assert.equal(s.sent, 1);
});

test("open rate counts opened links only", () => {
  const s = summariseRequests([req(1, true), req(2, true), req(3, false), req(4, false)], { now: NOW });
  assert.equal(s.opened, 2);
  assert.equal(s.openRate, 0.5);
  assert.equal(formatRate(s.openRate), "50%");
});

test("no sends reports no rate rather than zero percent", () => {
  const s = summariseRequests([], { now: NOW });
  assert.equal(s.sent, 0);
  assert.equal(s.openRate, null);
  assert.equal(formatRate(s.openRate), "—");
});

test("a request dated in the future is not counted", () => {
  const future = { sent_at: new Date(NOW.getTime() + 86400000).toISOString(), clicked_at: null };
  assert.equal(summariseRequests([future, req(1)], { now: NOW }).sent, 1);
});

test("a malformed timestamp is skipped rather than crashing the header", () => {
  assert.equal(summariseRequests([{ sent_at: "not-a-date" }, req(1)], { now: NOW }).sent, 1);
});

test("the window is configurable", () => {
  assert.equal(summariseRequests([req(1), req(5)], { now: NOW, windowDays: 3 }).sent, 1);
});

test("an open is counted even if it happened after the window opened", () => {
  const s = summariseRequests([{ sent_at: daysAgo(20), clicked_at: daysAgo(1) }], { now: NOW });
  assert.equal(s.opened, 1);
  assert.equal(formatRate(s.openRate), "100%");
});
