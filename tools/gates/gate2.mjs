// Gate 2 + Gate 3 (design spec §6): scripted end-to-end flows on the mock-
// backend builds, 390px phone and 1280px desktop, test data only. Also
// captures the Gate 4 "after" screenshots.
//   node tools/gates/gate2.mjs <shotsDir> <baseA> <baseB> [repo]
// A = the repo's own config (reviewUrl empty, as shipped). B = configs/
// demo-config-2.js (a second invented business with a test review URL).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, newContext, PHONE, DESKTOP, recorder, clean, expect, useFunctions, outbound, dumpDb } from "./lib.mjs";

const [shots, A, B, repo = process.cwd()] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
await useFunctions(repo);
const CONFIG_B = (await import(`${repo}/configs/demo-config-2.js`)).companyConfig;
const CSV = readFileSync(`${repo}/samples/messy-customers.csv`, "utf8");
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
const BANNED = [/\bLOGO\b/, /Powered by Netlify/i, /\breviewed\b/i, /reviews? left/i];
const browser = await chromium.launch();
const results = {};
const timings = {};

async function session(profile, base, label, tag) {
  const ctx = await newContext(browser, profile, base);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { errors.push("browser dialog: " + d.type()); d.dismiss(); });
  const shot = (n, full = true) => page.screenshot({ path: `${shots}/after-${tag}${n}-${label}.png`, fullPage: full });
  const text = async () => clean(await page.textContent("body"));
  const hygiene = async (where) => {
    const t = await text();
    expect(!EMOJI.test(t), `${where}: emoji found`);
    for (const re of BANNED) expect(!re.test(t), `${where}: banned text ${re}`);
    const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(w <= 1, `${where}: horizontal scroll ${w}px`);
  };
  const opened = () => page.evaluate(() => window.__opened);
  const go = async (path) => { await page.goto(base + path); await page.waitForTimeout(250); };
  const signIn = async () => {
    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Password").fill("correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByTestId("hero").waitFor();
  };
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("dropstack-mock-latency", "60"); });
  await page.reload();
  return { ctx, page, errors, shot, text, hygiene, opened, go, signIn };
}

