import { useMemo, useState } from "react";
import { useCustomers } from "./useCustomers.js";
import { formatDate, formatPhone } from "../../lib/format.js";
import { Input, Card, EmptyState, ErrorNotice, Spinner, Button } from "../../components/ui.jsx";

export default function CustomersList() {
  const { customers, loading, error, refresh } = useCustomers();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.name, c.phone, c.email].some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [customers, query]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Customers</h1>
          <p className="text-sm text-text-mute">
            {loading ? "Loading…" : `${customers.length} customer${customers.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex gap-2 sm:w-80">
          <Input
            type="search"
            placeholder="Search name, phone, email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search customers"
          />
          <Button variant="ghost" onClick={refresh} disabled={loading} aria-label="Refresh">
            {loading ? <Spinner /> : "Refresh"}
          </Button>
        </div>
      </div>

      {error && <ErrorNotice>Couldn’t load customers: {error}</ErrorNotice>}

      {!loading && !error && customers.length === 0 && (
        <EmptyState
          title="No customers yet"
          body="Adding customers and importing a CSV come in the next stage."
        />
      )}

      {!loading && !error && customers.length > 0 && visible.length === 0 && (
        <EmptyState title="No matches" body="Try a different search." />
      )}

      {visible.length > 0 && (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-2 sm:hidden">
            {visible.map((c) => (
              <li key={c.id}>
                <Card className="p-4">
                  <p className="font-medium text-text">{c.name}</p>
                  <p className="mt-1 text-sm text-text-mute">{formatPhone(c.phone) || "No phone"}</p>
                  <p className="text-sm text-text-mute">{c.email || "No email"}</p>
                  <p className="mt-2 text-xs text-text-dim">Added {formatDate(c.created_at)}</p>
                </Card>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <Card className="hidden overflow-hidden sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-text-mute">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((c) => (
                  <tr key={c.id} className="hover:bg-bg/40">
                    <td className="px-4 py-3 font-medium text-text">{c.name}</td>
                    <td className="px-4 py-3 text-text-mute">{formatPhone(c.phone) || <span className="text-text-dim">—</span>}</td>
                    <td className="px-4 py-3 text-text-mute">{c.email || <span className="text-text-dim">—</span>}</td>
                    <td className="px-4 py-3 text-text-mute">{formatDate(c.created_at)}</td>
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
