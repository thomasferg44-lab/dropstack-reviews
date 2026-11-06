// Pure logic for the public review landing (/r/:token). No DOM, so it can be
// tested, and shared with the build step that pre-renders the page.
//
// REVIEW GATING IS BANNED (CLAUDE.md; Google policy, machine-enforced).
// The Google button is decided by ONE input: whether the business has a review
// link configured. The customer's rating is NOT an input to it. Answering the
// optional "How was your experience?" question can only ADD a direct WhatsApp
// line to the owner (service recovery); it never removes, hides, delays,
// reorders or rewords the Google button. landing.test.js asserts this for
// every possible rating, including the lowest.

export const RATINGS = [
  { value: 1, label: "Very poor" },
  { value: 2, label: "Poor" },
  { value: 3, label: "Okay" },
  { value: 4, label: "Good" },
  { value: 5, label: "Excellent" },
];

// At or below this, the customer is ALSO offered a direct line to the owner.
export const RECOVERY_AT_OR_BELOW = 3;

export function validRating(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** The Google button. Depends on the configured link and nothing else. */
export function googleButton(reviewUrl) {
  const url = String(reviewUrl ?? "").trim();
  if (!url || !/^https:\/\//i.test(url)) return null;
  return { href: url, label: "Review us on Google" };
}

export function waDigits(number) {
  const d = String(number ?? "").replace(/[^\d]/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export function ownerWhatsappLink(number, text) {
  const d = waDigits(number);
  return d ? `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}` : null;
}

/**
 * Everything the landing shows, for a given (optional) rating.
 *   google     the Google button, identical for every rating (null only when
 *              the business hasn't set a review link: the unavailable state)
 *   recovery   an ADDITIONAL WhatsApp line to the owner for a low rating
 *   thanks     one line acknowledging the answer
 */
export function landingModel({ config, rating = null }) {
  const google = googleButton(config?.reviewUrl);
  const r = validRating(rating);
  const name = String(config?.businessName ?? "").trim() || "us";
  let thanks = null;
  let recovery = null;
  if (r !== null) {
    if (r <= RECOVERY_AT_OR_BELOW) {
      thanks = "Thank you for being honest. We'd like to put it right.";
      const link = ownerWhatsappLink(config?.whatsappNumber, `Hi ${name}, I just gave feedback about my recent job and I'd like to talk about it.`);
      if (link) recovery = { href: link, label: `Message ${name} on WhatsApp` };
    } else {
      thanks = "Thank you, that's lovely to hear.";
    }
  }
  return { google, recovery, thanks, unavailable: google === null };
}

/** The unavailable state's fallback: the business's real WhatsApp, or nothing. */
export function unavailableModel(config) {
  const name = String(config?.businessName ?? "").trim() || "us";
  const link = ownerWhatsappLink(config?.whatsappNumber, `Hi ${name}, I tried to leave you a review but the link wasn't working.`);
  return { whatsapp: link ? { href: link, label: `Message ${name} on WhatsApp` } : null };
}

// ---- RPC calls (built here so tests can assert exactly what is sent) ----------
function rpc(supabaseUrl, anonKey, fn, body) {
  if (!supabaseUrl || !anonKey) return null;
  return {
    url: `${String(supabaseUrl).replace(/\/+$/, "")}/rest/v1/rpc/${fn}`,
    options: {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true, // survives the page navigating to Google mid-flight
    },
  };
}

export function feedbackRequest({ supabaseUrl, anonKey, token, rating, comment }) {
  const r = validRating(rating);
  if (!token || r === null) return null;
  const c = String(comment ?? "").trim().slice(0, 1000);
  return rpc(supabaseUrl, anonKey, "reviews_submit_feedback", { p_token: token, p_rating: r, p_comment: c || null });
}

export function googleClickRequest({ supabaseUrl, anonKey, token }) {
  if (!token) return null;
  return rpc(supabaseUrl, anonKey, "reviews_google_click", { p_token: token });
}

// ---- Survive a dropped connection mid-feedback -------------------------------
// The customer's words are saved on their phone as they type and only cleared
// once the server has them. A failed send stays queued and is retried when the
// connection comes back (or the next time they open the link).
export const draftKey = (token) => `dsr:fb:${token}`;

export function readDraft(storage, token) {
  try {
    const v = JSON.parse(storage?.getItem(draftKey(token)) ?? "null");
    if (!v || typeof v !== "object") return null;
    return { rating: validRating(v.rating), comment: String(v.comment ?? "").slice(0, 1000), pending: Boolean(v.pending), sent: Boolean(v.sent) };
  } catch {
    return null;
  }
}

export function writeDraft(storage, token, draft) {
  try {
    storage?.setItem(draftKey(token), JSON.stringify({
      rating: validRating(draft.rating), comment: String(draft.comment ?? "").slice(0, 1000), pending: Boolean(draft.pending), sent: Boolean(draft.sent),
    }));
    return true;
  } catch {
    return false;
  }
}
