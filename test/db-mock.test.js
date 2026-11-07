// The dashboard's data layer (src/lib/db.js) driven against the local test
// backend in Node. Proves channel logging, the one-follow-up refusal and demo
// marking end to end through the same calls the UI makes. The SQL twin of
// these rules is proven by supabase/local-test (PGlite) and verify-*.sql.
import test from "node:test";
import assert from "node:assert/strict";
import { createMockClient, mockStore, DB_KEY } from "../src/dev/mockBackend.js";
import * as db from "../src/lib/db.js";
import { buildDemoPayload } from "../src/lib/demoData.js";

const client = createMockClient();
db.setClient(client);
mockStore.set("dropstack-mock-latency", "0");

async function fresh({ legacy = false } = {}) {
  mockStore.del(DB_KEY);
  if (legacy) mockStore.set("dropstack-mock-schema", "legacy"); else mockStore.del("dropstack-mock-schema");
  await client.auth.signInWithPassword({ email: "test@example.com", password: "x" });
  await db.detectSchema();
}

test("a request logs the channel it was actually sent on, and only counts once sent", async () => {
  await fresh();
  const c = await db.saveCustomer({ name: "Thandi Mokoena", phone: "082 000 0101", email: "t@example.com" });
  assert.equal(c.phone, "+27820000101");
  const j = await db.saveJob({ customerId: c.id, description: "geyser", completedAt: "2026-11-04" });
  const draft = await db.createDraftRequest({ customerId: c.id, jobId: j.id, channel: "whatsapp" });
  assert.equal(draft.sent_at, null);
  assert.ok(draft.token.length >= 20, "token exists before the owner taps, for the tracked link");
  const sent = await db.markSent(draft.id, "whatsapp");
  assert.equal(sent.channel, "whatsapp");
  assert.ok(sent.sent_at);
  // switching channel in the composer is logged as the channel used
  const d2 = await db.createDraftRequest({ customerId: c.id, jobId: j.id, channel: "whatsapp" });
  assert.equal((await db.markSent(d2.id, "email")).channel, "email");
  // a second markSent never re-stamps
  assert.equal(await db.markSent(d2.id, "whatsapp"), null);
  const all = (await db.loadAll()).requests;
  assert.deepEqual(all.map((r) => r.channel).sort(), ["email", "whatsapp"]);
});

test("an opened-but-unsent draft is discarded and leaves nothing behind", async () => {
  await fresh();
  const c = await db.saveCustomer({ name: "A", phone: "+27000000101" });
  const d = await db.createDraftRequest({ customerId: c.id, channel: "whatsapp" });
  await db.discardDraft(d.id);
  assert.equal((await db.loadAll()).requests.length, 0);
});

test("ONE follow-up: the second is refused by the data layer and by the backend guard", async () => {
  await fresh();
  const c = await db.saveCustomer({ name: "Sipho", phone: "+27000000104" });
  const d = await db.createDraftRequest({ customerId: c.id, channel: "whatsapp" });
  await assert.rejects(db.recordFollowUp(d.id, "whatsapp"), { code: "already-followed-up" }, "unsent: refused");
  await db.markSent(d.id, "whatsapp");
  const f = await db.recordFollowUp(d.id, "whatsapp");
  assert.equal(f.follow_up_channel, "whatsapp");
  await assert.rejects(db.recordFollowUp(d.id, "email"), { code: "already-followed-up" });
  // bypass the app's filter and hit the table directly: the guard still refuses
  const raw = await client.from("reviews_requests").update({ followed_up_at: new Date().toISOString(), follow_up_channel: "email" }).eq("id", d.id);
  assert.equal(raw.error.code, "23514");
  const raw2 = await client.from("reviews_requests").update({ followed_up_at: null, follow_up_channel: null }).eq("id", d.id);
  assert.equal(raw2.error.code, "23514", "clearing the stamp to make room for a second is refused too");
});

test("demo load marks every row; remove deletes exactly those and keeps real data", async () => {
  await fresh();
  const real = await db.saveCustomer({ name: "Real Customer", phone: "+27000000999" });
  await db.saveJob({ customerId: real.id, description: "real job", completedAt: "2026-11-01" });
  const res = await db.loadDemo(buildDemoPayload("plumber", new Date()));
  assert.equal(res.customers_created, 12);
  let all = await db.loadAll();
  const demoRows = [...all.customers, ...all.jobs, ...all.requests, ...all.showcase].filter((r) => r.is_demo);
  assert.equal(demoRows.length, 12 + 12 + 8 + 3);
  assert.equal(all.customers.filter((c) => !c.is_demo).length, 1);
  await assert.rejects(db.loadDemo(buildDemoPayload("plumber", new Date())), /already loaded/);
  // a request the owner sends to a demo customer is demo too (inherits)
  const demoCust = all.customers.find((c) => c.is_demo);
  const d = await db.createDraftRequest({ customerId: demoCust.id, channel: "whatsapp" });
  assert.equal(d.is_demo, true);
  const rm = await db.removeDemo();
  assert.equal(rm.customers_removed, 12);
  all = await db.loadAll();
  assert.deepEqual(all.customers.map((c) => c.name), ["Real Customer"]);
  assert.equal(all.jobs.length, 1);
  assert.equal(all.requests.length + all.showcase.length, 0);
});

test("before the patch (v1 database) the core flow still works and new features are detected as missing", async () => {
  await fresh({ legacy: true });
  assert.equal(db.getSchemaLevel(), "v1");
  const c = await db.saveCustomer({ name: "Legacy", phone: "+27000000105" });
  const d = await db.createDraftRequest({ customerId: c.id, channel: "whatsapp" });
  assert.ok((await db.markSent(d.id, "whatsapp")).sent_at);
  const all = await db.loadAll();
  assert.equal(all.requests.length, 1);
  assert.equal("is_demo" in all.requests[0], false);
  await assert.rejects(db.loadDemo(buildDemoPayload("plumber", new Date())));
  mockStore.del("dropstack-mock-schema");
});

test("a duplicate phone is reported in plain words", async () => {
  await fresh();
  await db.saveCustomer({ name: "A", phone: "+27000000101" });
  // "+27 00 000 0101" and "+27000000101" are the same number once normalised
  await assert.rejects(db.saveCustomer({ name: "B", phone: "+27 00 000 0101" }), /A customer with this phone number already exists/);
});

test("a job finished today is stamped now, never as a future noon that hides it from Ask now", () => {
  const morning = new Date("2026-11-05T07:30:00+02:00");
  assert.equal(db.dateToIso("2026-11-05", morning), morning.toISOString());
  assert.equal(db.dateToIso("2026-11-03", morning), "2026-11-03T10:00:00.000Z");
});
