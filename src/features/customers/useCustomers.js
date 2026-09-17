import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";

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
    if (error) setError(error.message);
    else setCustomers(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { customers, loading, error, refresh };
}
