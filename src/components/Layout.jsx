import { supabase } from "../lib/supabase.js";
import { companyConfig } from "../../companyConfig.js";
import { useHeaderStats } from "../features/history/useHeaderStats.js";
import { formatRate } from "../features/history/stats.js";
import { Button } from "./ui.jsx";

// Bump as stages land so tabs unlock without touching the markup.
export const CURRENT_STAGE = 9;

export const TABS = [
  { id: "queue", label: "Ask now", stage: 5 },
  { id: "customers", label: "Customers", stage: 1 },
  { id: "jobs", label: "Jobs", stage: 4 },
  { id: "history", label: "History", stage: 9 },
];

// Sent and opened only. Nothing here counts reviews, because Google reports
// nothing about them — see the honesty note in CLAUDE.md.
function HeaderStats() {
  const stats = useHeaderStats();
  return (
    <div
      className="hidden items-center gap-4 text-right text-xs sm:flex"
      title="Google doesn't report who left a review, so this tracks link opens only."
    >
      <div>
        <p className="font-medium text-text">{stats.sent}</p>
        <p className="text-text-dim">sent · {stats.windowDays}d</p>
      </div>
      <div>
        <p className="font-medium text-text">{formatRate(stats.openRate)}</p>
        <p className="text-text-dim">link opens</p>
      </div>
    </div>
  );
}

export default function Layout({ tab, onTab, children }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-text-dim">Review Engine</p>
            <p className="truncate text-sm font-medium text-text">{companyConfig.businessName}</p>
          </div>
          <div className="flex items-center gap-4">
            <HeaderStats />
            <Button variant="ghost" onClick={() => supabase.auth.signOut()}>Sign out</Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4" aria-label="Sections">
          {TABS.map((t) => {
            const active = t.id === tab;
            const enabled = t.stage <= CURRENT_STAGE;
            return (
              <button
                key={t.id}
                type="button"
                disabled={!enabled}
                title={enabled ? undefined : `Coming in Stage ${t.stage}`}
                onClick={() => onTab(t.id)}
                className={
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition " +
                  (active
                    ? "border-accent-1 text-text"
                    : "border-transparent text-text-mute hover:text-text disabled:text-text-dim disabled:hover:text-text-dim")
                }
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
