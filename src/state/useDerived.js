import { useMemo } from "react";
import { useData } from "./DataStore.jsx";
import { buildQueue } from "../features/queue/eligibility.js";
import { buildFollowUpQueue, followUpSettings } from "../lib/followup.js";
import { summarise } from "../lib/responses.js";
import { companyConfig } from "../../companyConfig.js";

/** Everything screens compute from the raw rows, computed once. */
export default function useDerived() {
  const { customers, jobs, requests, showcase, schema } = useData();
  return useMemo(() => {
    const now = new Date();
    const sent = requests.filter((r) => r.sent_at);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const ask = buildQueue({ customers, jobs, requests: sent, cooldownDays: companyConfig.cooldownDays, now });
    const followUps = schema === "v2" ? buildFollowUpQueue({ requests: sent, customers, jobs, now, settings: followUpSettings(companyConfig) }) : [];
    const stats = summarise(sent, { now, windowDays: 30 });
    const hasDemo = [...customers, ...jobs, ...requests, ...showcase].some((r) => r.is_demo);
    return { ask, followUps, stats, sent, customerById, jobById, hasDemo };
  }, [customers, jobs, requests, showcase, schema]);
}
