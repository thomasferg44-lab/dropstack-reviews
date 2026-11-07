// Gate 0 (design spec §6): the Reviews flow on the CURRENT (v1, 238cdc7) UI,
// built with only the local test backend copied in, plus the "before"
// screenshots for the review pack.
//   node tools/gates/baseline.mjs <shotsDir> <base>
import { mkdirSync } from "node:fs";
import { chromium, newContext, PHONE, DESKTOP, recorder, expect, dumpDb } from "./lib.mjs";
const [shots, base] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
for (const [label, profile] of [["390", PHONE], ["desktop", DESKTOP]]) {
  console.log(`\n== Gate 0 baseline @ ${label}`);
  const r = recorder();
  const ctx = await newContext(browser, profile, base);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: `${shots}/before-${n}-${label}.png`, fullPage: true });
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("dropstack-mock-latency", "30"); });
  await page.reload();
  await r.check("0.1 sign in", async () => {
    await shot("login");
    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Password").fill("x");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Ask now").first().waitFor();
    await shot("today-empty");
  });
  await r.check("0.2 add customer + log a completed job", async () => {
    await page.getByRole("button", { name: "Customers" }).click();
    await page.waitForTimeout(400);
    await shot("customers-empty");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.locator("#cf-name").fill("Thandi Mokoena");
    await page.locator("#cf-phone").fill("+27 00 000 0101");
    await page.locator("form").getByRole("button", { name: "Add customer" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Jobs" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Log job" }).click();
    await page.locator("#jf-customer").selectOption({ index: 1 });
    await page.locator("#jf-desc").fill("geyser replacement");
    await page.locator("form").getByRole("button", { name: "Log job" }).click();
    await page.waitForTimeout(400);
    await shot("jobs");
  });
  await r.check("0.3 Ask now lists the customer; sends are disabled while reviewUrl is empty", async () => {
    await page.getByRole("button", { name: "Ask now" }).click();
    await page.waitForTimeout(500);
    await shot("ask-now");
    const t = await page.textContent("body");
    expect(/No Google review link is set/.test(t), "v1 warns and disables sends when reviewUrl is empty");
    return "v1 disables both buttons while reviewUrl is empty, as the live demo is today";
  });
  await r.check("0.4 landing on the v1 UI (empty reviewUrl)", async () => {
    await page.goto(base + "/r/sometokenvalue123");
    await page.waitForTimeout(500);
    await shot("landing");
    const t = await page.textContent("body");
    return /isn’t available|isn't available/.test(t) ? "shows 'This link isn't available right now', no fallback" : t.slice(0, 80);
  });
  console.log(`errors: ${errors.length}`, errors.slice(0, 3));
  await ctx.close();
}
await browser.close();
