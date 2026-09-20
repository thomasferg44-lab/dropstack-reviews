// Pure helpers for the public redirect page. No DOM, so they can be tested.

/** Pulls the token out of /r/<token>, tolerating a trailing slash or query. */
export function tokenFromPath(pathname) {
  const m = String(pathname ?? "").match(/\/r\/([^/?#]+)/);
  if (!m) return null;
  let token;
  try {
    token = decodeURIComponent(m[1]);
  } catch {
    token = m[1];
  }
  token = token.trim();
  return token || null;
}

/**
 * Where to send the customer.
 *
 * The destination never depends on anything the customer tells us, because
 * nothing is asked of them. Every token lands on the same review page. An
 * unrecognised token still redirects: a mangled link is our tracking problem,
 * not a reason to block someone who wants to leave a review.
 */
export function redirectTarget(reviewUrl) {
  const url = String(reviewUrl ?? "").trim();
  if (!url) return { error: "no-review-url" };
  if (!/^https?:\/\//i.test(url)) return { error: "bad-review-url", url };
  return { url };
}

/** The PostgREST call that stamps clicked_at. Built here so it can be asserted in tests. */
export function stampRequest({ supabaseUrl, anonKey, token }) {
  if (!supabaseUrl || !anonKey || !token) return null;
  return {
    url: `${String(supabaseUrl).replace(/\/+$/, "")}/rest/v1/rpc/reviews_open_link`,
    options: {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: token }),
      // Survives the page navigating away mid-flight.
      keepalive: true,
    },
  };
}
