import { useState } from "react";
import { Button, Input, Label, ErrorNotice } from "../../components/ui.jsx";
import { isPlausiblePhone } from "../../lib/format.js";

// Used for both add and edit. `initial` is a customer row when editing.
export default function CustomerForm({ initial, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Name is required.");
    if (!isPlausiblePhone(phone)) return setError("That phone number doesn’t look right. Use e.g. 082 123 4567 or +27 82 123 4567.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("That email address doesn’t look right.");
    if (!phone.trim() && !email.trim()) {
      // Allowed, but the customer can't be asked for a review without one.
      if (!window.confirm("No phone or email — you won’t be able to send this customer a review request. Save anyway?")) return;
    }
    setBusy(true);
    const result = await onSubmit({ name, phone, email });
    setBusy(false);
    if (result?.error) setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="cf-name">Name</Label>
        <Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="e.g. Thandi Nkosi" />
      </div>
      <div>
        <Label htmlFor="cf-phone">Phone (for WhatsApp)</Label>
        <Input id="cf-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" />
      </div>
      <div>
        <Label htmlFor="cf-email">Email</Label>
        <Input id="cf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : initial ? "Save changes" : "Add customer"}
        </Button>
      </div>
    </form>
  );
}
