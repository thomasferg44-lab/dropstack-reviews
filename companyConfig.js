// Client-specific, NON-SECRET configuration.
// A new client deploy is this same repo with a different companyConfig.js.
// Secrets (Supabase keys, Resend key) never go here — they live in .env.

export const companyConfig = {
  // Shown on the public redirect page and used in message templates.
  businessName: "Example Plumbing",
  logoUrl: "/logo.svg",

  // Public-page branding only. The owner dashboard uses fixed DropStack tokens.
  primaryColor: "#1D4ED8",
  accentColor: "#F59E0B",

  // The client's Google review link. Every customer gets this same link —
  // no gating, no sentiment pre-screen (see CLAUDE.md).
  reviewUrl: "",

  // Never surface a customer in the "Ask now" queue if they were asked
  // within this many days.
  cooldownDays: 90,

  // Placeholders: {customerName} {businessName} {jobDescription} {reviewLink}
  // Variants are rotated so repeated sends don't look robotic.
  templates: {
    whatsapp: [
      "Hi {customerName}, thanks for choosing {businessName} for your {jobDescription}. If you have a minute, a quick Google review would mean a lot to us: {reviewLink}",
      "Hi {customerName}, {businessName} here. Hope you're happy with the {jobDescription}! If you could leave us a short Google review it really helps a small business like ours: {reviewLink}",
      "Hi {customerName}, thanks again for the {jobDescription} job. Would you mind sharing a quick review on Google? It only takes a minute: {reviewLink}",
    ],
    email: {
      subject: "Quick favour from {businessName}?",
      body:
        "Hi {customerName},\n\nThanks for choosing {businessName} for your {jobDescription}. If you have a minute, a short Google review would really help us:\n\n{reviewLink}\n\nThanks so much,\n{businessName}",
    },
  },
};
