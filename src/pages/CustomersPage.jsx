import { useEffect, useMemo, useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import { CustomerFormSheet, ImportSheet, JobFormSheet } from "../components/Sheets.jsx";
import ComposerSheet from "../components/ComposerSheet.jsx";
import ConfirmSheet from "../components/ConfirmSheet.jsx";
import { StagePill, ChannelLabel, Stars } from "../components/Bits.jsx";
import { useData } from "../state/DataStore.jsx";
import { linkProps, navigate } from "../hooks/useRoute.js";
import { formatDate, formatPhone, normalisePhone } from "../lib/format.js";
import { canFollowUp, followUpSettings } from "../lib/followup.js";
import { companyConfig } from "../../companyConfig.js";

export function CustomersPage() {
  const { customers, loaded } = useData();
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState(null);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const sorted = [...customers].sort((a, b) => a.name.localeCompare(b.name));
    return s ? sorted.filter((c) => [c.name, c.phone, c.email].some((v) => String(v ?? "").toLowerCase().includes(s))) : sorted;
  }, [customers, q]);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button className="btn-primary flex-1 sm:flex-none" onClick={() => setSheet("new")} data-testid="add-customer"><Icon name="plus" /> New customer</button>
        <button className="btn-secondary flex-1 sm:flex-none" onClick={() => setSheet("import")} data-testid="import-open"><Icon name="upload" /> Import CSV</button>
      </div>
      {customers.length > 0 && (
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input type="search" className="search" placeholder="Search name, phone or email" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {loaded && customers.length === 0 && (
        <EmptyState icon="users" title="No customers yet" action={<button className="btn-primary w-full sm:w-auto" onClick={() => setSheet("import")}>Import your contact list</button>}>
          Bring in the list you already have (Excel, Google Sheets or phone contacts). Messy columns are fine.
        </EmptyState>
      )}
      {list.length > 0 && (
        <ul className="group-list">
          {list.map((c) => (
            <li key={c.id}>
              <a {...linkProps(`/customers/${c.id}`)} className="group-row hover:bg-fill/50" data-testid="customer-row">
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-semibold truncate flex items-center gap-2">{c.name}{c.is_demo && <span className="pill-warn">Demo</span>}</div>
                  <div className="text-[14px] text-ink-3 truncate">{[formatPhone(c.phone), c.email].filter(Boolean).join(" · ") || "No contact details"}</div>
                </div>
                <Icon name="chevronRight" className="text-ink-4" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {customers.length > 0 && list.length === 0 && <p className="text-center text-[15px] text-ink-3 py-6">No customer matches “{q}”.</p>}
      {sheet === "new" && <CustomerFormSheet onClose={(row) => { setSheet(null); if (row) navigate(`/customers/${row.id}`); }} />}
      {sheet === "import" && <ImportSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

/** /customers?phone=+27…: the suite's cross-tool join. Lands on the record. */
export function CustomerLookup({ phone }) {
  const { customers, loaded } = useData();
  const want = normalisePhone(phone);
  const match = customers.find((c) => c.phone && c.phone === want);
  useEffect(() => { if (match) navigate(`/customers/${match.id}`, { replace: true }); }, [match]);
  if (!loaded || match) return <div className="card p-6"><div className="skeleton h-8 w-1/2" /></div>;
  return (
    <EmptyState icon="search" title="No customer with that number" action={<a className="btn-primary w-full sm:w-auto" {...linkProps("/customers")}>See all customers</a>}>
      Nobody here has {formatPhone(want) || phone}. Add them as a customer to ask for a review.
    </EmptyState>
  );
}

export function CustomerDetailPage({ id }) {
  const { customers, jobs, requests, deleteCustomer, loaded } = useData();
  const c = customers.find((x) => x.id === id);
  const [sheet, setSheet] = useState(null);
  const [composer, setComposer] = useState(null);
  if (!c) return loaded ? <EmptyState icon="users" title="Customer not found" action={<a className="btn-primary" {...linkProps("/customers")}>Back to customers</a>}>They may have been deleted.</EmptyState> : <div className="card p-6"><div className="skeleton h-8 w-1/2" /></div>;
  const theirJobs = jobs.filter((j) => j.customer_id === c.id);
  const theirReqs = requests.filter((r) => r.customer_id === c.id && r.sent_at).sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at));
  const lastDone = theirJobs.filter((j) => j.completed_at).sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at))[0];
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const settings = followUpSettings(companyConfig);

  return (
    <div className="space-y-5">
      <section className="card p-5 space-y-3" data-testid="customer-detail">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold flex items-center gap-2">{c.name}{c.is_demo && <span className="pill-warn">Demo</span>}</h2>
            <div className="text-[15px] text-ink-3">{[formatPhone(c.phone), c.email].filter(Boolean).join(" · ") || "No contact details"}</div>
          </div>
          <button className="btn-plain" onClick={() => setSheet("edit")}>Edit</button>
        </div>
        {lastDone ? (
          <button className="btn-primary w-full" onClick={() => setComposer({ kind: "request", customer: c, job: lastDone })} data-testid="detail-ask">
            <Icon name="chat" /> Ask for a review
          </button>
        ) : (
          <button className="btn-primary w-full" onClick={() => setSheet("job")}><Icon name="plus" /> Log a finished job</button>
        )}
      </section>

      <section>
        <h2 className="section-label">Requests</h2>
        {theirReqs.length === 0 ? <div className="card p-4 text-[15px] text-ink-3">Not asked yet.</div> : (
          <ul className="group-list">
            {theirReqs.map((r) => {
              const fu = canFollowUp(r, settings);
              return (
                <li key={r.id} className="group-row items-start">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2"><StagePill request={r} />{r.followed_up_at && <span className="pill-neutral">Followed up {formatDate(r.followed_up_at)}</span>}</div>
                    <div className="text-[14px] text-ink-3">Sent {formatDate(r.sent_at)} on <ChannelLabel channel={r.channel} />{jobById.get(r.job_id) ? ` · ${jobById.get(r.job_id).description}` : ""}</div>
                    {r.feedback_rating && <div className="text-[14px] flex items-center gap-2"><Stars rating={r.feedback_rating} />{r.feedback_comment && <span className="text-ink-2 truncate">“{r.feedback_comment}”</span>}</div>}
                  </div>
                  {fu.ok && <button className="btn-secondary !min-h-[44px]" onClick={() => setComposer({ kind: "followup", customer: c, job: jobById.get(r.job_id), request: r })}>Follow up</button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="section-label">Jobs</h2>
        {theirJobs.length === 0 ? <div className="card p-4 text-[15px] text-ink-3">No jobs logged.</div> : (
          <ul className="group-list">{theirJobs.map((j) => (
            <li key={j.id} className="group-row"><span className="flex-1 truncate">{j.description || "Job"}</span><span className="text-[14px] text-ink-3">{j.completed_at ? formatDate(j.completed_at) : "Booked"}</span></li>
          ))}</ul>
        )}
      </section>

      <button className="btn-plain text-bad -ml-3" onClick={() => setSheet("delete")}>Delete customer</button>

      {sheet === "edit" && <CustomerFormSheet customer={c} onClose={() => setSheet(null)} />}
      {sheet === "job" && <JobFormSheet presetCustomerId={c.id} onClose={(row, cust) => { setSheet(null); if (row?.completed_at) setComposer({ kind: "request", customer: cust ?? c, job: row }); }} />}
      {sheet === "delete" && (
        <ConfirmSheet title={`Delete ${c.name}?`} confirmLabel="Delete customer" danger onConfirm={async () => { await deleteCustomer(c.id); navigate("/customers"); }} onClose={() => setSheet(null)}>
          Their jobs, requests and any feedback they gave are deleted too. This can't be undone.
        </ConfirmSheet>
      )}
      {composer && <ComposerSheet key={composer.kind} {...composer} onClose={() => setComposer(null)} />}
    </div>
  );
}

export default CustomersPage;
