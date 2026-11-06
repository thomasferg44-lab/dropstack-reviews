import test from "node:test";
import assert from "node:assert/strict";
import { replyDraft, replyBand } from "../src/lib/replyDrafts.js";

const cfg = { businessName: "Quillbrook Plumbing", ownerName: "Sam" };
const customer = { name: "Fatima Adams" };
const job = { description: "bathroom renovation plumbing" };

test("drafts are banded by rating: 5 warm, 4 thanks, 3 and below recovery", () => {
  assert.deepEqual([5, 4, 3, 2, 1].map(replyBand), ["warm", "thanks", "recovery", "recovery", "recovery"]);
});

test("drafts are personal and signed in the owner's voice", () => {
  const d = replyDraft({ rating: 5, customer, job, config: cfg });
  assert.match(d.text, /^Thank you so much, Fatima!/);
  assert.ok(d.text.includes("bathroom renovation plumbing"));
  assert.ok(d.text.endsWith("Sam, Quillbrook Plumbing"));
  assert.ok(!/\{\w+\}/.test(d.text));
});

test("no owner name: the signature is just the business", () => {
  const d = replyDraft({ rating: 4, customer, job, config: { businessName: "Quillbrook Plumbing" } });
  assert.ok(d.text.endsWith(" Quillbrook Plumbing"));
  assert.ok(!d.text.includes(", ,") && !d.text.includes("{ownerName}"));
});

test("a low-score draft offers to put it right and never discourages a public review", () => {
  for (const rating of [1, 2, 3]) {
    const d = replyDraft({ rating, customer, job, config: cfg });
    assert.match(d.text, /put it right/);
    assert.ok(!/(remove|delete|change|edit|hold off|instead of|don't|do not).{0,30}(review|google)/i.test(d.text), d.text);
  }
});

test("a client's own draft overrides the default for its band", () => {
  const d = replyDraft({ rating: 5, customer, job, config: { ...cfg, replyDrafts: { warm: "Shot {firstName}!" } } });
  assert.equal(d.text, "Shot Fatima!");
});
