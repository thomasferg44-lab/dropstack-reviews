// What happened to each review request, and the numbers in the hero strip.
//
// HONESTY (CLAUDE.md): Google reports nothing about whether a review was left.
// The furthest this tool can see is "tapped the Google button". Nothing here
// is called "reviewed", and there is no review count. A response is something
// the customer did that we actually recorded: opened the link, answered the
// private feedback question, or tapped through to Google.

const DAY_MS = 86400000;
const t = (v) => {
  if (!v) return null;
  const n = new Date(v).getTime();
  return Number.isNaN(n) ? null : n;
};

/** Furthest recorded step for one request. */
export function requestStage(r) {
  if (!r || !t(r.sent_at)) return "draft";
  if (t(r.google_clicked_at)) return "google";
  if (t(r.feedback_at)) return "feedback";
  if (t(r.clicked_at)) return "opened";
  return "sent";
}

// Status pill words + tone. "Google link tapped" is a tap, not a review.
export const STAGE_LABELS = {
  draft: { label: "Not sent", tone: "neutral" },
  sent: { label: "Sent", tone: "neutral" },
  opened: { label: "Link opened", tone: "info" },
  feedback: { label: "Feedback in", tone: "info" },
  google: { label: "Went to Google", tone: "good" },
};

export function hasResponse(r) {
  return Boolean(t(r?.clicked_at) || t(r?.feedback_at) || t(r?.google_clicked_at));
}

/**
 * Hero-strip numbers over the last `windowDays`, from real rows only.
 *   sent          requests sent in the window
 *   responded     of those, how many have any recorded response
 *   responseRate  responded / sent, or null when nothing was sent (not 0%)
 *   googleTaps    of those, how many tapped through to Google
 *   avgRating     mean private feedback score (1-5) of those that answered,
 *                 or null when nobody has; ratingCount says how many
 *   includesDemo  true when any counted row is demo data (the UI labels it)
 */
export function summarise(requests = [], { now = new Date(), windowDays = 30 } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const cutoff = nowMs - windowDays * DAY_MS;
  let sent = 0, responded = 0, googleTaps = 0, ratingSum = 0, ratingCount = 0, includesDemo = false, followedUp = 0;
  for (const r of requests) {
    const s = t(r.sent_at);
    if (s === null || s < cutoff || s > nowMs) continue;
    sent += 1;
    if (r.is_demo) includesDemo = true;
    if (hasResponse(r)) responded += 1;
    if (t(r.google_clicked_at)) googleTaps += 1;
    if (t(r.followed_up_at)) followedUp += 1;
    const rating = Number(r.feedback_rating);
    if (t(r.feedback_at) && Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      ratingSum += rating;
      ratingCount += 1;
    }
  }
  return {
    windowDays,
    sent,
    responded,
    responseRate: sent === 0 ? null : responded / sent,
    googleTaps,
    followedUp,
    avgRating: ratingCount === 0 ? null : Math.round((ratingSum / ratingCount) * 10) / 10,
    ratingCount,
    includesDemo,
  };
}

export function formatPercent(rate) {
  return rate === null || rate === undefined ? "–" : `${Math.round(rate * 100)}%`;
}

export function formatRating(avg) {
  return avg === null || avg === undefined ? "–" : avg.toFixed(1);
}

/** Feedback answers, newest first, for the owner's feedback view. */
export function feedbackList(requests = []) {
  return requests
    .filter((r) => t(r.feedback_at) && r.feedback_rating)
    .sort((a, b) => t(b.feedback_at) - t(a.feedback_at));
}
