// Client-specific, NON-SECRET configuration.
// A new client deploy is this same repo with a different companyConfig.js.
// Secrets (Supabase keys, Resend key) never go here — they live in .env.

export const companyConfig = {
  // Shown on the public landing and in every message template.
  // REPLACE PER CLIENT. This default is a deliberately invented business that
  // does not exist; never ship it to a real deploy.
  businessName: "Quillbrook Plumbing",
  // Signs the reply drafts ("Thanks so much! Sam, Quillbrook Plumbing").
  // "" leaves the name off.
  ownerName: "",
  // "" shows a clean initials monogram instead of a logo (never a placeholder box).
  logoUrl: "",
  locale: "en-ZA",

  // Public-page branding only. The landing and the showcase strip are the
  // client's pages and carry these colours; the owner dashboard uses the
  // DropStack system, with primaryColor on its primary buttons.
  primaryColor: "#1D4ED8",
  accentColor: "#F59E0B",

  // The client's Google review link ("Ask for reviews" link from the Google
  // Business Profile). Every customer gets this same link — no gating, no
  // sentiment pre-screen (see CLAUDE.md). While it is empty the dashboard
  // shows a loud warning and the landing shows a designed "unavailable"
  // state. Never put an invented URL here. REPLACE PER CLIENT.
  reviewUrl: "",

  // The business's own WhatsApp number, international format, digits only
  // (e.g. "27821234567"). Used on the landing for the "message us directly"
  // line and the unavailable-state fallback. "" hides both (never a fake
  // number). REPLACE PER CLIENT.
  whatsappNumber: "",

  // Sender for the email channel. The domain must be verified in Resend, or
  // sends are rejected. Not a secret — the Resend API key lives in .env.
  // example.com is reserved by RFC 2606 and can never be registered, so an
  // unconfigured deploy cannot mail a real domain. REPLACE PER CLIENT.
  fromEmail: "reviews@example.com",
  replyToEmail: "",   // optional; replies go to fromEmail when blank

  // Never surface a customer in the "Ask now" queue if they were asked
  // within this many days.
  cooldownDays: 90,

  // The ONE follow-up (POPIA: the request is the one consent-based contact;
  // one gentle follow-up for non-responders, nothing after that).
  //   afterDays     a request with no response for this long is offered one
  //   maxDays       after this long, no follow-up is offered at all
  //   emailEnabled  false = follow-ups are WhatsApp-only
  // WhatsApp follow-ups are always sent by the owner's own tap.
  followUp: {
    afterDays: 5,
    maxDays: 30,
    emailEnabled: true,
  },

  // Placeholders: {firstName} {customerName} {businessName} {jobDescription}
  // {jobWhen} ("yesterday", "on Tuesday", "last week") {reviewLink}
  // Variants are rotated so repeated sends don't look robotic.
  templates: {
    whatsapp: [
      "Hi {firstName}, thanks for choosing {businessName} for the {jobDescription} {jobWhen}. If you have a minute, a quick Google review would mean a lot to us: {reviewLink}",
      "Hi {firstName}, {businessName} here. Hope you're happy with the {jobDescription}! If you could leave us a short Google review it really helps a small business like ours: {reviewLink}",
      "Hi {firstName}, thanks again for having us {jobWhen} for the {jobDescription}. Would you mind sharing a quick review on Google? It only takes a minute: {reviewLink}",
    ],
    email: {
      subject: "Quick favour from {businessName}?",
      body:
        "Hi {firstName},\n\nThanks for choosing {businessName} for the {jobDescription} {jobWhen}. If you have a minute, a short Google review would really help us:\n\n{reviewLink}\n\nThanks so much,\n{businessName}",
    },
    // The one follow-up. Says plainly that it's the last ask.
    followUp: {
      whatsapp: [
        "Hi {firstName}, just a gentle nudge from {businessName} about the review for your {jobDescription}. No pressure at all, and this is the last you'll hear from us about it: {reviewLink}",
      ],
      email: {
        subject: "One last thing from {businessName}",
        body:
          "Hi {firstName},\n\nA gentle nudge about the {jobDescription} we did {jobWhen}. If you have a minute, a short Google review would really help us:\n\n{reviewLink}\n\nNo pressure at all, and we won't ask again.\n\nThanks,\n{businessName}",
      },
    },
  },

  // Reply drafts in the feedback view, by rating band (warm / thanks /
  // recovery). Leave empty to use the built-in drafts. Placeholders:
  // {firstName} {businessName} {jobDescription} {ownerName}
  replyDrafts: {},

  // Showcase strip (embed on the mini-site). Hand-entered REAL reviews only,
  // copied from the Google profile with the customer's first name:
  //   { author_name: "Thandi M.", rating: 5, body: "...", reviewed_on: "2026-10-12" }
  // The owner can also add them in the dashboard. Ships empty: never invent one.
  showcase: {
    title: "What customers say",
    reviews: [],
  },

  // Demo mode: realistic sample activity per trade, one tap to load or
  // remove. Set allowed: false once a client's real data is in.
  demo: {
    allowed: true,
    industries: ["plumber", "landscaper", "electrician"],
  },
};
