// Ready-to-paste reply drafts by rating band, in the owner's voice.
// Deterministic templates, no external AI call. The seam for an AI-written
// draft later is replyDraft(): same inputs, same output.
//
// Usable two ways: as a WhatsApp reply to the private feedback, or pasted as
// the owner's public reply on Google. A low-score draft is service recovery:
// it apologises and offers to fix things. It NEVER asks the customer to hold
// off on, change or remove a Google review; the Google path stays open for
// everyone (replyDrafts.test.js checks the wording).
import { firstName, renderTemplate } from "./templates.js";

export function replyBand(rating) {
  const r = Number(rating);
  if (r >= 5) return "warm";
  if (r === 4) return "thanks";
  return "recovery";
}

export const BAND_LABELS = { warm: "5 stars: warm thanks", thanks: "4 stars: thanks", recovery: "3 or lower: put it right" };

export const DEFAULT_REPLY_DRAFTS = {
  warm: "Thank you so much, {firstName}! It was a pleasure doing your {jobDescription}. We really appreciate you taking the time. {ownerName}, {businessName}",
  thanks: "Thanks a lot, {firstName}. Glad the {jobDescription} went well. If there's anything we could have done even better, we'd love to hear it. {ownerName}, {businessName}",
  recovery: "Hi {firstName}, thank you for telling us, and I'm sorry the {jobDescription} wasn't what you expected. I'd like to put it right. Please WhatsApp or call me directly and I'll sort it out personally. {ownerName}, {businessName}",
};

export function replyDraft({ rating, customer, job, config }) {
  const band = replyBand(rating);
  const custom = config?.replyDrafts?.[band];
  const template = String(custom ?? "").trim() || DEFAULT_REPLY_DRAFTS[band];
  const owner = String(config?.ownerName ?? "").trim();
  const text = renderTemplate(template, {
    customerName: customer?.name,
    firstName: firstName(customer?.name) || "there",
    businessName: config?.businessName,
    jobDescription: job?.description || "job",
  })
    .replace(/\{ownerName\},?\s*/g, owner ? `${owner}, ` : "")
    .replace(/\s+,/g, ",")
    .trim();
  return { band, label: BAND_LABELS[band], text };
}
