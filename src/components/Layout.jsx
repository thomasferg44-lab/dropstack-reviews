import { supabase } from "../lib/supabase.js";
import { companyConfig } from "../../companyConfig.js";
import { Button } from "./ui.jsx";

// Tabs per spec. Only Customers is wired in Stage 1; the rest are placeholders
// so the shell doesn't need restructuring later.
// Bump as stages land so tabs unlock without touching the markup.
export const CURRENT_STAGE = 7;

export const TABS = [
  { id: "queue", label: "Ask now", stage: 5 },
  { id: "customers", label: "Customers", stage: 1 },
  { id: "jobs", label: "Jobs", stage: 4 },
  { id: "history", label: "History", stage: 9 },
];

export default function Layout({ tab, onTab, children }) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-text-dim">Review Engine</p>
            <p className="truncate text-sm font-medium text-text">{companyConfig.businessName}</p>
          </div>
          <Button variant="ghost" onClick={() => supabase.auth.signOut()}>Sign out</Button>
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
