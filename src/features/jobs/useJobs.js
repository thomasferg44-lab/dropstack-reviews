import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";

const SELECT = "id, customer_id, description, completed_at, created_at, customer:reviews_customers(id, name, phone, email)";

function toRow(input) {
  return {
    customer_id: input.customerId,
    description: String(input.description ?? "").trim() || null,
    // A date-only input has no timezone. Store it as midday local so the day
    // shown never shifts when it is rendered back in another offset.
    completed_at: input.completedAt ? new Date(`${input.completedAt}T12:00:00`).toISOString() : null,
  };
}

export function useJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error } = await supabase
      .from("reviews_jobs")
      .select(SELECT)
      .order("completed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setJobs(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addJob = useCallback(async (input) => {
    const { data, error } = await supabase.from("reviews_jobs").insert(toRow(input)).select(SELECT).single();
    if (error) return { error: error.message };
    setJobs((prev) => [data, ...prev]);
    return { error: null, job: data };
  }, []);

  const updateJob = useCallback(async (id, input) => {
    const { data, error } = await supabase.from("reviews_jobs").update(toRow(input)).eq("id", id).select(SELECT).single();
    if (error) return { error: error.message };
    setJobs((prev) => prev.map((j) => (j.id === id ? data : j)));
    return { error: null, job: data };
  }, []);

  const deleteJob = useCallback(async (id) => {
    const { error } = await supabase.from("reviews_jobs").delete().eq("id", id);
    if (error) return { error: error.message };
    setJobs((prev) => prev.filter((j) => j.id !== id));
    return { error: null };
  }, []);

  return { jobs, loading, error, refresh, addJob, updateJob, deleteJob };
}
