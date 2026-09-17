import { useEffect, useState } from "react";
import { supabase, isConfigured } from "./lib/supabase.js";
import LoginForm from "./components/LoginForm.jsx";
import Layout from "./components/Layout.jsx";
import CustomersList from "./features/customers/CustomersList.jsx";
import { Card } from "./components/ui.jsx";

function SetupNotice() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="max-w-md p-6 text-sm text-text-mute">
        <p className="font-medium text-text">Supabase isn’t configured.</p>
        <p className="mt-2">
          Copy <code className="text-accent-1">.env.example</code> to <code className="text-accent-1">.env</code>,
          fill in <code className="text-accent-1">VITE_SUPABASE_URL</code> and{" "}
          <code className="text-accent-1">VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
        </p>
      </Card>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [tab, setTab] = useState("customers");

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isConfigured) return <SetupNotice />;
  if (session === undefined) return <div className="min-h-screen bg-bg" />;
  if (!session) return <LoginForm />;

  return (
    <Layout tab={tab} onTab={setTab}>
      {tab === "customers" && <CustomersList />}
    </Layout>
  );
}
