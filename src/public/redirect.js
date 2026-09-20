import { companyConfig } from "../../companyConfig.js";
import { tokenFromPath, redirectTarget, stampRequest } from "./redirectLogic.js";

// The public page a customer lands on from a review request.
//
// It deliberately does NOT use React or supabase-js. Those cost roughly 70KB
// gzipped for a page whose entire job is one fetch and one redirect, and the
// spec is explicit that every second of friction here loses reviews. The dashboard
// keeps the full stack; this page is its own Vite entry with its own tiny bundle.
//
// It also asks the customer nothing. There is no satisfaction step and no branch:
// everyone who opens this link goes to the same public review page.

const REDIRECT_DELAY_MS = 2000;

const el = (id) => document.getElementById(id);

function applyBranding() {
  const root = document.documentElement.style;
  if (companyConfig.primaryColor) root.setProperty("--brand", companyConfig.primaryColor);
  if (companyConfig.accentColor) root.setProperty("--accent", companyConfig.accentColor);

  const name = String(companyConfig.businessName ?? "").trim();
  if (name) {
    el("heading").textContent = `Thanks for choosing ${name}`;
    document.title = `Thanks — ${name}`;
  }

  const logo = el("logo");
  if (companyConfig.logoUrl) {
    logo.alt = name || "";
    logo.src = companyConfig.logoUrl;
    logo.hidden = false;
    // A broken logo path should not leave a torn layout on a customer's phone.
    logo.addEventListener("error", () => { logo.hidden = true; }, { once: true });
  }
}

// Fire-and-forget. The redirect never waits on this: if Supabase is slow or down,
// the customer still reaches the review page. Tracking is our problem, not theirs.
function stampClick(token) {
  const req = stampRequest({
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    token,
  });
  if (!req) return;
  fetch(req.url, req.options).catch(() => {});
}

function main() {
  applyBranding();

  const target = redirectTarget(companyConfig.reviewUrl);
  const cta = el("cta");

  if (target.error) {
    // Should be unreachable: the dashboard refuses to send while reviewUrl is unset.
    cta.classList.add("hidden");
    el("blurb").textContent = "This link isn’t available right now. Sorry about that.";
    el("note").textContent = "";
    return;
  }

  cta.href = target.url;

  const token = tokenFromPath(window.location.pathname);
  if (token) stampClick(token);

  el("note").textContent = "Taking you there now…";

  // replace(), not assign(): otherwise Back lands here again and bounces the
  // customer straight back out, which feels like a trap.
  const go = () => window.location.replace(target.url);
  const timer = setTimeout(go, REDIRECT_DELAY_MS);

  // Tapping the button should win immediately rather than racing the timer.
  cta.addEventListener("click", () => clearTimeout(timer));
}

main();
