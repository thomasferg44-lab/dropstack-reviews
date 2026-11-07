import { useEffect, useMemo, useState } from "react";
import { supabase, isConfigured } from "./lib/supabase.js";
import { wipeDevice } from "./lib/cache.js";
import useRoute from "./hooks/useRoute.js";
import { DataProvider, useData } from "./state/DataStore.jsx";
import useDerived from "./state/useDerived.js";
import { ToastProvider } from "./components/ui/Toast.jsx";
import AppShell from "./components/AppShell.jsx";
import BrandMark from "./components/ui/BrandMark.jsx";
import Icon from "./components/ui/Icon.jsx";
import Login from "./pages/Login.jsx";
import TodayPage from "./pages/TodayPage.jsx";
import JobsPage from "./pages/JobsPage.jsx";
import { CustomersPage, CustomerDetailPage, CustomerLookup } from "./pages/CustomersPage.jsx";
import ActivityPage from "./pages/ActivityPage.jsx";
import SetupPage from "./pages/SetupPage.jsx";
import { reviewUrlStatus } from "./lib/reviewUrl.js";
import { companyConfig } from "../companyConfig.js";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT") wipeDevice();
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card p-6 max-w-md space-y-2">
          <h1 className="text-[17px] font-semibold">Supabase not configured</h1>
          <p className="text-[15px] text-ink-3">Copy <code>.env.example</code> to <code>.env</code>, set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart.</p>
        </div>
      </div>
    );
  }
  if (session === undefined) return <div className="min-h-screen aura-wash flex items-center justify-center"><BrandMark size={56} className="rounded-[16px] opacity-90" /></div>;
  if (!session) return <ToastProvider><Login /></ToastProvider>;

  return (
    <ToastProvider>
      <DataProvider key={session.user.id} user={session.user}>
        <Screens />
      </DataProvider>
    </ToastProvider>
  );
}

const TITLES = { today: "Today", jobs: "Jobs", customers: "Customers", customer: "Customer", lookup: "Customer", activity: "Activity", setup: "Setup" };

function Screens() {
  const route = useRoute();
  const { requests, status, error, refresh, loaded } = useData();
  const { ask, followUps, hasDemo } = useDerived();
  const badges = useMemo(() => ({
    today: ask.ready.length + followUps.length,
    feedback: requests.filter((r) => r.feedback_rating && r.feedback_rating <= 3 && Date.now() - Date.parse(r.feedback_at) < 14 * 86400000).length,
    setup: reviewUrlStatus(companyConfig.reviewUrl).ok ? 0 : 1,
  }), [ask, followUps, requests]);
  useEffect(() => { document.title = `${TITLES[route.name]} · ${companyConfig.businessName}`; }, [route.name]);

  let page;
  if (status === "error" && !loaded) {
    page = (
      <div className="card p-6 text-center space-y-3" role="alert">
        <Icon name="wifiOff" size={28} className="mx-auto text-ink-3" />
        <p className="text-[17px] font-semibold">Couldn't load your customers</p>
        <p className="text-[15px] text-ink-3">{error}</p>
        <button className="btn-primary" onClick={refresh}>Try again</button>
      </div>
    );
  } else {
    switch (route.name) {
      case "jobs": page = <JobsPage />; break;
      case "customers": page = <CustomersPage />; break;
      case "customer": page = <CustomerDetailPage id={route.id} />; break;
      case "lookup": page = <CustomerLookup phone={route.phone} />; break;
      case "activity": page = <ActivityPage tab={route.tab} />; break;
      case "setup": page = <SetupPage />; break;
      default: page = <TodayPage />;
    }
  }
  return (
    <AppShell route={route} title={TITLES[route.name]} badges={badges} demo={hasDemo}
      back={route.name === "customer" || route.name === "lookup" ? { to: "/customers", label: "Customers" } : null}>
      {page}
    </AppShell>
  );
}
