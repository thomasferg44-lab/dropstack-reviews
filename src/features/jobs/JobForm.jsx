import { useMemo, useState } from "react";
import { Button, Input, Label, ErrorNotice } from "../../components/ui.jsx";
import { formatPhone } from "../../lib/format.js";

// Local YYYY-MM-DD for <input type="date">. toISOString() would shift the day
// for anyone west of UTC.
export function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function JobForm({ initial, customers, onSubmit, onCancel }) {
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [completedAt, setCompletedAt] = useState(
    initial ? dateInputValue(initial.completed_at) : todayLocal()
  );
  const [customerQuery, setCustomerQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    const list = q
      ? customers.filter((c) => [c.name, c.phone, c.email].some((v) => v && String(v).toLowerCase().includes(q)))
      : customers;
    return list.slice(0, 50);
  }, [customers, customerQuery]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!customerId) return setError("Pick a customer.");
    if (completedAt && completedAt > todayLocal()) {
      return setError("Completion date is in the future. A job has to be finished before you can ask for a review.");
    }
    setBusy(true);
    const result = await onSubmit({ customerId, description, completedAt });
    setBusy(false);
    if (result?.error) setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="jf-customer">Customer</Label>
        {customers.length > 12 && (
          <Input
            className="mb-2"
            type="search"
            placeholder="Filter customers"
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            aria-label="Filter customers"
          />
        )}
        <select
          id="jf-customer"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          required
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent-1 focus:outline-none"
        >
          <option value="">— choose —</option>
          {matches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.phone ? ` · ${formatPhone(c.phone)}` : ""}
            </option>
          ))}
        </select>
        {customers.length === 0 && (
          <p className="mt-1 text-xs text-text-dim">No customers yet. Add one on the Customers tab first.</p>
        )}
      </div>

      <div>
        <Label htmlFor="jf-desc">What was the job?</Label>
        <Input
          id="jf-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. geyser replacement"
        />
        <p className="mt-1 text-xs text-text-dim">
          Used in the review message as {"{jobDescription}"}, so keep it short and natural.
        </p>
      </div>

      <div>
        <Label htmlFor="jf-date">Completed on</Label>
        <Input
          id="jf-date"
          type="date"
          max={todayLocal()}
          value={completedAt}
          onChange={(e) => setCompletedAt(e.target.value)}
        />
        <p className="mt-1 text-xs text-text-dim">
          A job with no completion date won’t appear in the “Ask now” queue.
        </p>
      </div>

      {error && <ErrorNotice>{error}</ErrorNotice>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || customers.length === 0}>
          {busy ? "Saving…" : initial ? "Save changes" : "Log job"}
        </Button>
      </div>
    </form>
  );
}
