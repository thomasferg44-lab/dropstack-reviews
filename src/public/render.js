// HTML for the public review landing. Pure strings, no DOM: the build step
// (vite.config.js) pre-renders r.html with it, so the client's name, colours
// and the Google button are in the very first byte of HTML (no colour flash,
// no spinner, nothing to wait for on a weak signal), and the page script uses
// the same functions to update the feedback step in place.
//
// The Google button is rendered from config alone and comes BEFORE the
// optional feedback question. No rating can remove it (landing.test.js).
import { landingModel, unavailableModel, RATINGS } from "./landing.js";
import { brandInk, initials } from "../lib/brand.js";

export const esc = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const HEX = /^#[0-9a-f]{6}$|^#[0-9a-f]{3}$/i;
export function brandCss(config) {
  const brand = HEX.test(String(config?.primaryColor ?? "")) ? config.primaryColor : "#1d1d1f";
  return `--brand: ${brand}; --brand-ink: ${brandInk(brand)};`;
}

const ICON = {
  star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.6l-5 2.6.9-5.6-4-3.9 5.6-.8z"/>',
  chat: '<path d="M4.5 18.5l1.2-3.6A7.5 7.5 0 1112 19.5a7.6 7.6 0 01-3.9-1.1L4.5 18.5z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
export const icon = (name, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

export function brandHeader(config) {
  const name = String(config?.businessName ?? "").trim();
  const mark = config?.logoUrl
    ? `<img class="logo" src="${esc(config.logoUrl)}" alt="${esc(name)}" width="160" height="48" decoding="async" data-logo><span class="mono" data-mono hidden aria-hidden="true">${esc(initials(name))}</span>`
    : `<span class="mono" role="img" aria-label="${esc(name)}">${esc(initials(name))}</span>`;
  return `<header class="brand">${mark}<p class="biz">${esc(name)}</p></header>`;
}

/** The part below the scale that changes as the customer answers. */
export function renderAfter(config, { rating = null, status = "idle", comment = "" } = {}) {
  const m = landingModel({ config, rating });
  if (!m.thanks) return "";
  const saved =
    status === "queued" ? `<p class="status warn" role="status">You're offline. Your answer is saved on this phone and will send when you're back online.</p>`
    : status === "failed" ? `<p class="status warn" role="status">We couldn't save that just now. Your words are kept on this phone; tap Send to try again.</p>`
    : status === "invalid" ? `<p class="status warn" role="status">We couldn't match this link to a job, so your answer wasn't saved. The Google button above still works.</p>`
    : status === "sent" ? `<p class="status good" role="status">${icon("check", 16)}<span>Thanks, ${esc(config?.businessName)} will see this.</span></p>`
    : "";
  const recovery = m.recovery
    ? `<a class="btn-quiet" href="${esc(m.recovery.href)}" target="_blank" rel="noopener" data-recovery>${icon("chat")}<span>${esc(m.recovery.label)}</span></a>`
    : "";
  return `<p class="thanks">${esc(m.thanks)}</p>
${recovery}
<form class="words" data-words novalidate>
  <label for="comment">Anything you'd like to tell us? <span class="opt">(optional)</span></label>
  <textarea id="comment" name="comment" rows="3" maxlength="1000" data-comment>${esc(comment)}</textarea>
  <button type="submit" class="btn-send">Send</button>
</form>
${saved}`;
}

export function renderLanding(config, state = {}) {
  const name = String(config?.businessName ?? "").trim() || "us";
  const m = landingModel({ config, rating: state.rating ?? null });
  const head = `${brandHeader(config)}
<h1>Thanks for choosing ${esc(name)}</h1>`;
  const foot = `<footer class="foot">Powered by DropStack</footer>`;

  if (m.unavailable) {
    const u = unavailableModel(config);
    return `<main class="sheet" data-state="unavailable">
${head}
<p class="lede">Our review page isn't ready yet. Sorry about that, and thank you for wanting to leave one.</p>
${u.whatsapp
  ? `<a class="btn-primary" href="${esc(u.whatsapp.href)}" target="_blank" rel="noopener" data-fallback>${icon("chat")}<span>${esc(u.whatsapp.label)}</span></a>
<p class="note">A message is the quickest way to tell us how it went.</p>`
  : `<p class="note">Please try this link again in a day or two.</p>`}
${foot}
</main>`;
  }

  const scale = RATINGS.map((r) =>
    `<button type="button" role="radio" aria-checked="${state.rating === r.value}" data-rating="${r.value}" aria-label="${r.value}: ${r.label}"><span class="n">${r.value}</span><span class="l">${r.label}</span></button>`
  ).join("");

  return `<main class="sheet" data-state="ready">
${head}
<p class="lede">If you have a minute, a short Google review helps other people find a business they can trust.</p>
<a class="btn-primary" href="${esc(m.google.href)}" target="_blank" rel="noopener" data-google>${icon("star")}<span>${esc(m.google.label)}</span></a>
<p class="note">Opens Google. It takes about a minute.</p>
<section class="ask" aria-labelledby="ask-h">
  <h2 id="ask-h">How was your experience?</h2>
  <p class="sub">Optional. Only ${esc(name)} sees your answer.</p>
  <div class="scale" role="radiogroup" aria-labelledby="ask-h">${scale}</div>
  <div class="after" data-after aria-live="polite">${renderAfter(config, state)}</div>
</section>
${foot}
</main>`;
}

/**
 * Fills a page template at build time (vite.config.js). Markers:
 *   <!--brand-->  the client's colours as CSS variables, before first paint
 *   <!--body-->   the pre-rendered page body
 *   %TITLE%       the document title
 */
export function fillTemplate(html, { body, title, config }) {
  return String(html)
    .replace("<!--brand-->", `<style>:root{${brandCss(config)}}</style>`)
    .replace("<!--body-->", body)
    .replace(/%TITLE%/g, esc(title));
}

export function landingTitle(config) {
  const name = String(config?.businessName ?? "").trim();
  return name ? `Thank you · ${name}` : "Thank you";
}
