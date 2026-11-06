// First-run checklist: details confirmed -> demo loaded or first real record ->
// first request sent. Shown until complete, dismissible after. Steps come from
// real data wherever possible; only "confirmed" and "dismissed" are remembered
// (per device).
export const STEPS = [
  { key: "config", label: "Check your details and review link", help: "Your business name, Google review link and WhatsApp number." },
  { key: "data", label: "Load demo data or add your first job", help: "See it working with a sample week, or log a job you've finished." },
  { key: "action", label: "Send your first review request", help: "Tap the first customer in Ask now and send it on WhatsApp." },
];

const ms = (v) => { const n = Date.parse(v ?? ""); return Number.isNaN(n) ? null : n; };

/**
 * A request counts as the owner's own send when it was sent from this tool:
 * the row is created when the composer opens and stamped when they send, so
 * sent_at >= created_at. Demo rows are seeded with backdated sends, which
 * fail that test, so loading demo data alone never ticks step 3.
 */
export function sentByOwner(r) {
  const sent = ms(r?.sent_at);
  const created = ms(r?.created_at);
  return sent !== null && (created === null || sent >= created - 60000);
}

export function checklistState({ configConfirmed, customers = [], jobs = [], requests = [], dismissed }) {
  const done = {
    config: Boolean(configConfirmed),
    data: customers.length > 0 || jobs.length > 0,
    action: requests.some(sentByOwner),
  };
  const complete = STEPS.every((s) => done[s.key]);
  return {
    done,
    complete,
    next: STEPS.find((s) => !done[s.key])?.key ?? null,
    count: STEPS.filter((s) => done[s.key]).length,
    show: !complete || !dismissed,
    canDismiss: complete,
  };
}
