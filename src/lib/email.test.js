import test from "node:test";
import assert from "node:assert/strict";
import { buildEmail, bodyToHtml, escapeHtml, wrapHtml } from "./email.js";

const TEMPLATE = {
  subject: "Quick favour from {businessName}?",
  body: "Hi {customerName},\n\nThanks for choosing {businessName} for your {jobDescription}.\n\n{reviewLink}\n\nThanks,\n{businessName}",
};
const base = {
  customer: { name: "Thandi", email: "test@example.com" },
  job: { description: "geyser replacement" },
  businessName: "Cape Plumbing",
  template: TEMPLATE,
  reviewLink: "https://reviews.example.co.za/r/tok123",
};

test("subject and body are rendered with every placeholder filled", () => {
  const m = buildEmail(base);
  assert.equal(m.subject, "Quick favour from Cape Plumbing?");
  assert.ok(m.text.startsWith("Hi Thandi,"));
  assert.ok(m.text.includes("geyser replacement"));
  assert.ok(m.text.includes(base.reviewLink));
  assert.ok(!m.text.includes("{"));
});

test("the html version contains the link exactly once as a button plus a fallback", () => {
  const m = buildEmail(base);
  const hrefs = m.html.match(/href="https:\/\/reviews\.example\.co\.za\/r\/tok123"/g) ?? [];
  assert.equal(hrefs.length, 2, "one button, one copy-paste fallback");
  assert.ok(m.html.includes("Leave a Google review"));
});

test("a customer name containing html is escaped, not injected", () => {
  const m = buildEmail({ ...base, customer: { name: '<script>alert(1)</script>', email: "test@example.com" } });
  assert.ok(!m.html.includes("<script>"));
  assert.ok(m.html.includes("&lt;script&gt;"));
  assert.equal(m.subject.includes("<script>"), false);
});

test("escapeHtml covers the characters that break out of markup", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("a missing or malformed email address is refused before sending", () => {
  assert.match(buildEmail({ ...base, customer: { name: "A", email: "" } }).error, /no email/i);
  assert.match(buildEmail({ ...base, customer: { name: "A", email: "not-an-email" } }).error, /not a valid/i);
});

test("an unconfigured template is refused rather than sending something blank", () => {
  assert.match(buildEmail({ ...base, template: { subject: "", body: "" } }).error, /configured/i);
  assert.match(buildEmail({ ...base, template: { subject: "x", body: "" } }).error, /configured/i);
});

test("a missing review link is refused", () => {
  assert.match(buildEmail({ ...base, reviewLink: "" }).error, /review link/i);
});

test("a job with no description still reads naturally", () => {
  const m = buildEmail({ ...base, job: { description: "" } });
  assert.ok(m.text.includes("for your recent job"));
});

test("paragraphs and line breaks survive the conversion to html", () => {
  const html = bodyToHtml("one\n\ntwo\nthree", { reviewLink: "https://x.test/r/t" });
  assert.equal((html.match(/<p /g) ?? []).length, 2);
  assert.ok(html.includes("two<br />three"));
});

test("the wrapper carries a plain-text fallback link for clients that block buttons", () => {
  const html = wrapHtml("<p>hi</p>", { businessName: "Cape Plumbing", reviewLink: "https://x.test/r/t" });
  assert.ok(html.includes("paste this into your browser"));
  assert.ok(html.includes("Sent by Cape Plumbing."));
});
