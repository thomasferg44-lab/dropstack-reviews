// Header stats.
//
// HONESTY (see CLAUDE.md): Google provides no signal about whether a review was
// actually left, so nothing here counts reviews. "Opened" means the tracked link
// was opened, nothing more, and every label in the UI says exactly that. Do not
// add a metric here that implies a review happened.

const DAY_MS = 86400000;

export function summariseRequests(requests = [], { now = new Date(), windowDays = 30 } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const cutoff = nowMs - windowDays * DAY_MS;

  let sent = 0;
  let opened = 0;
  for (const r of requests) {
    const sentMs = r.sent_at ? new Date(r.sent_at).getTime() : NaN;
    if (Number.isNaN(sentMs) || sentMs < cutoff || sentMs > nowMs) continue;
    sent += 1;
    if (r.clicked_at) opened += 1;
  }

  return {
    windowDays,
    sent,
    opened,
    // Null, not zero: with nothing sent there is no rate to report, and showing
    // 0% would read as "nobody opened them".
    openRate: sent === 0 ? null : opened / sent,
  };
}

export function formatRate(rate) {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}
