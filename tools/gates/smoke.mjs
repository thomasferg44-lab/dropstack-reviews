import { chromium, newContext, PHONE, useFunctions } from "./lib.mjs";
const [base, out] = process.argv.slice(2);
await useFunctions(process.cwd());
const b = await chromium.launch();
const ctx = await newContext(b, PHONE, base);
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto(base); await p.evaluate(() => localStorage.setItem("dropstack-mock-latency", "30"));
await p.getByLabel("Email").fill("test@example.com"); await p.getByLabel("Password").fill("x");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForTimeout(1500); await p.screenshot({ path: out + "/smoke-today.png", fullPage: true });
await p.getByTestId("checklist-demo").click().catch((e) => errs.push("no demo btn " + e.message));
await p.waitForTimeout(500); await p.getByTestId("demo-load").click().catch((e) => errs.push(e.message));
await p.waitForTimeout(1500); await p.screenshot({ path: out + "/smoke-demo.png", fullPage: true });
for (const r of ["/jobs", "/customers", "/activity", "/activity?tab=feedback", "/setup"]) {
  await p.goto(base + r); await p.waitForTimeout(800); await p.screenshot({ path: out + `/smoke${r.replace(/[/?=]/g, "_")}.png`, fullPage: true });
}
const tok = await p.evaluate(() => JSON.parse(localStorage.getItem("dropstack-mock-db-v1")).reviews_requests[0].token);
await p.goto(base + "/r/" + tok); await p.waitForTimeout(500); await p.screenshot({ path: out + "/smoke-landing.png", fullPage: true });
console.log("errors:", errs, "blocked:", ctx.blocked);
await b.close();
