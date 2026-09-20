import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { summariseRequests } from "./stats.js";

const SELECT = "id, channel, sent_at, clicked_at, created_at, customer:reviews_customers(id, name, email, phone)";

export function useHistory() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error } = await supabase
      .from("reviews_requests")
      .select(SELECT)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false });
    if (error) setError(error.message);
    else setRequests(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stats = useMemo(() => summariseRequests(requests), [requests]);

  return { requests, stats, loading, error, refresh };
}
