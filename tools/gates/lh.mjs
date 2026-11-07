// Gate 5: Lighthouse (mobile) on the local production-style build (gzip
// server), 3 runs per page, lowest kept; plus a Fast-3G (devtools-throttled)
// run on the customer landing. Every non-localhost host is unresolvable.
//   LIGHTHOUSE_CLI=/path/to/lighthouse/cli/index.js node tools/gates/lh.mjs <outDir> <base>
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "./lib.mjs";
const run = promisify(execFile);
const [OUT, BASE] = process.argv.slice(2);
const PORT = 9334;
const LH = process.env.LIGHTHOUSE_CLI;
mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(OUT + "/profile", { headless: true, args: [`--remote-debugging-port=${PORT}`, "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"] });
let page = await ctx.newPage();
await page.goto(BASE + "/");
// Seed: demo data + a session, so the dashboard measures a populated Today.
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("dropstack-mock-latency", "120"); });
await page.reload();
await page.getByLabel("Email").fill("owner@example.com");
await page.getByLabel("Password").fill("x");
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByTestId("hero").waitFor();
await page.goto(BASE + "/setup");
await page.getByTestId("setup-demo").click();
await page.getByTestId("demo-load").click();
await page.getByTestId("demo-remove").waitFor();
const token = await page.evaluate(() => JSON.parse(localStorage.getItem("dropstack-mock-db-v1")).reviews_requests.find((r) => r.sent_at).token);
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.clearBrowserCache");
await page.close();

async function lighthouse(url, name, extra = []) {
  const out = `${OUT}/${name}.json`;
  await run("node", [LH, url, `--port=${PORT}`, "--disable-storage-reset", "--only-categories=performance,accessibility,best-practices",
    "--output=json", `--output-path=${out}`, "--quiet", "--chrome-flags=--headless", ...extra], { timeout: 240000, maxBuffer: 1 << 26 });
  const r = JSON.parse(readFileSync(out, "utf8"));
  const a = r.audits;
  return {
    perf: Math.round(r.categories.performance.score * 100),
    a11y: Math.round(r.categories.accessibility.score * 100),
    bp: Math.round(r.categories["best-practices"].score * 100),
    lcp: Math.round(a["largest-contentful-paint"].numericValue),
    fcp: Math.round(a["first-contentful-paint"].numericValue),
    tbt: Math.round(a["total-blocking-time"].numericValue),
    cls: a["cumulative-layout-shift"].numericValue,
    weightKB: Math.round(a["total-byte-weight"].numericValue / 1024),
    lcpEl: a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? "",
    failedA11y: Object.values(a).filter((x) => x.score === 0 && r.categories.accessibility.auditRefs.some((ref) => ref.id === x.id)).map((x) => x.id),
  };
}
const summary = { token: "seeded demo request" };
for (const [name, path] of [["landing", `/r/${token}`], ["dashboard-today", "/"]]) {
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await lighthouse(BASE + path, `${name}-run${i + 1}`));
  summary[name] = { runs, lowestPerf: Math.min(...runs.map((r) => r.perf)) };
  console.log(name, JSON.stringify(runs.map((r) => [r.perf, r.lcp, r.weightKB])), "lowest", summary[name].lowestPerf, "| a11y", runs[0].a11y, runs[0].failedA11y.join(","), "| LCP el:", runs[0].lcpEl.slice(0, 90));
}
// Fast 3G, classic DevTools preset (1.6 Mbps down / 750 Kbps up / 562.5 ms RTT, 4x CPU), applied for real.
const runs = [];
for (let i = 0; i < 3; i++) {
  runs.push(await lighthouse(`${BASE}/r/${token}`, `landing-fast3g-run${i + 1}`, ["--throttling-method=devtools",
    "--throttling.requestLatencyMs=562.5", "--throttling.downloadThroughputKbps=1600", "--throttling.uploadThroughputKbps=750", "--throttling.cpuSlowdownMultiplier=4"]));
}
summary.landing_fast3g = { runs, worstLcp: Math.max(...runs.map((r) => r.lcp)) };
console.log("landing fast3g LCP", runs.map((r) => r.lcp), "worst", summary.landing_fast3g.worstLcp, "weight KB", runs[0].weightKB, "| LCP el:", runs[0].lcpEl.slice(0, 80));
writeFileSync(`${OUT}/gate5-summary.json`, JSON.stringify(summary, null, 2));
await ctx.close();
