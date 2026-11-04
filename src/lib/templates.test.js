import test from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate, pickVariant, waNumber, buildWaLink, buildTrackedLink, buildWhatsappMessage, JOB_FALLBACK,
} from "./templates.js";

test("every placeholder is substituted", () => {
  const out = renderTemplate("Hi {customerName}, {businessName} here about your {jobDescription}: {reviewLink}", {
    customerName: "Jane Doe", businessName: "Quillbrook Plumbing", jobDescription: "geyser replacement", reviewLink: "https://x.test/r/abc",
  });
  assert.equal(out, "Hi Jane Doe, Quillbrook Plumbing here about your geyser replacement: https://x.test/r/abc");
  assert.ok(!out.includes("{"));
});

test("a missing job description falls back to readable wording", () => {
  const out = renderTemplate("thanks for choosing us for your {jobDescription}", { jobDescription: "" });
  assert.equal(out, `thanks for choosing us for your ${JOB_FALLBACK}`);
});

test("an unknown placeholder is left alone rather than blanked", () => {
  assert.equal(renderTemplate("Hi {nope}", {}), "Hi {nope}");
});

test("variants rotate with the seed and wrap around", () => {
  const v = ["a", "b", "c"];
  assert.deepEqual([0, 1, 2, 3, 4].map((s) => pickVariant(v, s)), ["a", "b", "c", "a", "b"]);
});

test("variant picking survives an empty or malformed template list", () => {
  assert.equal(pickVariant([], 0), "");
  assert.equal(pickVariant(undefined, 2), "");
  assert.equal(pickVariant(["", "  ", "real"], 0), "real");
});

test("wa.me numbers are digits only, country code first", () => {
  assert.equal(waNumber("+27820000000"), "27820000000");
  assert.equal(waNumber("+27 82 000 0000"), "27820000000");
  assert.equal(waNumber("+44 7700 900123"), "447700900123");
});

test("a local-format number is rejected rather than opening the wrong chat", () => {
  assert.equal(waNumber("0820000000"), null);
  assert.equal(waNumber("821234567"), null);
  assert.equal(waNumber(""), null);
  assert.equal(waNumber(null), null);
  assert.equal(waNumber("not a phone"), null);
});

test("the wa.me link is well formed and the message is URL encoded", () => {
  const link = buildWaLink("+27820000000", "Hi Jane Doe & co: https://x.test/r/a b?c=1");
  assert.ok(link.startsWith("https://wa.me/27820000000?text="));
  const text = decodeURIComponent(new URL(link).searchParams.get("text"));
  assert.equal(text, "Hi Jane Doe & co: https://x.test/r/a b?c=1");
});

test("ampersands and hashes in a message cannot truncate the link", () => {
  const link = buildWaLink("+27820000000", "A & B #1 = done");
  assert.equal(new URL(link).searchParams.get("text"), "A & B #1 = done");
});

test("the tracked link points at /r/<token> on this deploy", () => {
  assert.equal(buildTrackedLink("https://reviews.example.com", "tok123"), "https://reviews.example.com/r/tok123");
  assert.equal(buildTrackedLink("https://reviews.example.com/", "tok123"), "https://reviews.example.com/r/tok123");
});

test("a full send builds a message containing the tracked link", () => {
  const res = buildWhatsappMessage({
    customer: { name: "Jane Doe", phone: "+27820000000" },
    job: { description: "geyser replacement" },
    businessName: "Quillbrook Plumbing",
    templates: ["Hi {customerName}, thanks for choosing {businessName} for your {jobDescription}: {reviewLink}"],
    reviewLink: "https://reviews.example.com/r/tok123",
  });
  assert.equal(res.error, undefined);
  assert.equal(res.message, "Hi Jane Doe, thanks for choosing Quillbrook Plumbing for your geyser replacement: https://reviews.example.com/r/tok123");
  assert.equal(decodeURIComponent(new URL(res.link).searchParams.get("text")), res.message);
  assert.equal(new URL(res.link).pathname, "/27820000000");
});

test("a customer with no usable number reports why instead of building a broken link", () => {
  const base = { job: {}, businessName: "B", templates: ["{reviewLink}"], reviewLink: "https://x.test/r/t" };
  assert.match(buildWhatsappMessage({ ...base, customer: { name: "John Doe", phone: null } }).error, /no phone number/);
  assert.match(buildWhatsappMessage({ ...base, customer: { name: "John Doe", phone: "0820000000" } }).error, /international format/);
});

test("no templates configured is reported, not sent as an empty message", () => {
  const res = buildWhatsappMessage({
    customer: { name: "A", phone: "+27820000000" }, job: {}, businessName: "B", templates: [], reviewLink: "https://x.test/r/t",
  });
  assert.match(res.error, /templates/);
  assert.equal(res.link, undefined);
});
