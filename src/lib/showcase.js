// The embeddable showcase strip: featured reviews the owner hand-entered
// (copied from their Google profile), from config and/or the dashboard.
// No invented testimonials: config ships empty, and demo rows are never
// served to the public widget (reviews_showcase_list() excludes them).

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function normaliseReview(r) {
  const rating = Math.round(Number(r?.rating));
  const author = clean(r?.author_name ?? r?.name, 60);
  const body = clean(r?.body ?? r?.text, 600);
  if (!author || !body || !(rating >= 1 && rating <= 5)) return null;
  const d = r?.reviewed_on ?? r?.date ?? null;
  return { author, rating, body, date: d && !Number.isNaN(Date.parse(d)) ? String(d).slice(0, 10) : null, demo: Boolean(r?.is_demo) };
}

/** Config entries first (DropStack set them up), then the owner's, max 12. */
export function mergeShowcase(configReviews = [], dbReviews = []) {
  const seen = new Set();
  const out = [];
  for (const r of [...(configReviews ?? []), ...(dbReviews ?? [])]) {
    const n = normaliseReview(r);
    if (!n) continue;
    const k = `${n.author}|${n.body}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    if (out.length === 12) break;
  }
  return out;
}

export function stars(rating) {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return { filled: n, empty: 5 - n, label: `${n} out of 5 stars` };
}

/** The snippet the owner (or DropStack) pastes into the mini-site. */
export function embedSnippet(origin) {
  const base = String(origin ?? "").replace(/\/+$/, "");
  return `<script src="${base}/showcase.js" async></script>`;
}
