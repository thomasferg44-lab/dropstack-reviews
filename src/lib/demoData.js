// Demo mode: a believable South African service business's review activity,
// per trade, loaded in one tap and removed in one tap.
//
// Rules (BUILD_BRIEF addendum):
//   * every row is marked is_demo (the database forces it in reviews_load_demo)
//   * names are invented; phone numbers use the +27 000 000 1xx / 2xx / 3xx
//     placeholder pattern (not a real SA mobile range, so wa.me reaches
//     nobody); emails are @example.com (reserved, can never deliver)
//   * nothing claims a review was left. The furthest any demo row goes is
//     "tapped through to Google", which is all the real product can see too
//   * showcase entries are visibly sample text and are never served to the
//     public widget (reviews_showcase_list() excludes demo rows)
// Timestamps are relative to "now", so the queues look alive whenever loaded.

const DAY = 86400000;
const HOUR = 3600000;

// Per customer: [name, job description, story]
// story: ask (not asked yet), followup (sent, no response, due), followedup,
// opened, feedback (rating, comment, google?), google (tapped, no feedback),
// scheduled (job not finished yet)
const SETS = {
  plumber: {
    label: "Plumber",
    phoneBlock: 1,
    people: [
      ["Thandi Mokoena", "geyser replacement (150L)", { s: "ask", jobDays: 1 }],
      ["Pieter van der Merwe", "burst pipe repair", { s: "ask", jobDays: 3 }],
      ["Ayesha Patel", "blocked drain clearing", { s: "ask", jobDays: 0, emailOnly: true }],
      ["Sipho Dlamini", "kitchen mixer tap replacement", { s: "followup", sentDays: 8, ch: "whatsapp" }],
      ["Lerato Nkosi", "toilet cistern repair", { s: "followup", sentDays: 6, ch: "email" }],
      ["Johan Botha", "pressure valve replacement", { s: "followedup", sentDays: 15, fuDays: 8, ch: "whatsapp" }],
      ["Naledi Khumalo", "outside tap installation", { s: "opened", sentDays: 4, ch: "whatsapp" }],
      ["Riaan Pretorius", "solar geyser installation", { s: "feedback", sentDays: 10, ch: "whatsapp", rating: 5, comment: "Arrived when they said they would and explained everything.", google: true }],
      ["Fatima Adams", "bathroom renovation plumbing", { s: "feedback", sentDays: 12, ch: "whatsapp", rating: 2, comment: "The work is fine but the team left a mess in the roof space." }],
      ["Bongani Zulu", "water heater service", { s: "feedback", sentDays: 20, ch: "email", rating: 4, comment: "", google: true }],
      ["Chantelle Jacobs", "leak detection and repair", { s: "google", sentDays: 2, ch: "whatsapp" }],
      ["Mandla Ndlovu", "new kitchen sink installation", { s: "scheduled" }],
    ],
  },
  landscaper: {
    label: "Landscaper",
    phoneBlock: 2,
    people: [
      ["Zanele Mthembu", "instant lawn (Kikuyu), front garden", { s: "ask", jobDays: 1 }],
      ["Hendrik Steyn", "irrigation system install", { s: "ask", jobDays: 2 }],
      ["Priya Naidoo", "hedge trimming and clean-up", { s: "ask", jobDays: 0, emailOnly: true }],
      ["Themba Sithole", "tree felling and removal", { s: "followup", sentDays: 9, ch: "whatsapp" }],
      ["Karin du Plessis", "new indigenous garden bed", { s: "followup", sentDays: 5, ch: "email" }],
      ["Lindiwe Cele", "paving and pathway", { s: "followedup", sentDays: 16, fuDays: 9, ch: "whatsapp" }],
      ["Wikus Venter", "garden clean-up after the storm", { s: "opened", sentDays: 3, ch: "whatsapp" }],
      ["Nomvula Shabalala", "monthly garden service", { s: "feedback", sentDays: 11, ch: "whatsapp", rating: 5, comment: "The garden has never looked this good.", google: true }],
      ["Yusuf Ebrahim", "artificial lawn installation", { s: "feedback", sentDays: 13, ch: "whatsapp", rating: 2, comment: "Good result in the end, but it took two days longer than quoted." }],
      ["Annelie Kruger", "palm tree pruning", { s: "feedback", sentDays: 19, ch: "email", rating: 4, comment: "", google: true }],
      ["Kagiso Molefe", "compost and mulching", { s: "google", sentDays: 2, ch: "whatsapp" }],
      ["Refilwe Mahlangu", "borehole irrigation check", { s: "scheduled" }],
    ],
  },
  electrician: {
    label: "Electrician",
    phoneBlock: 3,
    people: [
      ["Musa Hadebe", "DB board upgrade", { s: "ask", jobDays: 1 }],
      ["Elize Fourie", "certificate of compliance (CoC)", { s: "ask", jobDays: 4 }],
      ["Rashid Moosa", "LED downlights, open-plan lounge", { s: "ask", jobDays: 0, emailOnly: true }],
      ["Nandi Zungu", "inverter and battery installation", { s: "followup", sentDays: 7, ch: "whatsapp" }],
      ["Gerhard Nel", "geyser element replacement", { s: "followup", sentDays: 6, ch: "email" }],
      ["Palesa Mokoena", "outdoor security lights", { s: "followedup", sentDays: 14, fuDays: 7, ch: "whatsapp" }],
      ["Sibusiso Ngcobo", "extra plug points in the kitchen", { s: "opened", sentDays: 3, ch: "whatsapp" }],
      ["Michelle Smit", "solar panel installation", { s: "feedback", sentDays: 9, ch: "whatsapp", rating: 5, comment: "Neat work and they cleaned up after themselves.", google: true }],
      ["Tshepo Masilela", "fault finding: tripping breaker", { s: "feedback", sentDays: 12, ch: "whatsapp", rating: 1, comment: "Had to call them back twice for the same fault." }],
      ["Liezl Coetzee", "stove connection", { s: "feedback", sentDays: 21, ch: "email", rating: 4, comment: "", google: true }],
      ["Ayanda Dube", "pool pump wiring", { s: "google", sentDays: 1, ch: "whatsapp" }],
      ["Werner Visser", "electric fence repair", { s: "scheduled" }],
    ],
  },
};

