import { useMemo, useState } from "react";
import { useCustomers } from "./useCustomers.js";
import CustomerForm from "./CustomerForm.jsx";
import { formatDate, formatPhone } from "../../lib/format.js";
import { Input, Card, EmptyState, ErrorNotice, Spinner, Button, Modal } from "../../components/ui.jsx";

export default function CustomersList() {
  const { customers, loading, error, refresh, addCustomer, updateCustomer } = useCustomers();
  const [query, setQuery] = useState("");
  // null = closed, "new" = adding, otherwise the customer row being edited
  const [editing, setEditing] = useState(null);

  async function handleSubmit(input) {
    const result = editing === "new" ? await addCustomer(input) : await updateCustomer(editing.id, input);
    if (!result.error) setEditing(null);
    return result;
  }

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
        <div className="flex gap-2 sm:w-96">
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
          <Button variant="primary" onClick={() => setEditing("new")}>Add</Button>
        </div>
      </div>

      {editing && (
        <Modal title={editing === "new" ? "Add customer" : "Edit customer"} onClose={() => setEditing(null)}>
          <CustomerForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {error && <ErrorNotice>Couldn’t load customers: {error}</ErrorNotice>}

      {!loading && !error && customers.length === 0 && (
        <EmptyState
          title="No customers yet"
          body="Add your first customer above. CSV import comes in the next stage."
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
                <Card className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                  <p className="font-medium text-text">{c.name}</p>
                  <p className="mt-1 text-sm text-text-mute">{formatPhone(c.phone) || "No phone"}</p>
                  <p className="text-sm text-text-mute">{c.email || "No email"}</p>
                  <p className="mt-2 text-xs text-text-dim">Added {formatDate(c.created_at)}</p>
                  </div>
                  <Button variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
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
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((c) => (
                  <tr key={c.id} className="hover:bg-bg/40">
                    <td className="px-4 py-3 font-medium text-text">{c.name}</td>
                    <td className="px-4 py-3 text-text-mute">{formatPhone(c.phone) || <span className="text-text-dim">—</span>}</td>
                    <td className="px-4 py-3 text-text-mute">{c.email || <span className="text-text-dim">—</span>}</td>
                    <td className="px-4 py-3 text-text-mute">{formatDate(c.created_at)}</td>
                    <td className="px-2 py-2 text-right">
                      <Button variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
                    </td>
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
