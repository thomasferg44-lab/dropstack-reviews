import test from "node:test";
import assert from "node:assert/strict";
import { buildDemoPayload, DEMO_INDUSTRIES } from "../src/lib/demoData.js";
import { buildQueue } from "../src/features/queue/eligibility.js";
import { buildFollowUpQueue, followUpSettings } from "../src/lib/followup.js";
import { requestStage } from "../src/lib/responses.js";

const NOW = new Date("2026-11-05T10:00:00+02:00");

test("three trades, each a believable SA week with every state represented", () => {
  assert.deepEqual(Object.keys(DEMO_INDUSTRIES), ["plumber", "landscaper", "electrician"]);
  for (const k of Object.keys(DEMO_INDUSTRIES)) {
    const p = buildDemoPayload(k, NOW);
    const stages = new Set(p.requests.map((r) => requestStage(r)));
    for (const s of ["sent", "opened", "feedback", "google"]) assert.ok(stages.has(s), `${k} has ${s}`);
    assert.ok(p.requests.some((r) => r.followed_up_at), `${k} has a followed-up request`);
    assert.ok(p.jobs.some((j) => j.completed_at === null), `${k} has a job not finished yet`);
    assert.ok(p.requests.some((r) => r.feedback_rating <= 2), `${k} has an unhappy answer`);
  }
});

test("demo rows are all marked demo and can reach nobody", () => {
  for (const k of Object.keys(DEMO_INDUSTRIES)) {
    const p = buildDemoPayload(k, NOW);
    assert.ok(p.customers.every((c) => c.is_demo === true));
    for (const c of p.customers) {
      if (c.phone) assert.match(c.phone, /^\+27000000\d{3}$/, "placeholder +27 000 000 xxx pattern");
      assert.match(c.email, /@example\.com$/);
    }
    assert.equal(new Set(p.customers.map((c) => c.phone).filter(Boolean)).size, p.customers.filter((c) => c.phone).length, "phones unique");
  }
  const phones = Object.keys(DEMO_INDUSTRIES).flatMap((k) => buildDemoPayload(k, NOW).customers.map((c) => c.phone).filter(Boolean));
  assert.equal(new Set(phones).size, phones.length, "no phone shared across trades");
});

test("demo never claims a review was left: no reviewed state, showcase text is visibly sample", () => {
  const p = buildDemoPayload("plumber", NOW);
  assert.ok(!JSON.stringify(p).match(/reviewed_at|"reviewed"|review_left/));
  assert.ok(p.showcase.length > 0 && p.showcase.every((s) => /^Sample review/.test(s.body) && /^Sample /.test(s.author_name)));
});

test("loaded demo fills both queues on the dashboard", () => {
  const p = buildDemoPayload("electrician", NOW);
  const ids = new Map(p.customers.map((c, i) => [c.key, `id${i}`]));
  const jobIds = new Map(p.jobs.map((j, i) => [j.key, `j${i}`]));
  const customers = p.customers.map((c) => ({ ...c, id: ids.get(c.key) }));
  const jobs = p.jobs.map((j) => ({ ...j, id: jobIds.get(j.key), customer_id: ids.get(j.customer_key) }));
  const requests = p.requests.map((r, i) => ({ ...r, id: `r${i}`, customer_id: ids.get(r.customer_key), job_id: jobIds.get(r.job_key) }));
  assert.equal(buildQueue({ customers, jobs, requests, cooldownDays: 90, now: NOW }).ready.length, 3);
  assert.equal(buildFollowUpQueue({ customers, jobs, requests, now: NOW, settings: followUpSettings({}) }).length, 2);
});

test("an unknown trade is refused", () => {
  assert.throws(() => buildDemoPayload("baker", NOW), /Unknown demo trade/);
});
