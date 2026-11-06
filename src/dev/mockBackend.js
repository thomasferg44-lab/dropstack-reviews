// LOCAL TEST BACKEND. Never used in a real deploy.
//
// An in-memory stand-in for the slice of supabase-js this app uses, so every
// flow can be driven in a browser (gate runs, screenshots, laptop demos)
// without a network and without touching any real database. Active only when
// the build sets VITE_MOCK_BACKEND=1 (see src/lib/supabase.js); otherwise the
// import is dead code and is dropped from the bundle.
//
// It mirrors the real access model closely enough to exercise the UI:
//   * no session -> every table and owner RPC is denied (anon has no grants)
//   * authenticated -> full access to reviews_* (same as the RLS policies)
//   * from supabase/schema.sql, re-expressed: the token default, unique(phone),
//     the channel check, FK cascades (job delete -> request.job_id null), the
//     ONE-follow-up guard, demo inheritance, reviews_load_demo/remove_demo
// The SQL itself is verified separately (supabase/local-test, verify-*.sql);
// a pass here proves the UI and the pure logic, not the database.
//
// Persisted in localStorage so reloads keep state, and shared with the
// landing's mock (src/dev/mockPublic.js) on the same origin.
// Test switches (localStorage):
//   dropstack-mock-latency  ms per call (default 120)
//   dropstack-mock-fail     "all" -> every call fails like a dropped network
//   dropstack-mock-schema   "legacy" -> the database BEFORE the 2026-11-05 patch
export const DB_KEY = "dropstack-mock-db-v1";
const SESSION_KEY = "dropstack-mock-session-v1";
export const MOCK_OWNER_ID = "00000000-0000-4000-8000-0000000a11c0";

const mem = new Map();
const hasLs = () => { try { return typeof localStorage !== "undefined" && localStorage !== null && typeof localStorage.getItem === "function"; } catch { return false; } };
const ls = {
  get(k) { if (hasLs()) { try { return localStorage.getItem(k); } catch { /* fall through */ } } return mem.has(k) ? mem.get(k) : null; },
  set(k, v) { if (hasLs()) { try { localStorage.setItem(k, v); return; } catch { /* fall through */ } } mem.set(k, v); },
  del(k) { if (hasLs()) { try { localStorage.removeItem(k); return; } catch { /* fall through */ } } mem.delete(k); },
};
export const mockStore = ls;
const legacy = () => ls.get("dropstack-mock-schema") === "legacy";
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const err = (code, message) => ({ data: null, error: { code, message } });
function newToken() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- schema ------------------------------------------------------------------
const V1 = {
  reviews_customers: ["id", "name", "phone", "email", "created_at"],
  reviews_jobs: ["id", "customer_id", "description", "completed_at", "created_at"],
  reviews_requests: ["id", "customer_id", "job_id", "channel", "token", "sent_at", "clicked_at", "created_at"],
};
const V2_EXTRA = {
  reviews_customers: ["is_demo"],
  reviews_jobs: ["is_demo"],
  reviews_requests: ["is_demo", "google_clicked_at", "feedback_rating", "feedback_comment", "feedback_at", "followed_up_at", "follow_up_channel"],
  reviews_showcase: ["id", "author_name", "rating", "body", "reviewed_on", "published", "sort_order", "is_demo", "created_at"],
};
function columns(table) {
  if (legacy()) return V1[table] ?? null;
  if (table === "reviews_showcase") return V2_EXTRA.reviews_showcase;
  return V1[table] ? [...V1[table], ...(V2_EXTRA[table] ?? [])] : null;
}
const DEFAULTS = {
  reviews_customers: () => ({ phone: null, email: null, is_demo: false }),
  reviews_jobs: () => ({ description: null, completed_at: null, is_demo: false }),
  reviews_requests: () => ({ job_id: null, sent_at: null, clicked_at: null, is_demo: false, google_clicked_at: null, feedback_rating: null,
    feedback_comment: null, feedback_at: null, followed_up_at: null, follow_up_channel: null }),
  reviews_showcase: () => ({ reviewed_on: null, published: true, sort_order: 0, is_demo: false }),
};
// child -> [fk, parent, on delete]
const FKS = {
  reviews_jobs: [["customer_id", "reviews_customers", "cascade"]],
  reviews_requests: [["customer_id", "reviews_customers", "cascade"], ["job_id", "reviews_jobs", "set null"]],
};

