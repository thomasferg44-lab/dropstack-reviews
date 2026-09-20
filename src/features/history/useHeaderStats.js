import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { summariseRequests } from "./stats.js";

// Deliberately narrow: two timestamp columns for the last 30 days, nothing else.
// The header does not need customer data and should not pull it.
export function useHeaderStats() {
  const [rows, setRows] = useState([]);

  const refresh = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data, error } = await supabase
      .from("reviews_requests")
      .select("sent_at, clicked_at")
      .not("sent_at", "is", null)
      .gte("sent_at", since);
    if (!error) setRows(data ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return useMemo(() => summariseRequests(rows), [rows]);
}
