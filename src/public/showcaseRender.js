// HTML for the showcase strip (framed on the client's mini-site by
// /showcase.js). Pre-rendered at build from config; the page script then adds
// the owner's dashboard-entered reviews. Hand-entered REAL reviews only: the
// strip renders nothing at all when there are none, rather than filler.
import { mergeShowcase, stars } from "../lib/showcase.js";
import { googleButton } from "./landing.js";
import { esc } from "./render.js";

const STAR = (on) => `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" class="${on ? "on" : "off"}"><path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.6l-5 2.6.9-5.6-4-3.9 5.6-.8z"/></svg>`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (d) => { const [y, m] = String(d).split("-"); return MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : ""; };

export function renderShowcase(config, configReviews = [], dbReviews = []) {
  const list = mergeShowcase(configReviews, dbReviews);
  if (list.length === 0) return `<main class="strip" data-empty></main>`;
  const google = googleButton(config?.reviewUrl);
  const cards = list.map((r) => {
    const s = stars(r.rating);
    return `<figure class="card" role="listitem">
  <div class="stars" role="img" aria-label="${s.label}">${STAR(true).repeat(s.filled)}${STAR(false).repeat(s.empty)}</div>
  <blockquote>${esc(r.body)}</blockquote>
  <figcaption><span class="who">${esc(r.author)}</span>${r.date ? `<span class="when">${fmt(r.date)}</span>` : ""}</figcaption>
</figure>`;
  }).join("\n");
  return `<main class="strip">
<h2>${esc(config?.showcase?.title || "What customers say")}</h2>
<div class="row" role="list">${cards}</div>
${google ? `<p class="more"><a href="${esc(google.href)}" target="_blank" rel="noopener">Leave ${esc(config?.businessName)} a review on Google</a></p>` : ""}
</main>`;
}

export function showcaseTitle(config) {
  return `Reviews · ${String(config?.businessName ?? "").trim()}`;
}
