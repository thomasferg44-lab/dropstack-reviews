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

  return { customers, loading, error, refresh, addCustomer, updateCustomer };
}
