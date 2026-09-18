import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { normalisePhone, normaliseEmail } from "../../lib/format.js";

function friendlyError(error) {
  if (!error) return "";
  if (error.code === "23505") return "A customer with this phone number already exists.";
  return error.message;
}

function toRow(input) {
  return {
    name: String(input.name ?? "").trim(),
    phone: normalisePhone(input.phone),
    email: normaliseEmail(input.email),
  };
}

export function useCustomers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error } = await supabase
      .from("reviews_customers")
      .select("id, name, phone, email, created_at")
      .order("created_at", { ascending: false });
    if (error) setError(friendlyError(error));
    else setCustomers(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Both return { error: string | null } so the form can show it inline.
  const addCustomer = useCallback(async (input) => {
    const { data, error } = await supabase
      .from("reviews_customers")
      .insert(toRow(input))
      .select("id, name, phone, email, created_at")
      .single();
    if (error) return { error: friendlyError(error) };
    setCustomers((prev) => [data, ...prev]);
    return { error: null, customer: data };
  }, []);

  const updateCustomer = useCallback(async (id, input) => {
    const { data, error } = await supabase
      .from("reviews_customers")
      .update(toRow(input))
      .eq("id", id)
      .select("id, name, phone, email, created_at")
      .single();
    if (error) return { error: friendlyError(error) };
    setCustomers((prev) => prev.map((c) => (c.id === id ? data : c)));
    return { error: null, customer: data };
  }, []);

  // Bulk insert. Rows whose phone already exists are skipped (ON CONFLICT DO
  // NOTHING on phone) and reported, never overwritten. Returns counts + the
  // rows that were skipped as already-existing, so the UI can list them.
  const importCustomers = useCallback(async (rows) => {
    const CHUNK = 200;
    let inserted = 0;
    const existing = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map(toRow);
      const { data, error } = await supabase
        .from("reviews_customers")
        .upsert(chunk, { onConflict: "phone", ignoreDuplicates: true })
        .select("id, name, phone, email, created_at");
      if (error) return { error: friendlyError(error), inserted, existing };
      inserted += data.length;
      const got = new Set(data.map((d) => d.phone).filter(Boolean));
      chunk.forEach((c) => { if (c.phone && !got.has(c.phone)) existing.push(c); });
    }
    await refresh();
    return { error: null, inserted, existing };
  }, [refresh]);

  return { customers, loading, error, refresh, addCustomer, updateCustomer, importCustomers };
}
