// Who should be asked for a review right now.
//
// NOTE ON REVIEW GATING (see CLAUDE.md): this function decides *whether* to ask,
// never *where to send them*. Every customer that reaches the queue gets the same
// two buttons and the same public review link. There is deliberately no
// satisfaction input anywhere in this file or its callers. If you ever find
// yourself adding a sentiment argument here, stop.

const DAY_MS = 86400000;

const time = (v) => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Splits customers into: ready (ask them now), suppressed (with a reason),
 * and ignores anyone with no completed job at all.
 *
 * Eligibility:
 *   - has at least one job completed on or before now, AND
 *   - the most recent completed job is newer than the last request sent
 *     (or they have never been asked), AND
 *   - the last request was sent at least cooldownDays ago (or never).
 */
export function buildQueue({ customers = [], jobs = [], requests = [], cooldownDays = 90, now = new Date() }) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const cooldownMs = Math.max(0, Number(cooldownDays) || 0) * DAY_MS;

  // Most recent completed job per customer (ignoring anything dated in the future).
  const latestJob = new Map();
  for (const j of jobs) {
    const t = time(j.completed_at);
    if (t === null || t > nowMs) continue;
    const prev = latestJob.get(j.customer_id);
    if (!prev || t > time(prev.completed_at)) latestJob.set(j.customer_id, j);
  }

  // Most recent *sent* request per customer. An unsent row is not an ask.
  const latestAsk = new Map();
  for (const r of requests) {
    const t = time(r.sent_at);
    if (t === null) continue;
    const prev = latestAsk.get(r.customer_id);
    if (!prev || t > time(prev.sent_at)) latestAsk.set(r.customer_id, r);
  }

  const ready = [];
  const suppressed = [];

  for (const c of customers) {
    const job = latestJob.get(c.id);
    if (!job) continue;                       // nothing finished yet — not a candidate

    const ask = latestAsk.get(c.id);
    const jobMs = time(job.completed_at);
    const askMs = ask ? time(ask.sent_at) : null;
    const reachable = Boolean(c.phone || c.email);
    const entry = { customer: c, job, lastAsk: ask ?? null, reachable };

    if (askMs !== null) {
      const sinceMs = nowMs - askMs;
      if (sinceMs < cooldownMs) {
        suppressed.push({
          ...entry,
          reason: "cooldown",
          daysSinceAsk: Math.floor(sinceMs / DAY_MS),
          availableOn: new Date(askMs + cooldownMs).toISOString(),
        });
        continue;
      }
      if (jobMs <= askMs) {
        suppressed.push({ ...entry, reason: "asked-about-this-job", daysSinceAsk: Math.floor(sinceMs / DAY_MS) });
        continue;
      }
    }

    if (!reachable) {
      suppressed.push({ ...entry, reason: "no-contact" });
      continue;
    }

    ready.push(entry);
  }

  // Longest-waiting job first: those are the ones most at risk of being forgotten.
  ready.sort((a, b) => time(a.job.completed_at) - time(b.job.completed_at));
  return { ready, suppressed };
}

export const SUPPRESSION_LABELS = {
  cooldown: "Asked recently",
  "asked-about-this-job": "Already asked about this job",
  "no-contact": "No phone or email",
};
