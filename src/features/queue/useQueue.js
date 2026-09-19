import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { companyConfig } from "../../../companyConfig.js";
import { buildQueue } from "./eligibility.js";

// The queue is computed in the browser from three small reads rather than a
// database view. Tradeoff: one round trip per table and O(customers) work on the
// client, against no extra SQL surface to secure and RLS-verify. At the scale of
// a single service business (hundreds to low thousands of rows) this is cheap;
// if a client ever outgrows it, the replacement is a view with security_invoker
// plus its own verify-rls checks.
export function useQueue() {
  const [data, setData] = useState({ customers: [], jobs: [], requests: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const [c, j, r] = await Promise.all([
      supabase.from("reviews_customers").select("id, name, phone, email, created_at"),
      supabase.from("reviews_jobs").select("id, customer_id, description, completed_at").not("completed_at", "is", null),
      supabase.from("reviews_requests").select("id, customer_id, job_id, channel, sent_at").not("sent_at", "is", null),
    ]);
    const failed = [c, j, r].find((res) => res.error);
    if (failed) setError(failed.error.message);
    else setData({ customers: c.data ?? [], jobs: j.data ?? [], requests: r.data ?? [] });
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const queue = useMemo(
    () => buildQueue({ ...data, cooldownDays: companyConfig.cooldownDays }),
    [data]
  );

  // Creates the request row and stamps sent_at. The token comes back from the
  // database default, and the tracked link is built from it.
  const createRequest = useCallback(async ({ customerId, jobId, channel }) => {
    const { data: row, error } = await supabase
      .from("reviews_requests")
      .insert({ customer_id: customerId, job_id: jobId ?? null, channel, sent_at: new Date().toISOString() })
      .select("id, token, customer_id, job_id, channel, sent_at")
      .single();
    if (error) return { error: error.message };
    setData((prev) => ({ ...prev, requests: [...prev.requests, row] }));
    return { error: null, request: row };
  }, []);

  // Used when the owner says they did not actually send it, so the cooldown
  // does not hide a customer who was never contacted.
  const undoRequest = useCallback(async (id) => {
    const { error } = await supabase.from("reviews_requests").delete().eq("id", id);
    if (error) return { error: error.message };
    setData((prev) => ({ ...prev, requests: prev.requests.filter((r) => r.id !== id) }));
    return { error: null };
  }, []);

  return { ...queue, loading, error, refresh, createRequest, undoRequest, sentCount: data.requests.length };
}
