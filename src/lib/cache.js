// Device-side helpers for a cheap phone on flaky data:
//   - the last good snapshot, so the dashboard renders instantly and still
//     renders offline
//   - composer drafts, so an edited message survives a reload or a drop
//   - small per-device preferences (onboarding)
// Everything with customer data is wiped on sign-out (POPIA: nothing lingers
// on a shared phone). Preferences hold no customer data and are kept.
const PREFIX = "reviews:";
const store = {
  get(k) { try { return localStorage.getItem(PREFIX + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(PREFIX + k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(PREFIX + k); } catch { /* ignore */ } },
  keys() { try { return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length)); } catch { return []; } },
};
const readJson = (k, fallback) => { try { const v = store.get(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };

export function saveSnapshot(userId, data, at = new Date().toISOString()) {
  return store.set(`snap:${userId}`, JSON.stringify({ at, ...data }));
}
export function loadSnapshot(userId) { return readJson(`snap:${userId}`, null); }

const draftKey = (userId, key) => `draft:${userId}:${key}`;
export function saveDraft(userId, key, text) { return store.set(draftKey(userId, key), JSON.stringify({ text, savedAt: new Date().toISOString() })); }
export function loadDraft(userId, key) { return readJson(draftKey(userId, key), null); }
export function clearDraft(userId, key) { store.del(draftKey(userId, key)); }

export function wipeDevice() { for (const k of store.keys()) if (!k.startsWith("pref:")) store.del(k); }

export const prefs = {
  get: (k) => readJson(`pref:${k}`, null),
  set: (k, v) => store.set(`pref:${k}`, JSON.stringify(v)),
};
