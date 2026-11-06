// Every database read and write the dashboard makes. Thin on purpose: the
// rules live in the database (RLS, the follow-up guard) and in pure modules.
//
// Schema level: "v2" once supabase/patches/2026-11-05-compete-upgrades.sql is
// applied, "v1" before. On v1 the app still works (ask, send, history, link
// opens); the patch-dependent features (feedback, Google taps, follow-up,
// demo, showcase) show as waiting for the database update instead of erroring.
import { normalisePhone, normaliseEmail } from "./format.js";

const CUSTOMER_COLS_V1 = "id, name, phone, email, created_at";
const JOB_COLS_V1 = "id, customer_id, description, completed_at, created_at";
const REQ_COLS_V1 = "id, customer_id, job_id, channel, token, sent_at, clicked_at, created_at";
const V2 = {
  customer: ", is_demo",
  job: ", is_demo",
  request: ", is_demo, google_clicked_at, feedback_rating, feedback_comment, feedback_at, followed_up_at, follow_up_channel",
};

let level = "unknown";
// The Supabase client: set once at startup (src/main.jsx). Node tests inject
// the local test backend. Kept out of this module's imports so it stays
// importable without Vite.
let client = null;
export const useClient = (c) => { client = c; level = "unknown"; };
export const getSchemaLevel = () => level;
const cols = (base, extra) => (level === "v2" ? base + extra : base);

const fail = (error) => {
  const e = new Error(friendly(error));
  e.code = error?.code;
  e.name = error?.name === "TypeError" ? "TypeError" : "DbError";
  throw e;
};
export function friendly(error) {
  if (!error) return "";
  if (error.code === "23505" && /phone/.test(error.message)) return "A customer with this phone number already exists.";
  if (error.name === "TypeError" || /failed to fetch|network/i.test(error.message ?? "")) return "Couldn't reach the server. Check your connection and try again.";
  return error.message ?? "Something went wrong.";
}

export async function detectSchema() {
  const { error } = await client.from("reviews_requests").select("id, is_demo, followed_up_at").limit(1);
  if (!error) level = "v2";
  else if (error.code === "42703" || /column .* does not exist|schema cache/i.test(error.message ?? "")) level = "v1";
  else fail(error);
  return level;
}

export async function loadAll() {
  const [c, j, r, s] = await Promise.all([
    client.from("reviews_customers").select(cols(CUSTOMER_COLS_V1, V2.customer)).order("created_at", { ascending: false }),
    client.from("reviews_jobs").select(cols(JOB_COLS_V1, V2.job)).order("completed_at", { ascending: false, nullsFirst: true }),
    client.from("reviews_requests").select(cols(REQ_COLS_V1, V2.request)).order("created_at", { ascending: false }),
    level === "v2" ? client.from("reviews_showcase").select("*").order("sort_order") : Promise.resolve({ data: [] }),
  ]);
  for (const res of [c, j, r, s]) if (res.error) fail(res.error);
  return { customers: c.data ?? [], jobs: j.data ?? [], requests: r.data ?? [], showcase: s.data ?? [] };
}

// ---- customers -----------------------------------------------------------------
export function customerRow(input) {
  return { name: String(input.name ?? "").trim(), phone: normalisePhone(input.phone), email: normaliseEmail(input.email) };
}
export async function saveCustomer(input) {
  const row = customerRow(input);
  const q = input.id
    ? client.from("reviews_customers").update(row).eq("id", input.id)
    : client.from("reviews_customers").insert(row);
  const { data, error } = await q.select(cols(CUSTOMER_COLS_V1, V2.customer)).single();
  if (error) fail(error);
  return data;
}
export async function deleteCustomer(id) {
  const { error } = await client.from("reviews_customers").delete().eq("id", id);
  if (error) fail(error);
}
/** Bulk import. Existing phones are skipped (never overwritten) and reported. */
export async function importCustomers(rows) {
  const CHUNK = 200;
  let inserted = 0;
  const existing = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map(customerRow);
    const { data, error } = await client.from("reviews_customers")
      .upsert(chunk, { onConflict: "phone", ignoreDuplicates: true }).select("id, phone");
    if (error) fail(error);
    inserted += data.length;
    const got = new Set(data.map((d) => d.phone).filter(Boolean));
    chunk.forEach((c) => { if (c.phone && !got.has(c.phone)) existing.push(c); });
  }
  return { inserted, existing };
}