export const DEMO_INDUSTRIES = Object.fromEntries(Object.entries(SETS).map(([k, v]) => [k, { label: v.label }]));

// Visibly sample text, so a screenshot can never pass it off as a real
// customer's words. Never served to the public widget.
const SHOWCASE = [
  ["Sample A.", 5, "Sample review for the demo: on time, tidy, and the price matched the quote."],
  ["Sample B.", 5, "Sample review for the demo: friendly team, explained everything, would use again."],
  ["Sample C.", 4, "Sample review for the demo: good work, a day later than planned but kept us posted."],
];

const iso = (ms) => new Date(ms).toISOString();
const email = (name) => name.toLowerCase().replace(/[^a-z ]/g, "").trim().split(/\s+/).map((p, i, a) => (i === a.length - 1 && a.length > 1 ? p[0] : p)).join(".") + "@example.com";

export function demoPhone(block, i) {
  return `+27000000${block}${String(i + 1).padStart(2, "0")}`;
}

/** The reviews_load_demo() payload for a trade, relative to `now`. */
export function buildDemoPayload(industry, now = new Date()) {
  const set = SETS[industry];
  if (!set) throw new Error(`Unknown demo trade: ${industry}`);
  const n = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const customers = [], jobs = [], requests = [];
  set.people.forEach(([name, description, st], i) => {
    const key = `c${i + 1}`;
    customers.push({ key, name, phone: st.emailOnly ? null : demoPhone(set.phoneBlock, i), email: email(name), is_demo: true });
    const jobKey = `j${i + 1}`;
    if (st.s === "scheduled") {
      jobs.push({ key: jobKey, customer_key: key, description, completed_at: null, created_at: iso(n - 2 * DAY) });
      return;
    }
    const doneAt = n - (st.jobDays ?? (st.sentDays + 1)) * DAY - 3 * HOUR;
    jobs.push({ key: jobKey, customer_key: key, description, completed_at: iso(doneAt), created_at: iso(doneAt) });
    if (st.s === "ask") return;
    const sent = n - st.sentDays * DAY - 2 * HOUR;
    const r = { customer_key: key, job_key: jobKey, channel: st.ch, sent_at: iso(sent) };
    if (st.s === "followedup") Object.assign(r, { followed_up_at: iso(n - st.fuDays * DAY), follow_up_channel: st.ch });
    if (["opened", "feedback", "google"].includes(st.s)) r.clicked_at = iso(sent + 40 * 60000);
    if (st.s === "feedback") Object.assign(r, { feedback_rating: st.rating, feedback_comment: st.comment || null, feedback_at: iso(sent + 42 * 60000) });
    if (st.s === "google" || st.google) r.google_clicked_at = iso(sent + 44 * 60000);
    requests.push(r);
  });
  const showcase = SHOWCASE.map(([author_name, rating, body], i) => ({ author_name, rating, body, reviewed_on: iso(n - (10 + i * 9) * DAY).slice(0, 10), sort_order: i }));
  return { industry, customers, jobs, requests, showcase };
}