let memory = null;
function db() {
  const raw = ls.get(DB_KEY);
  if (raw) { try { memory = JSON.parse(raw); } catch { /* keep memory */ } }
  else memory = {}; // cleared (or never written): start empty
  if (!memory) memory = {};
  for (const t of ["reviews_customers", "reviews_jobs", "reviews_requests", "reviews_showcase"]) memory[t] ??= [];
  return memory;
}
function save(state) { memory = state; ls.set(DB_KEY, JSON.stringify(state)); }

async function delay() {
  const ms = Number(ls.get("dropstack-mock-latency") ?? 120);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  if (ls.get("dropstack-mock-fail") === "all") throw Object.assign(new TypeError("Failed to fetch"), { name: "TypeError" });
}

// ---- triggers + constraints (schema.sql) -----------------------------------------
function beforeWrite(table, row, old, state) {
  if (legacy()) for (const k of Object.keys(row)) if (!V1[table]?.includes(k) && k !== "id") delete row[k];
  if (table === "reviews_customers") {
    if (!String(row.name ?? "").trim()) return ["23502", 'null value in column "name" violates not-null constraint'];
    if (row.phone && state.reviews_customers.some((c) => c.id !== row.id && c.phone === row.phone)) {
      return ["23505", 'duplicate key value violates unique constraint "reviews_customers_phone_key"'];
    }
  }
  if (table === "reviews_jobs" || table === "reviews_requests") {
    if (!state.reviews_customers.some((c) => c.id === row.customer_id)) return ["23503", `${table}_customer_id_fkey`];
    if (!old && !legacy() && !row.is_demo) row.is_demo = Boolean(state.reviews_customers.find((c) => c.id === row.customer_id)?.is_demo); // reviews_inherit_demo
  }
  if (table === "reviews_requests") {
    if (!["whatsapp", "email"].includes(row.channel)) return ["23514", "reviews_requests_channel_check"];
    if (state.reviews_requests.some((r) => r.id !== row.id && r.token === row.token)) return ["23505", "reviews_requests_token_key"];
    if (!legacy()) {
      // reviews_guard_follow_up(): ONE follow-up per request, every role.
      if (old && old.followed_up_at && (row.followed_up_at !== old.followed_up_at || row.follow_up_channel !== old.follow_up_channel)) {
        return ["23514", "This request has already been followed up. One follow-up per request is the limit."];
      }
      if (row.followed_up_at && (!old || !old.followed_up_at)) {
        if (!row.sent_at) return ["23514", "A request has to be sent before it can be followed up."];
        if (row.followed_up_at < row.sent_at) return ["23514", "A follow-up cannot be dated before the request it follows."];
      }
      if ((row.followed_up_at == null) !== (row.follow_up_channel == null)) return ["23514", "reviews_requests_follow_up_pair"];
      if (row.feedback_rating != null && !(row.feedback_rating >= 1 && row.feedback_rating <= 5)) return ["23514", "reviews_requests_feedback_rating_range"];
    }
  }
  if (table === "reviews_showcase") {
    const a = String(row.author_name ?? "").trim(), b = String(row.body ?? "").trim();
    if (!a || a.length > 60) return ["23514", "reviews_showcase_author_len"];
    if (!b || b.length > 600) return ["23514", "reviews_showcase_body_len"];
    if (!(row.rating >= 1 && row.rating <= 5)) return ["23514", "reviews_showcase_rating_range"];
  }
  return null;
}
function deleteRows(state, table, ids) {
  for (const [child, fks] of Object.entries(FKS)) {
    for (const [fk, parent, mode] of fks) {
      if (parent !== table) continue;
      if (mode === "set null") { for (const r of state[child]) if (ids.includes(r[fk])) r[fk] = null; }
      else {
        const gone = state[child].filter((r) => ids.includes(r[fk])).map((r) => r.id);
        if (gone.length) deleteRows(state, child, gone);
      }
    }
  }
  state[table] = state[table].filter((r) => !ids.includes(r.id));
}

