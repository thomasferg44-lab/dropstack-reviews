import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as db from "../lib/db.js";
import { saveSnapshot, loadSnapshot } from "../lib/cache.js";

// One live copy of the business's review activity for every screen. Renders
// instantly from the last good snapshot on this device, then refreshes in
// place (no full-page reloads, no spinner page). If the network drops, the
// cached view stays on screen with an "offline" line.
const Ctx = createContext(null);
export const useData = () => useContext(Ctx);

const isNetworkError = (e) => e?.name === "TypeError" || /failed to fetch|network|load failed|reach the server/i.test(String(e?.message ?? ""));
const EMPTY = { customers: [], jobs: [], requests: [], showcase: [] };

export function DataProvider({ user, children }) {
  const uid = user.id;
  const snap = useRef(loadSnapshot(uid));
  const [data, setData] = useState(snap.current ? { ...EMPTY, ...snap.current } : null);
  const [schema, setSchema] = useState(db.getSchemaLevel());
  const [status, setStatus] = useState(snap.current ? "cached" : "loading");
  const [offline, setOffline] = useState(false);
  const [lastSync, setLastSync] = useState(snap.current?.at ?? null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setSchema(await db.detectSchema());
      const next = await db.loadAll();
      setData(next);
      setStatus("ready");
      setOffline(false);
      setError(null);
      const at = new Date().toISOString();
      setLastSync(at);
      saveSnapshot(uid, next, at);
    } catch (e) {
      if (isNetworkError(e)) setOffline(true);
      setStatus((s) => (s === "loading" ? "error" : s));
      setError(e.message);
    }
  }, [uid]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const back = () => refresh();
    const vis = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("online", back);
    document.addEventListener("visibilitychange", vis);
    return () => { window.removeEventListener("online", back); document.removeEventListener("visibilitychange", vis); };
  }, [refresh]);

  const upsert = (table, row) => setData((d) => {
    const list = d?.[table] ?? [];
    const i = list.findIndex((r) => r.id === row.id);
    return { ...(d ?? EMPTY), [table]: i === -1 ? [row, ...list] : list.map((r) => (r.id === row.id ? row : r)) };
  });
  const remove = (table, id) => setData((d) => ({ ...(d ?? EMPTY), [table]: (d?.[table] ?? []).filter((r) => r.id !== id) }));
  const run = useCallback(async (fn) => { const out = await fn(); await refresh(); return out; }, [refresh]);

  const actions = useMemo(() => ({
    saveCustomer: async (c) => { const row = await db.saveCustomer(c); upsert("customers", row); return row; },
    deleteCustomer: (id) => run(() => db.deleteCustomer(id)),
    importCustomers: (rows) => run(() => db.importCustomers(rows)),
    saveJob: async (j) => { const row = await db.saveJob(j); upsert("jobs", row); return row; },
    completeJob: async (id, at) => { const row = await db.completeJob(id, at); upsert("jobs", row); return row; },
    deleteJob: (id) => run(() => db.deleteJob(id)),
    createDraftRequest: async (p) => { const row = await db.createDraftRequest(p); upsert("requests", row); return row; },
    markSent: async (id, channel) => { const row = await db.markSent(id, channel); if (row) upsert("requests", row); return row; },
    discardDraft: async (id) => { await db.discardDraft(id); remove("requests", id); },
    deleteRequest: async (id) => { await db.deleteRequest(id); remove("requests", id); },
    recordFollowUp: async (id, channel) => { const row = await db.recordFollowUp(id, channel); upsert("requests", row); return row; },
    sendEmail: db.sendEmail,
    saveShowcase: async (s) => { const row = await db.saveShowcase(s); upsert("showcase", row); return row; },
    deleteShowcase: async (id) => { await db.deleteShowcase(id); remove("showcase", id); },
    loadDemo: (p) => run(() => db.loadDemo(p)),
    removeDemo: () => run(() => db.removeDemo()),
  }), [run]);

  const value = useMemo(() => ({
    user, ...(data ?? EMPTY), loaded: data !== null, schema, status, offline, lastSync, error, refresh, ...actions,
  }), [user, data, schema, status, offline, lastSync, error, refresh, actions]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
