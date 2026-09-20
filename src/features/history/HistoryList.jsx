import { useMemo, useState } from "react";
import { useHistory } from "./useHistory.js";
import { formatRate } from "./stats.js";
import { formatDate } from "../../lib/format.js";
import { Card, EmptyState, ErrorNotice, Spinner, Button, Input, Badge } from "../../components/ui.jsx";

// "Link opened" is the only thing that can honestly be claimed here. Google
// reports nothing about whether a review was left, so there is deliberately no
// "reviewed" state, no completion tick, and no review count anywhere in this file.
function OpenedCell({ clickedAt }) {
  if (!clickedAt) return <span className="text-text-dim">Not opened yet</span>;
  return (
    <span className="text-text-mute">
      <Badge tone="accent">Link opened</Badge> <span className="text-xs">{formatDate(clickedAt)}</span>
    </span>
  );
}

export default function HistoryList() {
  const { requests, stats, loading, error, refresh } = useHistory();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) => r.customer?.name && r.customer.name.toLowerCase().includes(q));
  }, [requests, query]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">History</h1>
          <p className="text-sm text-text-mute">
            {loading ? "Loading…" : `${requests.length} request${requests.length === 1 ? "" : "s"} sent`}
          </p>
        </div>
        <div className="flex gap-2 sm:w-96">
          <Input
            type="search"
            placeholder="Search customer"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search history"
          />
          <Button variant="ghost" onClick={refresh} disabled={loading} aria-label="Refresh">
            {loading ? <Spinner /> : "Refresh"}
          </Button>
        </div>
      </div>

      <Card className="px-4 py-3 text-sm text-text-mute">
        Last {stats.windowDays} days: <span className="text-text">{stats.sent}</span> sent ·{" "}
        <span className="text-text">{stats.opened}</span> opened the link ·{" "}
        <span className="text-text">{formatRate(stats.openRate)}</span> open rate.
        <br />
        <span className="text-xs text-text-dim">
          Google doesn’t report who left a review, so this tracks link opens only. An opened link is not a review.
        </span>
      </Card>

      {error && <ErrorNotice>Couldn’t load history: {error}</ErrorNotice>}

      {!loading && !error && requests.length === 0 && (
        <EmptyState title="Nothing sent yet" body="Requests you send from the “Ask now” queue will be listed here." />
      )}

      {!loading && !error && requests.length > 0 && visible.length === 0 && (
        <EmptyState title="No matches" body="Try a different search." />
      )}

      {visible.length > 0 && (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-2 sm:hidden">
            {visible.map((r) => (
              <li key={r.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-text">{r.customer?.name ?? "Deleted customer"}</p>
                    <Badge>{r.channel === "whatsapp" ? "WhatsApp" : "Email"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-text-dim">Sent {formatDate(r.sent_at)}</p>
                  <p className="mt-2 text-sm"><OpenedCell clickedAt={r.clicked_at} /></p>
                </Card>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <Card className="hidden overflow-hidden sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-text-mute">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Sent</th>
                  <th className="px-4 py-3 font-medium">Channel</th>
                  <th className="px-4 py-3 font-medium">Link opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-bg/40">
                    <td className="px-4 py-3 font-medium text-text">{r.customer?.name ?? "Deleted customer"}</td>
                    <td className="px-4 py-3 text-text-mute">{formatDate(r.sent_at)}</td>
                    <td className="px-4 py-3 text-text-mute">{r.channel === "whatsapp" ? "WhatsApp" : "Email"}</td>
                    <td className="px-4 py-3"><OpenedCell clickedAt={r.clicked_at} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </section>
  );
}