// ---- select parsing: "id, customer:reviews_customers(id, name)" --------------
function splitTop(s) {
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseSelect(s) {
  return splitTop(s || "*").map((item) => {
    const m = /^(?:(\w+):)?(\w+)\((.*)\)$/s.exec(item);
    if (m) return { embed: true, alias: m[1] ?? m[2], table: m[2], inner: parseSelect(m[3]) };
    const [alias, col] = item.includes(":") ? item.split(":") : [item, item];
    return { col: col.trim(), alias: alias.trim() };
  });
}
function project(state, table, row, sel) {
  const cols = columns(table);
  const out = {};
  for (const s of sel) {
    if (s.embed) {
      if (!columns(s.table)) throw { code: "PGRST200", message: `Could not find a relationship between '${table}' and '${s.table}'` };
      const down = (FKS[s.table] ?? []).find(([, p]) => p === table);
      const up = (FKS[table] ?? []).find(([, p]) => p === s.table);
      if (up) {
        const parent = state[s.table].find((r) => r.id === row[up[0]]);
        out[s.alias] = parent ? project(state, s.table, parent, s.inner) : null;
      } else if (down) {
        out[s.alias] = state[s.table].filter((r) => r[down[0]] === row.id).map((r) => project(state, s.table, r, s.inner));
      }
    } else if (s.col === "*") {
      for (const c of cols) out[c] = clone(row[c] ?? null);
    } else {
      if (!cols.includes(s.col)) throw { code: "42703", message: `column ${table}.${s.col} does not exist` };
      out[s.alias] = clone(row[s.col] ?? null);
    }
  }
  return out;
}

// ---- query builder -------------------------------------------------------------
class Query {
  constructor(client, table) {
    Object.assign(this, { client, table, op: "select", sel: "*", filters: [], orderBy: [], lim: null, singleMode: null, returning: false });
  }
  select(cols = "*", opts = {}) { this.sel = cols; this.head = opts.head; this.countMode = opts.count; this.returning = true; return this; }
  insert(rows) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows, opts = {}) { this.op = "upsert"; this.payload = rows; this.upsertOpts = opts; return this; }
  update(patch) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k, v) { this.filters.push([k, (r) => r[k] === v]); return this; }
  neq(k, v) { this.filters.push([k, (r) => r[k] !== v]); return this; }
  in(k, arr) { this.filters.push([k, (r) => arr.includes(r[k])]); return this; }
  is(k, v) { this.filters.push([k, (r) => (r[k] ?? null) === v]); return this; }
  not(k, op, v) { if (op === "is") this.filters.push([k, (r) => (r[k] ?? null) !== v]); return this; }
  lt(k, v) { this.filters.push([k, (r) => r[k] != null && r[k] < v]); return this; }
  lte(k, v) { this.filters.push([k, (r) => r[k] != null && r[k] <= v]); return this; }
  gt(k, v) { this.filters.push([k, (r) => r[k] != null && r[k] > v]); return this; }
  gte(k, v) { this.filters.push([k, (r) => r[k] != null && r[k] >= v]); return this; }
  order(k, { ascending = true, nullsFirst } = {}) { this.orderBy.push({ k, ascending, nullsFirst: nullsFirst ?? !ascending }); return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.singleMode = "one"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  then(resolve, reject) { return this.run().then(resolve, reject); }

  async run() {
    try { await delay(); } catch (e) { return { data: null, error: { message: e.message, name: "TypeError" } }; }
    if (!this.client.session()) return err("42501", `permission denied for table ${this.table}`);
    const cols = columns(this.table);
    if (!cols) return err("PGRST205", `Could not find the table 'public.${this.table}' in the schema cache`);
    for (const [k] of this.filters) if (!cols.includes(k)) return err("42703", `column ${this.table}.${k} does not exist`);
    // PostgREST rejects an unknown selected column even when no rows match.
    for (const s of parseSelect(this.sel)) if (!s.embed && s.col !== "*" && !cols.includes(s.col)) return err("42703", `column ${this.table}.${s.col} does not exist`);
    for (const p of [].concat(["insert", "upsert", "update"].includes(this.op) ? this.payload : [])) {
      const bad = Object.keys(p ?? {}).find((k) => !cols.includes(k));
      if (bad) return err("PGRST204", `Could not find the '${bad}' column of '${this.table}' in the schema cache`);
    }
    const work = clone(db());
    let result = [];

    if (this.op === "insert" || this.op === "upsert") {
      for (const p of [].concat(this.payload)) {
        const row = { ...DEFAULTS[this.table](), id: uuid(), created_at: nowIso(), ...(this.table === "reviews_requests" ? { token: newToken() } : {}), ...clone(p) };
        if (this.op === "upsert" && this.upsertOpts?.onConflict === "phone" && row.phone && work[this.table].some((r) => r.phone === row.phone)) {
          if (this.upsertOpts.ignoreDuplicates) continue;
        }
        const bad = beforeWrite(this.table, row, null, work);
        if (bad) return err(...bad);
        work[this.table].push(row);
        result.push(row);
      }
    } else {
      const matched = work[this.table].filter((r) => this.filters.every(([, f]) => f(r)));
      if (this.op === "update") {
        for (const r of matched) {
          const next = { ...r, ...clone(this.payload) };
          const bad = beforeWrite(this.table, next, r, work);
          if (bad) return err(...bad);
          Object.assign(r, next);
          result.push(r);
        }
      } else if (this.op === "delete") {
        deleteRows(work, this.table, matched.map((r) => r.id));
        result = matched;
      } else result = matched;
    }
    if (this.op !== "select") save(work);

    for (const { k, ascending, nullsFirst } of [...this.orderBy].reverse()) {
      result = [...result].sort((a, b) => {
        const x = a[k], y = b[k];
        if (x == null && y == null) return 0;
        if (x == null) return nullsFirst ? -1 : 1;
        if (y == null) return nullsFirst ? 1 : -1;
        const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y));
        return c * (ascending ? 1 : -1);
      });
    }
    if (this.lim != null) result = result.slice(0, this.lim);
    if (this.op !== "select" && !this.returning) return { data: null, error: null };
    let data;
    try { data = result.map((r) => project(work, this.table, r, parseSelect(this.sel))); }
    catch (e) { return { data: null, error: e }; }
    if (this.singleMode === "one") {
      if (data.length !== 1) return err("PGRST116", "JSON object requested, multiple (or no) rows returned");
      return { data: data[0], error: null };
    }
    if (this.singleMode === "maybe") return { data: data[0] ?? null, error: null };
    if (this.head) return { data: null, count: data.length, error: null };
    return { data, error: null, count: this.countMode ? data.length : null };
  }
}

