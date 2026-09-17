import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { companyConfig } from "../../companyConfig.js";
import { Button, Input, Label, Card, ErrorNotice } from "./ui.jsx";

// Email + password only. No public signup — the owner account is created
// manually in the Supabase dashboard (see README).
export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-sm p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-text-dim">DropStack</p>
        <h1 className="mt-1 text-xl font-semibold text-text">Review Engine</h1>
        <p className="mt-1 text-sm text-text-mute">{companyConfig.businessName}</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" required value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
