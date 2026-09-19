import { useMemo, useState } from "react";
import { useJobs } from "./useJobs.js";
import { useCustomers } from "../customers/useCustomers.js";
import JobForm from "./JobForm.jsx";
import { formatDate } from "../../lib/format.js";
import { Card, EmptyState, ErrorNotice, Spinner, Button, Input, Modal, Badge } from "../../components/ui.jsx";

export default function JobsList() {
  const { jobs, loading, error, refresh, addJob, updateJob, deleteJob } = useJobs();
  const { customers, loading: customersLoading } = useCustomers();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | job row

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      [j.description, j.customer?.name].some((v) => v && String(v).toLowerCase().includes(q))
    );
  }, [jobs, query]);

  async function handleSubmit(input) {
    const result = editing === "new" ? await addJob(input) : await updateJob(editing.id, input);
    if (!result.error) setEditing(null);
    return result;
  }

  async function handleDelete(job) {
    if (!window.confirm(`Delete the job "${job.description || "no description"}" for ${job.customer?.name}?`)) return;
    const { error } = await deleteJob(job.id);
    if (error) window.alert(error);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Jobs</h1>
          <p className="text-sm text-text-mute">
            {loading ? "Loading…" : `${jobs.length} job${jobs.length === 1 ? "" : "s"} logged`}
          </p>
        </div>
        <div className="flex gap-2 sm:w-96">
          <Input
            type="search"
            placeholder="Search job or customer"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search jobs"
          />
          <Button variant="ghost" onClick={refresh} disabled={loading} aria-label="Refresh">
            {loading ? <Spinner /> : "Refresh"}
          </Button>
          <Button variant="primary" onClick={() => setEditing("new")} disabled={customersLoading}>Log job</Button>
        </div>
      </div>

      {editing && (
        <Modal title={editing === "new" ? "Log a completed job" : "Edit job"} onClose={() => setEditing(null)}>
          <JobForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            customers={customers}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {error && <ErrorNotice>Couldn’t load jobs: {error}</ErrorNotice>}

      {!loading && !error && jobs.length === 0 && (
        <EmptyState
          title="No jobs logged yet"
          body="Log a completed job against a customer and they’ll show up in the “Ask now” queue."
        />
      )}

      {!loading && !error && jobs.length > 0 && visible.length === 0 && (
        <EmptyState title="No matches" body="Try a different search." />
      )}

      {visible.length > 0 && (
        <>
          {/* Mobile: cards */}
          <ul className="space-y-2 sm:hidden">
            {visible.map((j) => (
              <li key={j.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-text">{j.customer?.name ?? "Deleted customer"}</p>
                      <p className="mt-1 text-sm text-text-mute">{j.description || "No description"}</p>
                    </div>
                    <Button variant="ghost" onClick={() => setEditing(j)}>Edit</Button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {j.completed_at
                      ? <span className="text-xs text-text-dim">Completed {formatDate(j.completed_at)}</span>
                      : <Badge>Not marked complete</Badge>}
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <Card className="hidden overflow-hidden sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-text-mute">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Job</th>
                  <th className="px-4 py-3 font-medium">Completed</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((j) => (
                  <tr key={j.id} className="hover:bg-bg/40">
                    <td className="px-4 py-3 font-medium text-text">{j.customer?.name ?? "Deleted customer"}</td>
                    <td className="px-4 py-3 text-text-mute">{j.description || <span className="text-text-dim">—</span>}</td>
                    <td className="px-4 py-3 text-text-mute">
                      {j.completed_at ? formatDate(j.completed_at) : <Badge>Not marked complete</Badge>}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <Button variant="ghost" onClick={() => setEditing(j)}>Edit</Button>
                      <Button variant="ghost" onClick={() => handleDelete(j)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </section>
  );
}