// ---- RPCs (mirror supabase/schema.sql) ------------------------------------------
async function rpc(client, fn, args = {}) {
  try { await delay(); } catch (e) { return { data: null, error: { message: e.message, name: "TypeError" } }; }
  if (!client.session()) return err("42501", `permission denied for function ${fn}`);
  if (legacy() && fn !== "reviews_open_link") return err("PGRST202", `Could not find the function public.${fn} in the schema cache`);
  const state = clone(db());
  try {
    if (fn === "reviews_load_demo") {
      const p = args.p ?? {};
      if (state.reviews_customers.some((c) => c.is_demo)) throw new Error("Demo data is already loaded. Remove it first.");
      const ids = {}, jobIds = {};
      for (const c of p.customers ?? []) {
        const phone = c.phone && !state.reviews_customers.some((x) => x.phone === c.phone) ? c.phone : null;
        const row = { ...DEFAULTS.reviews_customers(), id: uuid(), created_at: nowIso(), name: c.name, phone, email: c.email || null, is_demo: true };
        state.reviews_customers.push(row); ids[c.key] = row.id;
      }
      for (const j of p.jobs ?? []) {
        if (!ids[j.customer_key]) throw new Error(`Unknown customer key ${j.customer_key}`);
        const row = { id: uuid(), customer_id: ids[j.customer_key], description: j.description, completed_at: j.completed_at ?? null,
          created_at: j.created_at ?? j.completed_at ?? nowIso(), is_demo: true };
        state.reviews_jobs.push(row); if (j.key) jobIds[j.key] = row.id;
      }
      for (const r of p.requests ?? []) {
        if (!ids[r.customer_key]) throw new Error(`Unknown customer key ${r.customer_key}`);
        const row = { ...DEFAULTS.reviews_requests(), id: uuid(), token: newToken(), customer_id: ids[r.customer_key], job_id: jobIds[r.job_key] ?? null,
          channel: r.channel, sent_at: r.sent_at ?? null, clicked_at: r.clicked_at ?? null, google_clicked_at: r.google_clicked_at ?? null,
          feedback_rating: r.feedback_rating ?? null, feedback_comment: r.feedback_comment ?? null, feedback_at: r.feedback_at ?? null,
          followed_up_at: r.followed_up_at ?? null, follow_up_channel: r.follow_up_channel ?? null, created_at: nowIso(), is_demo: true };
        const bad = beforeWrite("reviews_requests", row, null, state);
        if (bad) throw new Error(bad[1]);
        state.reviews_requests.push(row);
      }
      (p.showcase ?? []).forEach((s, i) => state.reviews_showcase.push({ id: uuid(), author_name: s.author_name, rating: s.rating, body: s.body,
        reviewed_on: s.reviewed_on ?? null, published: true, sort_order: s.sort_order ?? i, is_demo: true, created_at: nowIso() }));
      save(state);
      return { data: { customers_created: (p.customers ?? []).length, jobs_created: (p.jobs ?? []).length,
        requests_created: (p.requests ?? []).length, showcase_created: (p.showcase ?? []).length }, error: null };
    }
    if (fn === "reviews_remove_demo") {
      const n = (t) => state[t].filter((r) => r.is_demo).length;
      const out = { requests_removed: n("reviews_requests"), jobs_removed: n("reviews_jobs"), showcase_removed: n("reviews_showcase") };
      for (const t of ["reviews_requests", "reviews_jobs", "reviews_showcase"]) state[t] = state[t].filter((r) => !r.is_demo);
      let kept = 0;
      for (const c of state.reviews_customers) {
        if (c.is_demo && (state.reviews_jobs.some((j) => j.customer_id === c.id) || state.reviews_requests.some((r) => r.customer_id === c.id))) { c.is_demo = false; kept++; }
      }
      const gone = state.reviews_customers.filter((c) => c.is_demo).map((c) => c.id);
      deleteRows(state, "reviews_customers", gone);
      save(state);
      return { data: { ...out, customers_removed: gone.length, customers_kept: kept }, error: null };
    }
    return err("PGRST202", `Could not find the function public.${fn} in the schema cache`);
  } catch (e) {
    return { data: null, error: { code: "P0001", message: e.message } };
  }
}

// ---- client --------------------------------------------------------------------
export function createMockClient() {
  const authListeners = new Set();
  const session = () => {
    const raw = ls.get(SESSION_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const notify = (event) => { for (const l of authListeners) l(event, session()); };
  const client = {
    session,
    auth: {
      async getSession() { return { data: { session: session() }, error: null }; },
      async getUser() { const s = session(); return { data: { user: s?.user ?? null }, error: null }; },
      onAuthStateChange(cb) {
        authListeners.add(cb);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
      },
      async signInWithPassword({ email, password }) {
        await new Promise((r) => setTimeout(r, 300));
        if (ls.get("dropstack-mock-fail") === "all") {
          return { data: null, error: { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 } };
        }
        if (!email || password === "wrong") {
          return { data: null, error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 } };
        }
        const s = { access_token: "mock", user: { id: MOCK_OWNER_ID, email } };
        ls.set(SESSION_KEY, JSON.stringify(s));
        notify("SIGNED_IN");
        return { data: { session: s }, error: null };
      },
      async signOut() { ls.del(SESSION_KEY); notify("SIGNED_OUT"); return { error: null }; },
    },
    from: (table) => new Query(client, table),
    rpc: (fn, args) => rpc(client, fn, args),
  };
  return client;
}
