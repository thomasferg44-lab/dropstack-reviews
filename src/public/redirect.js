// The public review landing (/r/:token). The page arrives fully rendered and
// branded from the build (src/public/render.js); this script only:
//   1. stamps "link opened" (fire-and-forget; the page never waits on it)
//   2. beacons "tapped the Google button" before Google opens
//   3. runs the optional feedback step, keeping the customer's words on the
//      phone until the server has them (a dropped signal loses nothing)
//
// No React, no supabase-js: this is the customer's surface on prepaid data.
// The Google button is never touched by this script: it is the same for
// everyone, whatever they answer (see landing.js / landing.test.js).
import { companyConfig } from "../../companyConfig.js";
import { tokenFromPath, stampRequest } from "./redirectLogic.js";
import { feedbackRequest, googleClickRequest, readDraft, writeDraft, validRating } from "./landing.js";
import { renderAfter } from "./render.js";
import { mockPublicRpc } from "../dev/mockPublic.js";

const MOCK = import.meta.env.VITE_MOCK_BACKEND === "1";
const env = { supabaseUrl: import.meta.env.VITE_SUPABASE_URL, anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY };
const $ = (sel) => document.querySelector(sel);
const token = tokenFromPath(window.location.pathname);
let storage = null;
try { storage = window.localStorage; } catch { storage = null; }

/** Returns "ok" | "invalid" (server said no such token) | "offline" | "failed". */
async function call(req, fn, body) {
  if (MOCK) return mockPublicRpc(fn, body);
  if (!req) return "failed";
  try {
    const res = await fetch(req.url, req.options);
    if (!res.ok) return "failed";
    return (await res.json().catch(() => null)) === true ? "ok" : "invalid";
  } catch {
    return navigator.onLine === false ? "offline" : "failed";
  }
}

// ---- 1. link opened ---------------------------------------------------------
if (token) call(stampRequest({ ...env, token }), "reviews_open_link", { p_token: token });

// A broken logo URL must not leave a torn header: fall back to the monogram.
const logo = $("[data-logo]");
if (logo) {
  const fallback = () => { logo.hidden = true; const m = $("[data-mono]"); if (m) { m.hidden = false; m.removeAttribute("aria-hidden"); m.setAttribute("role", "img"); m.setAttribute("aria-label", companyConfig.businessName ?? ""); } };
  if (logo.complete && logo.naturalWidth === 0) fallback();
  else logo.addEventListener("error", fallback, { once: true });
}

// ---- 2. Google tap ----------------------------------------------------------
// keepalive lets the beacon finish after Google opens. We record a tap, never
// "reviewed": Google tells nobody whether a review was actually written.
$("[data-google]")?.addEventListener("click", () => {
  if (token) call(googleClickRequest({ ...env, token }), "reviews_google_click", { p_token: token });
});

// ---- 3. optional feedback ---------------------------------------------------
const after = $("[data-after]");
let state = { rating: null, comment: "", status: "idle" };

function paint() {
  for (const b of document.querySelectorAll("[data-rating]")) b.setAttribute("aria-checked", String(Number(b.dataset.rating) === state.rating));
  const focused = document.activeElement?.id === "comment";
  after.innerHTML = renderAfter(companyConfig, state);
  if (focused) $("#comment")?.focus();
}

function save(pending) {
  if (token) writeDraft(storage, token, { rating: state.rating, comment: state.comment, pending, sent: !pending && state.status === "sent" });
}

async function submit({ withComment }) {
  if (!token || !state.rating) return;
  save(true);
  const comment = withComment ? state.comment : null;
  const result = await call(feedbackRequest({ ...env, token, rating: state.rating, comment }), "reviews_submit_feedback",
    { p_token: token, p_rating: state.rating, p_comment: comment });
  if (result === "ok") {
    state.status = withComment ? "sent" : "idle";
    save(false);
  } else {
    state.status = result === "invalid" ? "invalid" : result === "offline" ? "queued" : "failed";
    if (result === "invalid") save(false);
  }
  paint();
}

if (after) {
  document.querySelector(".scale")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rating]");
    if (!b) return;
    state.rating = validRating(b.dataset.rating);
    state.status = "idle";
    paint();
    submit({ withComment: Boolean(state.comment.trim()) });
  });
  after.addEventListener("input", (e) => {
    if (e.target.matches("[data-comment]")) { state.comment = e.target.value; save(true); }
  });
  after.addEventListener("submit", (e) => {
    e.preventDefault();
    submit({ withComment: true });
  });

  // Back after a dropped connection or a reload: restore their words, and
  // finish sending anything that didn't get through.
  const draft = token ? readDraft(storage, token) : null;
  if (draft?.rating) {
    state = { rating: draft.rating, comment: draft.comment, status: draft.sent ? "sent" : "idle" };
    paint();
    if (draft.pending) submit({ withComment: Boolean(draft.comment.trim()) });
  }
  window.addEventListener("online", () => {
    const d = token ? readDraft(storage, token) : null;
    if (d?.pending && state.rating) submit({ withComment: Boolean(state.comment.trim()) });
  });
}
