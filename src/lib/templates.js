// Message template rendering and wa.me deep links.
//
// Every customer gets the same link to the same public review page. The template
// varies only to avoid sounding robotic across repeat sends — never by predicted
// sentiment. See the review-gating section of CLAUDE.md.

const PLACEHOLDER = /\{(customerName|businessName|jobDescription|reviewLink)\}/g;

// Reads naturally in "thanks for choosing X for your ___" when a job was logged
// without a description.
export const JOB_FALLBACK = "recent job";

export function renderTemplate(template, values) {
  const filled = {
    customerName: String(values.customerName ?? "").trim(),
    businessName: String(values.businessName ?? "").trim(),
    jobDescription: String(values.jobDescription ?? "").trim() || JOB_FALLBACK,
    reviewLink: String(values.reviewLink ?? "").trim(),
  };
  return String(template ?? "")
    .replace(PLACEHOLDER, (_, key) => filled[key])
    // Collapse whitespace left behind by an empty value, but keep line breaks.
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Rotates through template variants so consecutive sends don't read identically.
 * `seed` is the number of requests already sent, so the cycle advances per send.
 */
export function pickVariant(variants, seed = 0) {
  const list = (Array.isArray(variants) ? variants : []).filter((v) => String(v ?? "").trim());
  if (list.length === 0) return "";
  const n = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
  return list[n % list.length];
}

/**
 * wa.me wants digits only: country code first, no +, spaces or dashes.
 * Returns null for anything that isn't in international form, because a local
 * number like 0821234567 would open a chat with the wrong person.
 */
export function waNumber(phone) {
  const v = String(phone ?? "").trim().replace(/[\s\-().]/g, "");
  if (!/^\+\d{7,15}$/.test(v)) return null;
  return v.slice(1);
}

export function buildWaLink(phone, message) {
  const number = waNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/** The tracked link the customer opens: /r/<token> on this deploy's own origin. */
export function buildTrackedLink(origin, token) {
  const base = String(origin ?? "").replace(/\/+$/, "");
  return `${base}/r/${token}`;
}

/** Everything needed to send one request, or a reason why it can't be sent. */
export function buildWhatsappMessage({ customer, job, businessName, templates, reviewLink, seed = 0 }) {
  const variant = pickVariant(templates, seed);
  if (!variant) return { error: "No WhatsApp message templates are configured in companyConfig.js." };
  const message = renderTemplate(variant, {
    customerName: customer?.name,
    businessName,
    jobDescription: job?.description,
    reviewLink,
  });
  const link = buildWaLink(customer?.phone, message);
  if (!link) {
    return {
      error: customer?.phone
        ? `${customer.name}'s number (${customer.phone}) isn't in international format, so WhatsApp can't open a chat.`
        : `${customer?.name ?? "This customer"} has no phone number.`,
      message,
    };
  }
  return { message, link };
}