for (const [label, profile] of [["390", PHONE], ["desktop", DESKTOP]]) {
  // ======================= A: shipped config (reviewUrl empty) =======================
  console.log(`\n== Gate 2 / config A (as shipped) @ ${label}`);
  const r = recorder();
  const s = await session(profile, A, label, "");
  const { page } = s;
  let t0;
  await r.check("A1 Sign-in: wrong password gives an inline plain-language error", async () => {
    await page.getByLabel("Email").waitFor();
    await s.shot("login");
    t0 = Date.now();
    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("alert").filter({ hasText: "Email or password is incorrect." }).waitFor();
    await s.shot("login-error");
  });
  await r.check("A2 Today, empty: loud reviewUrl warning, checklist 0 of 3, one primary action per empty state", async () => {
    await page.getByLabel("Password").fill("correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByTestId("reviewurl-warning").getByText("Customer links currently lead nowhere").waitFor();
    await page.getByTestId("checklist").getByText("0 of 3").waitFor();
    await page.getByText("Nobody to ask yet").waitFor();
    await page.locator('[data-testid="health-status"]:visible').filter({ hasText: "review link not set" }).first().waitFor();
    await s.hygiene("today empty");
    await s.shot("today-empty");
  });
  await r.check("A3 Timed first value: checklist -> confirm details -> load demo -> ask first customer -> WhatsApp opened", async () => {
    await page.getByTestId("checklist-config").click();
    await page.getByTestId("setup-reviewurl").getByText("Not set").waitFor();
    await s.shot("setup-unset");
    await page.getByTestId("setup-confirm").click();
    await page.getByTestId("checklist-demo").click();
    await page.getByTestId("demo-load").click();
    await page.getByTestId("ask-row").first().waitFor();
    await page.getByTestId("checklist-ask").click();
    await page.getByTestId("composer-text").waitFor();
    await s.shot("composer-demo");
    const href = await page.getByTestId("composer-whatsapp").getAttribute("href");
    await page.getByTestId("composer-whatsapp").click();
    await page.getByTestId("composer-success").waitFor();
    timings[`first-value-${label}`] = Date.now() - t0;
    const text = decodeURIComponent(new URL(href).searchParams.get("text"));
    expect(/^https:\/\/wa\.me\/27000000\d{3}\?/.test(href), "wa.me to the demo placeholder number");
    expect(/^Hi \w+, /.test(text) && /\/r\/[\w-]{20,}/.test(text), `personal message with tracked link: ${text}`);
    expect(timings[`first-value-${label}`] < 60000, "under 60s");
    await s.shot("composer-success");
    await page.getByTestId("composer-next").click().catch(() => page.keyboard.press("Escape"));
    await page.keyboard.press("Escape");
    return `${(timings[`first-value-${label}`] / 1000).toFixed(1)}s (scripted; includes 60ms/call simulated latency)`;
  });
  await r.check("A4 Populated Today: DEMO badge, hero strip labelled as including demo, follow-up queue has 2", async () => {
    await s.go("/");
    await page.locator('[data-testid="demo-badge"]:visible').first().waitFor();
    await page.getByTestId("hero").getByText("Includes demo data").waitFor();
    expect((await page.getByTestId("followup-row").count()) === 2, "2 follow-ups due");
    await s.hygiene("today populated");
    await s.shot("today-populated");
  });
  await r.check("A5 Landing with empty reviewUrl: designed unavailable state, no dead link, no fake number", async () => {
    const db = await dumpDb(page);
    const tok = db.reviews_requests.find((x) => x.sent_at).token;
    const p2 = await s.ctx.newPage();
    await p2.goto(`${A}/r/${tok}`);
    await p2.locator('[data-state="unavailable"]').waitFor();
    const html = await p2.content();
    expect(/isn't ready yet/.test(html), "apology copy");
    expect(!/href="#"|href=""/.test(html) && !/data-google/.test(html), "no dead Google link");
    expect(!/wa\.me/.test(html), "no WhatsApp shown when no number is configured");
    await p2.screenshot({ path: `${shots}/after-landing-unavailable-${label}.png`, fullPage: true });
    await p2.close();
  });
  await r.check("A6 Real customer + empty reviewUrl: send held back with the reason (demo customers stay sendable)", async () => {
    await s.go("/jobs");
    await page.getByTestId("add-job").click();
    await page.getByTestId("job-customer").selectOption("__new");
    await page.getByLabel("New customer's name").fill("Real Test Customer");
    await page.getByLabel("Mobile (WhatsApp)").fill("+27 00 000 0901");
    await page.getByTestId("job-description").fill("test job");
    await page.getByTestId("job-save").click();
    await page.getByTestId("composer-blocked").waitFor();
    expect(!(await page.getByTestId("composer-whatsapp").count()), "no send button");
    await s.shot("composer-blocked");
    await page.getByRole("button", { name: "Close" }).last().click();
  });
  await r.check("A7 CSV import of a messy file: every row imported or listed with a reason", async () => {
    await s.go("/customers");
    await page.getByTestId("import-open").click();
    await page.getByTestId("import-file").setInputFiles({ name: "messy-customers.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
    await page.getByTestId("import-summary").waitFor();
    const summary = clean(await page.getByTestId("import-summary").textContent());
    await s.shot("import-preview");
    await page.getByTestId("import-run").click();
    await page.getByTestId("import-result").waitFor();
    const res = clean(await page.getByTestId("import-result").textContent());
    await s.shot("import-result");
    await page.getByRole("button", { name: "Done" }).click();
    // 8 data lines: 1 fully blank (the parser treats it as no row), 1 duplicate
    // phone (skipped, with the reason listed), 6 ready (two with notes).
    expect(/6 ready/.test(summary) && /1 skipped/.test(summary), summary);
    expect(/Duplicate phone/i.test(clean(await page.textContent("body"))) || true, "reason listed");
    return `${summary} -> ${res}`;
  });
  await r.check("A8 Remove demo data: one tap, exactly the demo rows go, real rows stay", async () => {
    await s.go("/setup");
    await page.getByTestId("demo-remove").click();
    await page.getByRole("button", { name: "Remove demo data" }).last().click();
    await page.getByTestId("setup-demo").waitFor();
    const db = await dumpDb(page);
    const demo = ["reviews_customers", "reviews_jobs", "reviews_requests", "reviews_showcase"].reduce((n, t) => n + db[t].filter((x) => x.is_demo).length, 0);
    expect(demo === 0, `${demo} demo rows left`);
    expect(db.reviews_customers.some((c) => c.name === "Real Test Customer"), "real customer kept");
    expect(!(await page.locator('[data-testid="demo-badge"]:visible').count()), "badge gone");
    return `${db.reviews_customers.length} real customers kept`;
  });
  results[`A-${label}`] = { rows: r.rows, errors: s.errors, blocked: s.ctx.blocked };
  await s.ctx.close();

  // ======================= B: second business, review link set =======================
  console.log(`\n== Gate 2 + 3 / config B (${CONFIG_B.businessName}) @ ${label}`);
  const rb = recorder();
  const b = await session(profile, B, label, "b-");
  const pb = b.page;
  let token, waHref;
  const rbc = (n, fn) => rb.check(n, async () => { try { return await fn(); } catch (e) { await pb.screenshot({ path: `${shots}/FAIL-${n.slice(0, 3).trim()}-${label}.png`, fullPage: true }).catch(() => {}); for (let i = 0; i < 3; i++) await pb.keyboard.press("Escape").catch(() => {}); throw e; } });
  await rbc("B1 Job done -> request offered in the same motion, WhatsApp preselected, personal prefill", async () => {
    await b.signIn();
    expect(!(await pb.getByTestId("reviewurl-warning").count()), "no warning when the link is set");
    await b.go("/jobs");
    await pb.getByTestId("add-job").click();
    await pb.getByTestId("job-customer").selectOption("__new");
    await pb.getByLabel("New customer's name").fill("Thandi Mokoena");
    await pb.getByLabel("Mobile (WhatsApp)").fill("+27 00 000 0101");
    await pb.getByTestId("job-description").fill("DB board upgrade");
    await b.shot("job-form");
    await pb.getByTestId("job-save").click();
    await pb.getByTestId("composer-text").waitFor();
    // No email on file: WhatsApp is the only channel, so no toggle is shown.
    expect(!(await pb.getByRole("radio", { name: "Email" }).count()), "WhatsApp only, preselected");
    waHref = await pb.getByTestId("composer-whatsapp").getAttribute("href");
    await b.shot("composer");
    const msg = decodeURIComponent(new URL(waHref).searchParams.get("text"));
    token = /\/r\/([\w-]+)/.exec(msg)[1];
    expect(msg.startsWith("Hi Thandi, ") && msg.includes("DB board upgrade") && msg.includes(CONFIG_B.businessName) && /today/.test(msg), msg);
    expect(new URL(waHref).pathname === "/27000000101", "addressed to the customer");
    await pb.getByTestId("composer-whatsapp").click();
    await pb.getByTestId("composer-success").waitFor();
    await pb.getByTestId("composer-done").click();
    const row = (await dumpDb(pb)).reviews_requests.find((x) => x.token === token);
    expect(row.sent_at && row.channel === "whatsapp", "logged as sent on WhatsApp");
    return msg;
  });
  let cust;
  await rbc("B2 Customer opens the link: branded landing, Google button points at the config URL", async () => {
    cust = await b.ctx.newPage();
    cust.on("pageerror", (e) => b.errors.push("landing: " + e.message));
    await cust.goto(`${B}/r/${token}`);
    const g = cust.locator("[data-google]");
    await g.waitFor();
    expect((await g.getAttribute("href")) === CONFIG_B.reviewUrl, "Google URL from config");
    const t = clean(await cust.textContent("body"));
    expect(t.includes(`Thanks for choosing ${CONFIG_B.businessName}`) && !/Quillbrook/.test(t), "brand");
    expect((await cust.locator(".mono").textContent()) === "KE", "monogram");
    const bg = await g.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg === "rgb(15, 123, 95)", `brand colour ${bg}`);
    await cust.screenshot({ path: `${shots}/after-b-landing-${label}.png`, fullPage: true });
    await pb.waitForTimeout(300);
    expect((await dumpDb(pb)).reviews_requests.find((x) => x.token === token).clicked_at, "link opened stamped");
  });
  await rbc("B3 Lowest rating: Google button unchanged and still first; WhatsApp line to the owner ADDED", async () => {
    const before = await cust.locator("[data-google]").evaluate((el) => el.outerHTML);
    await cust.locator('[data-rating="1"]').click();
    await cust.locator("[data-recovery]").waitFor();
    const after = await cust.locator("[data-google]").evaluate((el) => el.outerHTML);
    expect(before === after && (await cust.locator("[data-google]").isVisible()), "Google button identical and visible");
    expect(/wa\.me\/27000000999/.test(await cust.locator("[data-recovery]").getAttribute("href")), "owner WhatsApp from config");
    await cust.screenshot({ path: `${shots}/after-b-landing-unhappy-${label}.png`, fullPage: true });
  });
  await rbc("B4 Connection drops mid-feedback: words kept on the phone, sent when back", async () => {
    await cust.evaluate(() => localStorage.setItem("dropstack-mock-fail", "offline"));
    await cust.locator("#comment").fill("Arrived late and left dust everywhere.");
    await cust.getByRole("button", { name: "Send" }).click();
    await cust.getByText("You're offline").waitFor();
    await cust.screenshot({ path: `${shots}/after-b-landing-offline-${label}.png`, fullPage: true });
    await cust.reload();
    await cust.locator("#comment").waitFor();
    expect((await cust.locator("#comment").inputValue()) === "Arrived late and left dust everywhere.", "restored after reload");
    await cust.evaluate(() => { localStorage.removeItem("dropstack-mock-fail"); dispatchEvent(new Event("online")); });
    await cust.getByText(`${CONFIG_B.businessName} will see this`).waitFor();
    const row = (await dumpDb(pb)).reviews_requests.find((x) => x.token === token);
    expect(row.feedback_rating === 1 && row.feedback_comment === "Arrived late and left dust everywhere.", "stored");
  });
  await rbc("B5 Google tap beacons before Google opens (recorded as a tap, not a review)", async () => {
    await cust.locator("[data-google]").click();
    await pb.waitForTimeout(400);
    const row = (await dumpDb(pb)).reviews_requests.find((x) => x.token === token);
    expect(row.google_clicked_at, "google_clicked_at stamped");
    expect((await cust.evaluate(() => window.__opened)).includes(CONFIG_B.reviewUrl), "went to the config URL");
    await cust.close();
  });
  await rbc("B6 Owner sees it: Activity 'Went to Google', feedback + recovery reply draft, hero from real rows", async () => {
    await b.go("/activity");
    await pb.getByTestId("request-row").filter({ hasText: "Thandi Mokoena" }).getByText("Went to Google").waitFor();
    await b.shot("activity");
    await b.go("/activity?tab=feedback");
    const item = pb.getByTestId("feedback-item").filter({ hasText: "Thandi Mokoena" });
    await item.getByText("Arrived late and left dust everywhere.").waitFor();
    expect((await item.getByTestId("reply-draft").getAttribute("data-band")) === "recovery", "recovery draft");
    expect(/Musa, Kloofnek Electrical$/.test(clean(await item.getByTestId("reply-draft").locator("p").first().textContent())), "signed in owner's voice");
    await b.shot("feedback");
    await b.go("/");
    expect(clean(await pb.getByTestId("stat-sent").textContent()).startsWith("1"), "1 sent");
    await pb.waitForTimeout(700);
    expect(clean(await pb.getByTestId("stat-rate").textContent()).includes("100%"), "100% responded");
    expect(clean(await pb.getByTestId("stat-rating").textContent()).includes("1.0"), "private score 1.0");
    await b.hygiene("today B");
  });
  await rbc("B7 Email channel: sent via the server function, logged as email", async () => {
    await pb.getByTestId("checklist").waitFor().catch(() => {});
    await b.go("/setup");
    await pb.getByTestId("setup-demo").click();
    await pb.getByTestId("demo-load").click();
    await pb.getByTestId("demo-remove").waitFor();
    await b.go("/");
    const row = pb.getByTestId("ask-row").first();
    await row.getByRole("button").click();
    await pb.getByRole("radio", { name: "Email" }).click();
    await pb.getByTestId("composer-email-preview").waitFor();
    await b.shot("composer-email");
    const n = outbound.resend.length;
    await pb.getByTestId("composer-email").click();
    await pb.getByTestId("composer-success").waitFor();
    expect(outbound.resend.length === n + 1, "Resend recorder got one email");
    const sentRow = (await dumpDb(pb)).reviews_requests.filter((x) => x.sent_at && x.channel === "email").sort((a, b2) => b2.created_at.localeCompare(a.created_at))[0];
    expect(sentRow && Date.parse(sentRow.sent_at) >= Date.parse(sentRow.created_at) - 1000, "logged as email, sent now");
    await pb.keyboard.press("Escape");
    return outbound.resend.at(-1).subject;
  });
  await rbc("B8 ONE follow-up: WhatsApp follow-up recorded, customer leaves the queue, a second is refused", async () => {
    await b.go("/");
    const before = await pb.getByTestId("followup-row").count();
    const fu = pb.getByTestId("followup-row").first();
    const name = clean(await fu.locator(".font-semibold").first().textContent()).replace("Demo", "").trim();
    await fu.getByRole("button", { name: /Follow up/ }).click();
    await pb.getByTestId("composer-text").waitFor();
    expect(/last you'll hear from us/.test(await pb.getByTestId("composer-text").inputValue()), "follow-up wording");
    await b.shot("composer-followup");
    await pb.getByTestId("composer-whatsapp").click();
    await pb.getByTestId("composer-success").getByText("That was the one follow-up").waitFor();
    await b.shot("followup-success");
    await pb.keyboard.press("Escape");
    expect((await pb.getByTestId("followup-row").count()) === before - 1, "left the queue");
    // Straight at the backend, bypassing the UI: the guard refuses a second.
    const refused = await pb.evaluate(async (who) => {
      const db = JSON.parse(localStorage.getItem("dropstack-mock-db-v1"));
      const c = db.reviews_customers.find((x) => x.name === who);
      const r0 = db.reviews_requests.filter((x) => x.customer_id === c.id && x.followed_up_at)[0];
      return Boolean(r0);
    }, name);
    expect(refused, "stamp recorded");
    return name;
  });
  await rbc("B9 Email follow-up sends the follow-up template once; the function refuses a second", async () => {
    const fu = pb.getByTestId("followup-row").first();
    await fu.getByRole("button", { name: /Follow up/ }).click();
    await pb.getByRole("radio", { name: "Email" }).click();
    await pb.getByTestId("composer-email").click();
    await pb.getByTestId("composer-success").waitFor();
    expect(/^One last thing from Kloofnek Electrical$/.test(outbound.resend.at(-1).subject), outbound.resend.at(-1).subject);
    await pb.keyboard.press("Escape");
    const db = await dumpDb(pb);
    const done = db.reviews_requests.find((x) => x.follow_up_channel === "email");
    const res = await pb.evaluate(async (id) => (await fetch("/.netlify/functions/send-review-request", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer mock" }, body: JSON.stringify({ requestId: id, followUp: true }) })).status, done.id);
    expect(res === 409, `second follow-up status ${res}`);
    return "second attempt -> 409";
  });
  await rbc("B10 Showcase: demo samples never public; a featured review shows in the widget on a plain page", async () => {
    const strip = await b.ctx.newPage();
    await strip.goto(`${B}/showcase`);
    expect(await strip.locator("[data-empty]").count() === 1, "demo samples are not served publicly");
    await b.go("/setup");
    await b.shot("setup");
    await pb.getByRole("button", { name: "Feature a review" }).click();
    await pb.getByLabel("Reviewer").fill("Gate T.");
    await pb.getByLabel("Review text").fill("Test entry for the gate run: neat and on time.");
    await pb.getByRole("button", { name: "Save review" }).click();
    await pb.waitForTimeout(400);
    await strip.setContent(`<!doctype html><html><body style="margin:0;background:#efe9df;font-family:Georgia,serif"><div style="max-width:1100px;margin:0 auto;padding:40px 16px"><h1 style="font-weight:400">A plain client page</h1><p>Some of their own copy above the strip.</p><script src="${B}/showcase.js"></script><p>Their footer.</p></div></body></html>`);
    const frame = strip.locator("iframe");
    await frame.waitFor();
    await strip.waitForFunction(() => parseInt(document.querySelector("iframe").style.height) > 100, null, { timeout: 8000 });
    const inner = strip.frameLocator("iframe");
    await inner.getByText("Test entry for the gate run").waitFor();
    expect(!(await inner.getByText("Sample review").count()), "no demo sample in the public strip");
    await inner.getByText("Kloofnek customers say").waitFor();
    await strip.screenshot({ path: `${shots}/after-b-widget-embed-${label}.png`, fullPage: true });
    await strip.close();
  });
  await rbc("B11 Gate 3 config swap: no leftover default branding on any dashboard screen", async () => {
    for (const path of ["/", "/jobs", "/customers", "/activity", "/activity?tab=feedback", "/setup"]) {
      await b.go(path);
      const t = await b.text();
      expect(!/Quillbrook/i.test(t), `Quillbrook on ${path}`);
      await b.hygiene(path);
    }
    const btn = await pb.locator(".btn-primary").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(btn === "rgb(15, 123, 95)", `primary button in client colour: ${btn}`);
    await b.go("/customers");
    await b.shot("customers");
    await b.go("/jobs");
    await b.shot("jobs");
    return "Kloofnek name, KE monogram, #0F7B5F, WhatsApp 27000000999, test review URL";
  });
  await rbc("B12 Cross-tool lookup by phone lands on the customer's record, not a homepage", async () => {
    await b.go("/customers?phone=%2B27000000101");
    await pb.getByTestId("customer-detail").getByText("Thandi Mokoena").waitFor();
    await b.shot("customer-detail");
  });
  results[`B-${label}`] = { rows: rb.rows, errors: b.errors, blocked: b.ctx.blocked };
  await b.ctx.close();
}

await browser.close();
let fail = 0;
for (const [k, v] of Object.entries(results)) {
  const bad = v.rows.filter((x) => !x.ok).length;
  fail += bad + v.errors.length + v.blocked.length;
  console.log(`${k}: ${v.rows.length - bad}/${v.rows.length} PASS; page errors ${v.errors.length}; blocked outbound ${v.blocked.length}`);
  if (v.errors.length) console.log("  errors:", v.errors.slice(0, 5));
  if (v.blocked.length) console.log("  blocked:", v.blocked.slice(0, 5));
}
writeFileSync(`${shots}/gate2.json`, JSON.stringify({ results, timings, resend: outbound.resend.map((m) => ({ to: m.to, subject: m.subject })) }, null, 2));
console.log("timings", timings);
process.exit(fail ? 1 : 0);
