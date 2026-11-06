import test from "node:test";
import assert from "node:assert/strict";
import { composeMessage, jobWhen, whatsappLink, defaultChannel, DEFAULT_FOLLOW_UP } from "../src/lib/compose.js";
import { companyConfig } from "../companyConfig.js";

const NOW = new Date("2026-11-05T10:00:00+02:00"); // a Thursday
const LINK = "https://reviews.example.com/r/tok123456";
const thandi = { name: "Thandi Mokoena", phone: "+27000000101", email: "thandi.m@example.com" };

test("when the job was done reads like a person would say it", () => {
  assert.equal(jobWhen("2026-11-05T08:00:00+02:00", NOW), "today");
  assert.equal(jobWhen("2026-11-04T16:00:00+02:00", NOW), "yesterday");
  assert.equal(jobWhen("2026-11-03T09:00:00+02:00", NOW), "on Tuesday");
  assert.equal(jobWhen("2026-10-27T09:00:00+02:00", NOW), "last week");
  assert.equal(jobWhen("2026-10-03T09:00:00+02:00", NOW), "on 3 Oct");
  assert.equal(jobWhen(null, NOW), "recently");
  // late-evening SA job is still "yesterday", not "today", whatever the UTC date
  assert.equal(jobWhen("2026-11-04T23:30:00+02:00", NOW), "yesterday");
});

test("a request is personal: first name, the actual job, when, and the tracked link", () => {
  const m = composeMessage({ customer: thandi, job: { description: "geyser replacement (150L)", completed_at: "2026-11-04T15:00:00+02:00" },
    config: companyConfig, reviewLink: LINK, now: NOW, seed: 0 });
  assert.equal(m.channel, "whatsapp");
  assert.match(m.text, /^Hi Thandi, /);
  assert.ok(!m.text.includes("Mokoena"));
  assert.ok(m.text.includes("geyser replacement (150L) yesterday"));
  assert.ok(m.text.includes(LINK));
  assert.equal(decodeURIComponent(new URL(m.link).searchParams.get("text")), m.text);
  assert.ok(!/\{\w+\}/.test(m.text), "no unfilled placeholders");
});

test("every configured template variant fills every placeholder", () => {
  for (let seed = 0; seed < companyConfig.templates.whatsapp.length; seed++) {
    const m = composeMessage({ customer: thandi, job: { description: "burst pipe repair", completed_at: "2026-11-03T09:00:00+02:00" }, config: companyConfig, reviewLink: LINK, now: NOW, seed });
    assert.ok(!/\{\w+\}/.test(m.text), m.text);
    assert.ok(m.text.includes(LINK));
  }
});

test("the follow-up uses its own template and says it's the last ask", () => {
  const m = composeMessage({ customer: thandi, job: { description: "burst pipe repair" }, config: companyConfig, reviewLink: LINK, kind: "followup", now: NOW });
  assert.match(m.text, /last you'll hear from us/);
  const e = composeMessage({ customer: thandi, job: { description: "burst pipe repair" }, config: companyConfig, reviewLink: LINK, kind: "followup", channel: "email", now: NOW });
  assert.equal(e.subject, "One last thing from Quillbrook Plumbing");
  assert.match(e.text, /won't ask again/);
  // a config without follow-up templates falls back to the built-in ones
  const d = composeMessage({ customer: thandi, job: {}, config: { businessName: "B", templates: {} }, reviewLink: LINK, kind: "followup", now: NOW });
  assert.ok(d.text.startsWith("Hi Thandi") && DEFAULT_FOLLOW_UP.whatsapp.length === 1);
});

test("email is composed for the customer's own address only", () => {
  const e = composeMessage({ customer: thandi, job: { description: "x" }, config: companyConfig, reviewLink: LINK, channel: "email", now: NOW });
  assert.equal(e.to, "thandi.m@example.com");
  assert.match(composeMessage({ customer: { name: "No Mail" }, job: {}, config: companyConfig, reviewLink: LINK, channel: "email" }).error, /no email/);
});

test("an edited WhatsApp message must keep the tracked link", () => {
  assert.match(whatsappLink(thandi, "Hi Thandi, review please", LINK).error, /review link is missing/);
  assert.ok(whatsappLink(thandi, `Hi Thandi ${LINK}`, LINK).link.startsWith("https://wa.me/27000000101?text="));
});

test("WhatsApp is the default channel whenever the number works", () => {
  assert.equal(defaultChannel(thandi), "whatsapp");
  assert.equal(defaultChannel({ ...thandi, phone: "0820000000" }), "email");
  assert.equal(defaultChannel({ name: "x" }), "whatsapp");
});
