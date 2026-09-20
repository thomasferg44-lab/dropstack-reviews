// Builds the review-request email. Pure: no network, no env, so both the
// Netlify Function and the tests can use it.
//
// Same rule as everywhere else in this repo: one message, one link, sent to
// everyone. Nothing here branches on anything the customer has told us.

import { renderTemplate, JOB_FALLBACK } from "./templates.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Turns the plain-text body into HTML. Where the body mentions the review link,
 * a button is substituted rather than appended, so the message does not read as
 * though it is asking twice.
 */
export function bodyToHtml(text, { reviewLink, primaryColor = "#1d4ed8" }) {
  const parts = String(text ?? "").split(reviewLink);
  const button =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;">` +
    `<tr><td align="center" bgcolor="${escapeHtml(primaryColor)}" style="border-radius:10px;">` +
    `<a href="${escapeHtml(reviewLink)}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;` +
    `font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;">Leave a Google review</a>` +
    `</td></tr></table>`;

  const para = (chunk) =>
    String(chunk)
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
      .join("");

  return parts.map(para).join(button);
}

export function wrapHtml(inner, { businessName, reviewLink }) {
  return (
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;` +
    `border-radius:14px;padding:32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#111827;">` +
    `<tr><td>${inner}` +
    `<p style="margin:24px 0 0;font-size:12px;color:#6b7280;">` +
    `If the button does not work, paste this into your browser:<br />` +
    `<a href="${escapeHtml(reviewLink)}" style="color:#6b7280;">${escapeHtml(reviewLink)}</a></p>` +
    `<p style="margin:16px 0 0;font-size:12px;color:#6b7280;">Sent by ${escapeHtml(businessName)}.</p>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

export function buildEmail({ customer, job, businessName, template, reviewLink, primaryColor }) {
  const to = String(customer?.email ?? "").trim();
  if (!to) return { error: `${customer?.name ?? "This customer"} has no email address.` };
  if (!EMAIL_RE.test(to)) return { error: `"${to}" is not a valid email address.` };

  const subjectTemplate = String(template?.subject ?? "").trim();
  const bodyTemplate = String(template?.body ?? "").trim();
  if (!subjectTemplate || !bodyTemplate) {
    return { error: "No email subject and body are configured in companyConfig.js." };
  }
  if (!reviewLink) return { error: "No review link was generated." };

  const values = {
    customerName: customer?.name,
    businessName,
    jobDescription: job?.description || JOB_FALLBACK,
    reviewLink,
  };
  const subject = renderTemplate(subjectTemplate, values);
  const text = renderTemplate(bodyTemplate, values);
  const html = wrapHtml(bodyToHtml(text, { reviewLink, primaryColor }), { businessName, reviewLink });

  return { to, subject, text, html };
}
