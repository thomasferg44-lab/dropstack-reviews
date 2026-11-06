// The ONE follow-up.
//
// Doctrine (BUILD_BRIEF B3, POPIA): the review request is the one consent-
// based contact; a single gentle follow-up is allowed for someone who hasn't
// responded, and nothing after that. The database enforces "once" (see
// reviews_guard_follow_up in schema.sql); this module decides who is due one,
// and refuses a second in the UI before the database has to.
import { hasResponse } from "./responses.js";

const DAY_MS = 86400000;
const t = (v) => {
  if (!v) return null;
  const n = new Date(v).getTime();
  return Number.isNaN(n) ? null : n;
};

export const FOLLOW_UP_DEFAULTS = { afterDays: 5, maxDays: 30, emailEnabled: true };

export function followUpSettings(config) {
  const f = config?.followUp ?? {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    afterDays: num(f.afterDays, FOLLOW_UP_DEFAULTS.afterDays),
    maxDays: num(f.maxDays, FOLLOW_UP_DEFAULTS.maxDays),
    emailEnabled: f.emailEnabled !== false,
  };
}

/**
 * Can this request be followed up now? Returns { ok, reason }.
 *   not-sent             the request itself never went out
 *   already-followed-up  the one follow-up is used. Refused, always.
 *   responded            the customer opened, answered or tapped through
 *   too-soon             inside afterDays
 *   too-late             past maxDays: a follow-up that late reads as spam
 */
export function canFollowUp(request, { now = new Date(), afterDays = 5, maxDays = 30 } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const sent = t(request?.sent_at);
  if (sent === null) return { ok: false, reason: "not-sent" };
  if (t(request.followed_up_at) !== null || request.follow_up_channel) return { ok: false, reason: "already-followed-up" };
  if (hasResponse(request)) return { ok: false, reason: "responded" };
  const days = (nowMs - sent) / DAY_MS;
  if (days < afterDays) return { ok: false, reason: "too-soon", dueOn: new Date(sent + afterDays * DAY_MS).toISOString() };
  if (maxDays > 0 && days > maxDays) return { ok: false, reason: "too-late" };
  return { ok: true, reason: null, daysSince: Math.floor(days) };
}

export const FOLLOW_UP_REFUSALS = {
  "not-sent": "This request hasn't been sent yet.",
  "already-followed-up": "Already followed up once. One follow-up per request is the limit.",
  responded: "They've already responded, so there's nothing to follow up.",
  "too-soon": "Too soon to follow up.",
  "too-late": "Too long ago to follow up without it feeling like spam.",
};

/** Channels a follow-up can go out on for this customer. WhatsApp first. */
export function followUpChannels(customer, { emailEnabled = true } = {}) {
  const out = [];
  if (customer?.phone && /^\+\d{7,15}$/.test(String(customer.phone).replace(/[\s\-().]/g, ""))) out.push("whatsapp");
  if (emailEnabled && customer?.email) out.push("email");
  return out;
}

/**
 * The "Follow up" queue: each customer's LATEST sent request, if it is due its
 * one follow-up and the customer can be reached. Oldest first.
 */
export function buildFollowUpQueue({ requests = [], customers = [], jobs = [], now = new Date(), settings = FOLLOW_UP_DEFAULTS }) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const latest = new Map();
  for (const r of requests) {
    if (t(r.sent_at) === null) continue;
    const prev = latest.get(r.customer_id);
    if (!prev || t(r.sent_at) > t(prev.sent_at)) latest.set(r.customer_id, r);
  }
  const due = [];
  for (const r of latest.values()) {
    const check = canFollowUp(r, { now, afterDays: settings.afterDays, maxDays: settings.maxDays });
    if (!check.ok) continue;
    const customer = byId.get(r.customer_id);
    if (!customer) continue;
    const channels = followUpChannels(customer, settings);
    if (channels.length === 0) continue;
    due.push({ request: r, customer, job: r.job ?? jobById.get(r.job_id) ?? null, channels, daysSince: check.daysSince });
  }
  return due.sort((a, b) => t(a.request.sent_at) - t(b.request.sent_at));
}
