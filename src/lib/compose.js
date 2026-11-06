// Pre-composed, per-customer messages (deterministic: no external AI call).
// Every message is built from THIS customer's first name, the actual job and
// when it was done, so nothing reads like a blast. The seam for a future
// AI-written variant is composeMessage(): same inputs, same output shape.
//
// Every customer gets the same link to the same landing, where the Google
// button is shown to everyone. Nothing here varies by predicted sentiment.
import { renderTemplate, pickVariant, buildWaLink, firstName } from "./templates.js";

const DAY_MS = 86400000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Calendar day in South Africa (UTC+2, no DST), so "yesterday" means the
// owner's yesterday whatever the server clock says.
const saDay = (ms) => Math.floor((ms + 2 * 3600000) / DAY_MS);

/** When the job was done, in words: today / yesterday / on Tuesday / last week / on 3 Oct. */
export function jobWhen(completedAt, now = new Date()) {
  const c = completedAt ? new Date(completedAt).getTime() : NaN;
  if (Number.isNaN(c)) return "recently";
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const diff = saDay(nowMs) - saDay(c);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `on ${WEEKDAYS[new Date(c + 2 * 3600000).getUTCDay()]}`;
  if (diff < 14) return "last week";
  const d = new Date(c + 2 * 3600000);
  return `on ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export const DEFAULT_FOLLOW_UP = {
  whatsapp: [
    "Hi {firstName}, just a gentle nudge from {businessName} about the review for your {jobDescription}. No pressure at all, and this is the last you'll hear from us about it: {reviewLink}",
  ],
  email: {
    subject: "One last thing from {businessName}",
    body:
      "Hi {firstName},\n\nA gentle nudge about the {jobDescription} we did {jobWhen}. If you have a minute, a short Google review would really help us:\n\n{reviewLink}\n\nNo pressure at all, and we won't ask again.\n\nThanks,\n{businessName}",
  },
};

function templatesFor(config, kind) {
  const t = config?.templates ?? {};
  if (kind === "followup") {
    const f = t.followUp ?? {};
    return {
      whatsapp: Array.isArray(f.whatsapp) && f.whatsapp.some((x) => String(x ?? "").trim()) ? f.whatsapp : DEFAULT_FOLLOW_UP.whatsapp,
      email: f.email?.subject && f.email?.body ? f.email : DEFAULT_FOLLOW_UP.email,
    };
  }
  return { whatsapp: t.whatsapp ?? [], email: t.email ?? {} };
}

export function messageValues({ customer, job, config, reviewLink, now }) {
  return {
    customerName: customer?.name,
    firstName: firstName(customer?.name),
    businessName: config?.businessName,
    jobDescription: job?.description,
    jobWhen: jobWhen(job?.completed_at, now),
    reviewLink,
  };
}

/**
 * One message, ready to send or show. kind: "request" | "followup".
 *   whatsapp -> { channel, text, link } or { channel, text, error }
 *   email    -> { channel, subject, text, to } or { channel, error }
 */
export function composeMessage({ customer, job, config, reviewLink, channel = "whatsapp", kind = "request", seed = 0, now = new Date() }) {
  const tpl = templatesFor(config, kind);
  const values = messageValues({ customer, job, config, reviewLink, now });
  if (channel === "email") {
    if (!customer?.email) return { channel, error: `${customer?.name ?? "This customer"} has no email address.` };
    if (!tpl.email?.subject || !tpl.email?.body) return { channel, error: "No email template is set up in companyConfig.js." };
    return { channel, to: customer.email, subject: renderTemplate(tpl.email.subject, values), text: renderTemplate(tpl.email.body, values) };
  }
  const variant = pickVariant(tpl.whatsapp, seed);
  if (!variant) return { channel, error: "No WhatsApp message templates are set up in companyConfig.js." };
  const text = renderTemplate(variant, values);
  return { channel, ...whatsappLink(customer, text) };
}

/** Rebuild the wa.me link for an edited message; refuses to lose the tracked link. */
export function whatsappLink(customer, text, reviewLink) {
  if (reviewLink && !String(text).includes(reviewLink)) {
    return { text, error: "The review link is missing from the message. Put it back, or reset the message." };
  }
  const link = buildWaLink(customer?.phone, text);
  if (!link) {
    return {
      text,
      error: customer?.phone
        ? `${customer.name}'s number (${customer.phone}) isn't in international format, so WhatsApp can't open a chat.`
        : `${customer?.name ?? "This customer"} has no phone number.`,
    };
  }
  return { text, link };
}

/** Which channel the composer opens on: WhatsApp whenever the number works. */
export function defaultChannel(customer) {
  if (buildWaLink(customer?.phone, "x")) return "whatsapp";
  if (customer?.email) return "email";
  return "whatsapp";
}
