import { useMemo, useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import { JobFormSheet } from "../components/Sheets.jsx";
import ComposerSheet from "../components/ComposerSheet.jsx";
import ConfirmSheet from "../components/ConfirmSheet.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { useData } from "../state/DataStore.jsx";
import useDerived from "../state/useDerived.js";
import { formatDate } from "../lib/format.js";

/**
 * Jobs. Marking a job done (or logging a finished one) opens the review
 * request in the same motion, pre-addressed, WhatsApp selected. The offer is
 * automatic; the send is the owner's tap.
 */
export default function JobsPage() {
  const { jobs, requests, completeJob, deleteJob, loaded } = useData();
  const { customerById } = useDerived();
  const toast = useToast();
  const [sheet, setSheet] = useState(null);
  const [composer, setComposer] = useState(null);
  const askedJobs = useMemo(() => new Set(requests.filter((r) => r.sent_at && r.job_id).map((r) => r.job_id)), [requests]);
  const booked = jobs.filter((j) => !j.completed_at);
  const done = jobs.filter((j) => j.completed_at).sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at));

  async function markDone(job) {
    try {
      const row = await completeJob(job.id, new Date().toISOString());
      const customer = customerById.get(job.customer_id);
      if (customer) setComposer({ customer, job: row });
    } catch (e) { toast(e.message); }
  }

  const Row = ({ j, children }) => {
    const c = customerById.get(j.customer_id);
    return (
      <li className="group-row" data-testid="job-row">
        <button className="flex-1 min-w-0 text-left min-h-[44px]" onClick={() => setSheet({ type: "edit", job: j })} aria-label={`Edit job for ${c?.name ?? "customer"}`}>
          <div className="text-[16px] font-semibold truncate flex items-center gap-2">{c?.name ?? "Deleted customer"}{j.is_demo && <span className="pill-warn">Demo</span>}</div>
          <div className="text-[14px] text-ink-3 truncate">{j.description || "No description"}{j.completed_at ? ` · ${formatDate(j.completed_at)}` : ""}</div>
        </button>
        {children}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <button className="btn-primary w-full sm:w-auto" onClick={() => setSheet({ type: "new" })} data-testid="add-job"><Icon name="plus" /> Log a job</button>
      {loaded && jobs.length === 0 && (
        <EmptyState icon="briefcase" title="No jobs yet"
          action={<button className="btn-primary w-full sm:w-auto" onClick={() => setSheet({ type: "new" })}>Log your first job</button>}>
          Each finished job is a chance to ask for a review. Log one and you'll be offered the WhatsApp message straight away.
        </EmptyState>
      )}
      {booked.length > 0 && (
        <section>
          <h2 className="section-label">Booked, not done yet</h2>
          <ul className="group-list">{booked.map((j) => (
            <Row key={j.id} j={j}><button className="btn-primary !min-h-[44px]" onClick={() => markDone(j)} data-testid="mark-done"><Icon name="check" size={18} /> Done</button></Row>
          ))}</ul>
        </section>
      )}
      {done.length > 0 && (
        <section>
          <h2 className="section-label">Finished</h2>
          <ul className="group-list">{done.map((j) => (
            <Row key={j.id} j={j}>{askedJobs.has(j.id) ? <span className="pill-good">Asked</span> : <span className="pill-neutral">Not asked</span>}</Row>
          ))}</ul>
        </section>
      )}
      {sheet?.type === "new" && <JobFormSheet onClose={(row, cust) => { setSheet(null); if (row?.completed_at && cust) setComposer({ customer: cust, job: row }); }} />}
      {sheet?.type === "edit" && <JobFormSheet job={sheet.job} onClose={() => setSheet(null)} onDelete={() => setSheet({ type: "delete", job: sheet.job })} />}
      {sheet?.type === "delete" && (
        <ConfirmSheet title="Delete this job?" confirmLabel="Delete job" danger onConfirm={() => deleteJob(sheet.job.id)} onClose={() => setSheet(null)}>
          The job is removed. Any review request already sent stays in Activity.
        </ConfirmSheet>
      )}
      {composer && <ComposerSheet kind="request" {...composer} onClose={() => setComposer(null)} />}
    </div>
  );
}