// ---- jobs ------------------------------------------------------------------------
// A date-only input has no timezone. Store it as midday SA time so the day shown
// never shifts when rendered back.
export const dateToIso = (d) => (d ? new Date(`${d}T12:00:00+02:00`).toISOString() : null);
export async function saveJob(input) {
  const row = { customer_id: input.customerId, description: String(input.description ?? "").trim() || null, completed_at: input.completedAt ? dateToIso(input.completedAt) : null };
  const q = input.id ? client.from("reviews_jobs").update(row).eq("id", input.id) : client.from("reviews_jobs").insert(row);
  const { data, error } = await q.select(cols(JOB_COLS_V1, V2.job)).single();
  if (error) fail(error);
  return data;
}
export async function completeJob(id, completedAt = new Date().toISOString()) {
  const { data, error } = await client.from("reviews_jobs").update({ completed_at: completedAt }).eq("id", id).select(cols(JOB_COLS_V1, V2.job)).single();
  if (error) fail(error);
  return data;
}
export async function deleteJob(id) {
  const { error } = await client.from("reviews_jobs").delete().eq("id", id);
  if (error) fail(error);
}

// ---- requests --------------------------------------------------------------------
/**
 * Opening the composer reserves a request row (sent_at null) so the tracked
 * link exists before the owner taps. Unsent rows are ignored everywhere: the
 * queue, the cooldown and every number. The channel is logged on the row.
 */
export async function createDraftRequest({ customerId, jobId, channel }) {
  const { data, error } = await client.from("reviews_requests")
    .insert({ customer_id: customerId, job_id: jobId ?? null, channel, sent_at: null })
    .select(cols(REQ_COLS_V1, V2.request)).single();
  if (error) fail(error);
  return data;
}
/** The owner tapped send. Records the channel actually used and the time. */
export async function markSent(id, channel) {
  const { data, error } = await client.from("reviews_requests")
    .update({ sent_at: new Date().toISOString(), channel }).eq("id", id).is("sent_at", null)
    .select(cols(REQ_COLS_V1, V2.request)).maybeSingle();
  if (error) fail(error);
  return data;
}
/** "Didn't send it": removes the row so the cooldown doesn't hide them. */
export async function deleteRequest(id) {
  const { error } = await client.from("reviews_requests").delete().eq("id", id);
  if (error) fail(error);
}
/** Clears drafts the owner opened but never sent. */
export async function discardDraft(id) {
  const { error } = await client.from("reviews_requests").delete().eq("id", id).is("sent_at", null);
  if (error) fail(error);
}

/**
 * The ONE follow-up. Only updates a row that hasn't been followed up; the
 * database guard refuses a second one even if this filter were bypassed.
 * Returns the row, or throws with code "already-followed-up".
 */
export async function recordFollowUp(id, channel) {
  const { data, error } = await client.from("reviews_requests")
    .update({ followed_up_at: new Date().toISOString(), follow_up_channel: channel })
    .eq("id", id).is("followed_up_at", null)
    .select(cols(REQ_COLS_V1, V2.request)).maybeSingle();
  if (error && error.code !== "23514") fail(error);
  if (error || !data) {
    const e = new Error("Already followed up once. One follow-up per request is the limit.");
    e.code = "already-followed-up";
    throw e;
  }
  return data;
}

/** Email via the Netlify Function (server-side Resend). */
export async function sendEmail(requestId, { followUp = false } = {}) {
  const { data: { session } } = await client.auth.getSession();
  const res = await fetch("/.netlify/functions/send-review-request", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ requestId, followUp }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body.error || `Send failed (${res.status}).`);
    e.status = res.status;
    throw e;
  }
  return body;
}

// ---- showcase --------------------------------------------------------------------
export async function saveShowcase(input) {
  const row = { author_name: String(input.author_name ?? "").trim(), rating: Number(input.rating), body: String(input.body ?? "").trim(),
    reviewed_on: input.reviewed_on || null, published: input.published !== false };
  const q = input.id ? client.from("reviews_showcase").update(row).eq("id", input.id) : client.from("reviews_showcase").insert(row);
  const { data, error } = await q.select("*").single();
  if (error) fail(error);
  return data;
}
export async function deleteShowcase(id) {
  const { error } = await client.from("reviews_showcase").delete().eq("id", id);
  if (error) fail(error);
}

// ---- demo --------------------------------------------------------------------------
export async function loadDemo(payload) {
  const { data, error } = await client.rpc("reviews_load_demo", { p: payload });
  if (error) fail(error);
  return data;
}
export async function removeDemo() {
  const { data, error } = await client.rpc("reviews_remove_demo");
  if (error) fail(error);
  return data;
}
