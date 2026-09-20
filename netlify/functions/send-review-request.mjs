import { companyConfig } from "../../companyConfig.js";
import { buildEmail } from "../../src/lib/email.js";
import { buildTrackedLink } from "../../src/lib/templates.js";

// Sends one review-request email through Resend.
//
// SECURITY — two things keep this from being an open relay:
//
//  1. The caller must present the owner's Supabase access token. We do not merely
//     decode it; we use it to read the request row through PostgREST, so RLS is
//     what actually decides. An anon or forged token reads nothing and gets 401.
//
//  2. The recipient is never taken from the request body. The browser sends only
//     a request id; the address, name and job come from the database. Without
//     this, an authenticated caller could still post arbitrary addresses and mail
//     strangers from the client's domain.
//
// RESEND_API_KEY is read from the environment and must never be VITE_ prefixed,
// which would publish it in the browser bundle.

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SELECT =
  "id,token,channel,sent_at,customer:reviews_customers(id,name,email),job:reviews_jobs(id,description,completed_at)";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return json(500, { error: "Supabase environment variables are not set." });

  const accessToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return json(401, { error: "Not signed in." });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Expected a JSON body." });
  }

  const requestId = String(body?.requestId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json(400, { error: "A valid requestId is required." });

  // The owner's own token does the read. RLS decides, not this function.
  const lookup = await fetch(
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/reviews_requests?id=eq.${encodeURIComponent(requestId)}&select=${encodeURIComponent(SELECT)}`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
  );
  if (lookup.status === 401 || lookup.status === 403) return json(401, { error: "Not signed in." });
  if (!lookup.ok) return json(502, { error: "Couldn't read the request from the database." });

  const [row] = await lookup.json();
  if (!row) return json(404, { error: "That request no longer exists." });

  const origin = new URL(req.url).origin;
  const message = buildEmail({
    customer: row.customer,
    job: row.job,
    businessName: companyConfig.businessName,
    template: companyConfig.templates?.email,
    reviewLink: buildTrackedLink(origin, row.token),
    primaryColor: companyConfig.primaryColor,
  });
  if (message.error) return json(422, { error: message.error });

  const from = String(companyConfig.fromEmail ?? "").trim();
  if (!from) return json(500, { error: "No fromEmail is set in companyConfig.js." });

  // Development safety valve. Set DEV_BLOCK_REAL_SENDS=false only in Netlify.
  if (String(process.env.DEV_BLOCK_REAL_SENDS ?? "true").toLowerCase() !== "false") {
    console.log("[send-review-request] BLOCKED (DEV_BLOCK_REAL_SENDS). Would have sent:", {
      to: message.to, subject: message.subject,
    });
    return json(200, { blocked: true, to: message.to, subject: message.subject });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return json(500, { error: "RESEND_API_KEY is not set." });

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(companyConfig.replyToEmail ? { reply_to: [companyConfig.replyToEmail] } : {}),
    }),
  });

  if (!sent.ok) {
    const detail = await sent.text().catch(() => "");
    console.error("[send-review-request] Resend rejected the send:", sent.status, detail);
    return json(502, { error: `Email provider rejected the send (${sent.status}).` });
  }

  const result = await sent.json().catch(() => ({}));
  return json(200, { blocked: false, to: message.to, id: result.id ?? null });
};
