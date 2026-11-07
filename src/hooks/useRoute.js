import { useEffect, useState } from "react";

// A tiny path router (no dependency):
//   /                  Today: ask now, follow up, the hero strip
//   /jobs              Jobs (mark done -> request offered in the same motion)
//   /customers         Customers (+ CSV import)
//   /customers/:id     One customer, with their jobs and requests
//   /customers?phone=  Cross-tool lookup: the suite joins on phone number, so
//                      another DropStack tool can hand off straight to the
//                      customer's record (lands with it open)
//   /activity          Requests and feedback (with reply drafts)
//   /setup             Details, review link, demo mode, showcase, status
const listeners = new Set();
export function navigate(to, { replace = false } = {}) {
  if (to === window.location.pathname + window.location.search) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", to);
  window.scrollTo?.(0, 0);
  for (const l of listeners) l();
}

export function matchRoute(pathname, search = "") {
  const p = pathname.replace(/\/+$/, "") || "/";
  const q = new URLSearchParams(search);
  let m;
  if (p === "/") return { name: "today" };
  if (p === "/jobs") return { name: "jobs" };
  if (p === "/customers") return q.get("phone") ? { name: "lookup", phone: q.get("phone") } : { name: "customers" };
  if ((m = /^\/customers\/([0-9a-f-]{36})$/i.exec(p))) return { name: "customer", id: m[1] };
  if (p === "/activity") return { name: "activity", tab: q.get("tab") === "feedback" ? "feedback" : "requests" };
  if (p === "/setup") return { name: "setup" };
  return { name: "today", unknown: true };
}

export default function useRoute() {
  const [loc, setLoc] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const on = () => setLoc(window.location.pathname + window.location.search);
    listeners.add(on);
    window.addEventListener("popstate", on);
    // A child can navigate during its first effect, before this listener
    // existed (child effects run first): catch up with the real URL.
    on();
    return () => { listeners.delete(on); window.removeEventListener("popstate", on); };
  }, []);
  const [path, search = ""] = loc.split("?");
  return { path: loc, ...matchRoute(path, search ? `?${search}` : "") };
}

/** <a> that routes in-app (keeps cmd-click / long-press open-in-new-tab working). */
export function linkProps(to) {
  return {
    href: to,
    onClick: (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
