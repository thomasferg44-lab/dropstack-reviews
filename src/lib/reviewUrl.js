// reviewUrl guardrails. An empty or broken link means every customer who taps
// a request lands nowhere, so the dashboard shouts about it and the landing
// shows a designed "unavailable" state instead. Never invent a URL.

const GOOGLE_HOSTS = /(^|\.)(g\.page|google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl|search\.google\.com)$/i;

/**
 *   missing     nothing set
 *   invalid     not an https:// URL
 *   ok          https:// URL (notGoogle flags a non-Google host as a soft warning)
 */
export function reviewUrlStatus(value) {
  const url = String(value ?? "").trim();
  if (!url) return { ok: false, state: "missing" };
  let parsed;
  try { parsed = new URL(url); } catch { return { ok: false, state: "invalid" }; }
  if (parsed.protocol !== "https:") return { ok: false, state: "invalid" };
  return { ok: true, state: "ok", notGoogle: !GOOGLE_HOSTS.test(parsed.hostname), url };
}

export const REVIEW_URL_WARNINGS = {
  missing: {
    title: "Customer links currently lead nowhere",
    body: "Set your Google review link. Until then, anyone who opens a review request sees an apology (and your WhatsApp number, if it's set) instead of the Google page. Requests to real customers are held back until it's set, so nobody's one ask is wasted.",
  },
  invalid: {
    title: "Your review link isn't a working web address",
    body: "It needs to start with https://. Copy the \"Ask for reviews\" link from your Google Business Profile.",
  },
};
