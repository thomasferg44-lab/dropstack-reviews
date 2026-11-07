import { useMemo, useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";
import { TextField, Field } from "./ui/Field.jsx";
import { useToast } from "./ui/Toast.jsx";
import { useData } from "../state/DataStore.jsx";
import { DEMO_INDUSTRIES, buildDemoPayload } from "../lib/demoData.js";
import { isPlausiblePhone } from "../lib/format.js";
import { parseCsv } from "../lib/csv.js";
import { guessMapping, buildImportPlan } from "../features/customers/importMapping.js";
import { companyConfig } from "../../companyConfig.js";

const todayIso = () => {
  const d = new Date(Date.now() + 2 * 3600000); // SA calendar day
  return d.toISOString().slice(0, 10);
};

/** Pick a trade, one tap loads a believable week. Every row is marked DEMO. */
export function DemoSheet({ onClose }) {
  const { loadDemo, customers } = useData();
  const toast = useToast();
  const allowed = (companyConfig.demo?.industries ?? Object.keys(DEMO_INDUSTRIES)).filter((k) => DEMO_INDUSTRIES[k]);
  const [industry, setIndustry] = useState(allowed[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const realCount = customers.filter((c) => !c.is_demo).length;

  async function go() {
    setBusy(true); setError(null);
    try {
      await loadDemo(buildDemoPayload(industry, new Date()));
      toast(`Demo loaded: a ${DEMO_INDUSTRIES[industry].label.toLowerCase()}'s last few weeks.`);
      onClose(true);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Sheet onClose={() => onClose(false)} title="Load demo data"
      footer={<button type="button" className="btn-primary w-full text-[17px]" disabled={busy} onClick={go} data-testid="demo-load">{busy ? "Loading…" : `Load ${DEMO_INDUSTRIES[industry].label.toLowerCase()} demo`}</button>}>
      <div className="space-y-4">
        <p className="text-[15px] text-ink-3">Twelve customers of a South African {DEMO_INDUSTRIES[industry].label.toLowerCase()}: three ready to ask, two due their one follow-up, and the rest at every stage, including one unhappy answer to practise on. Every row is marked DEMO and comes out with one tap in Setup.</p>
        <div role="radiogroup" aria-label="Trade" className="grid grid-cols-3 gap-2">
          {allowed.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={industry === k} onClick={() => setIndustry(k)}
              className={`rounded-[12px] min-h-[52px] text-[15px] font-medium border transition-colors ${industry === k ? "border-[#0071e3] bg-info-soft text-info" : "border-hairline bg-white text-ink"}`}>
              {DEMO_INDUSTRIES[k].label}
            </button>
          ))}
        </div>
        <ul className="text-[14px] text-ink-2 space-y-1.5">
          <li className="flex gap-2"><Icon name="check" size={16} className="text-good mt-0.5 flex-shrink-0" />Names are invented; numbers are +27 000 000 xxx placeholders and emails use example.com. Nothing can reach a real person.</li>
          <li className="flex gap-2"><Icon name="check" size={16} className="text-good mt-0.5 flex-shrink-0" />No made-up reviews. The furthest any demo customer goes is tapping through to Google, which is all the real tool can see too.</li>
        </ul>
        {realCount > 0 && <p className="rounded-[12px] bg-warn-soft text-warn px-3 py-2 text-[14px]">Your {realCount} real customer{realCount === 1 ? "" : "s"} stay as they are. Demo rows sit alongside until you remove them.</p>}
        {error && <p className="field-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
      </div>
    </Sheet>
  );
}

export function CustomerFormSheet({ customer = null, onClose }) {
  const { saveCustomer } = useData();
  const [form, setForm] = useState({ name: customer?.name ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = "Enter the customer's name.";
    if (form.phone && !isPlausiblePhone(form.phone)) e.phone = "Enter a mobile number like 082 123 4567 or +27 82 123 4567.";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = "Enter an email like name@example.com.";
    if (!form.phone && !form.email) e.phone = "Add a mobile number (for WhatsApp) or an email, so they can be asked.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  async function submit(ev) {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try { const row = await saveCustomer({ ...form, id: customer?.id }); onClose(row); }
    catch (e) { setErrors(/phone/i.test(e.message) ? { phone: e.message } : { form: e.message }); setBusy(false); }
  }
  return (
    <Sheet onClose={() => onClose(null)} title={customer ? "Edit customer" : "New customer"}
      footer={<button form="customer-form" type="submit" className="btn-primary w-full text-[17px]" disabled={busy}>{busy ? "Saving…" : "Save customer"}</button>}>
      <form id="customer-form" onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Name" value={form.name} onChange={set("name")} error={errors.name} autoComplete="off" data-autofocus />
        <TextField label="Mobile (WhatsApp)" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} error={errors.phone}
          help="South African numbers are saved as +27, so WhatsApp opens the right chat." optional />
        <TextField label="Email" type="email" inputMode="email" value={form.email} onChange={set("email")} error={errors.email} optional />
        {errors.form && <p className="field-error" role="alert"><Icon name="alert" size={15} />{errors.form}</p>}
      </form>
    </Sheet>
  );
}

/**
 * Log a job. "Finished" is on by default: saving a finished job offers the
 * review request straight away (job-done trigger). The send stays the owner's tap.
 */
export function JobFormSheet({ job = null, presetCustomerId = null, onClose, onDelete }) {
  const { customers, saveJob, saveCustomer } = useData();
  const sorted = useMemo(() => [...customers].sort((a, b) => a.name.localeCompare(b.name)), [customers]);
  const [customerId, setCustomerId] = useState(job?.customer_id ?? presetCustomerId ?? "");
  const [newCust, setNewCust] = useState({ name: "", phone: "" });
  const [description, setDescription] = useState(job?.description ?? "");
  const [finished, setFinished] = useState(job ? Boolean(job.completed_at) : true);
  const [date, setDate] = useState(job?.completed_at ? job.completed_at.slice(0, 10) : todayIso());
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const adding = customerId === "__new";

  async function submit(ev) {
    ev.preventDefault();
    const e = {};
    if (!customerId) e.customer = "Choose who the job was for.";
    if (adding && !newCust.name.trim()) e.newName = "Enter the customer's name.";
    if (adding && newCust.phone && !isPlausiblePhone(newCust.phone)) e.newPhone = "Enter a mobile number like 082 123 4567.";
    if (!description.trim()) e.description = "Say what the job was, e.g. \"geyser replacement\". It goes in the message.";
    if (finished && !date) e.date = "Pick the day it was finished.";
    if (finished && date > todayIso()) e.date = "That's in the future. Untick Finished, or pick today.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      let cust = customers.find((c) => c.id === customerId) ?? null;
      if (adding) cust = await saveCustomer({ name: newCust.name, phone: newCust.phone });
      const row = await saveJob({ id: job?.id, customerId: cust.id, description, completedAt: finished ? date : null });
      onClose(row, cust);
    } catch (err) { setErrors({ form: err.message }); setBusy(false); }
  }

  return (
    <Sheet onClose={() => onClose(null)} title={job ? "Edit job" : "Log a job"}
      footer={<button form="job-form" type="submit" className="btn-primary w-full text-[17px]" disabled={busy} data-testid="job-save">{busy ? "Saving…" : finished && !job ? "Save and ask for a review" : "Save job"}</button>}>
      <form id="job-form" onSubmit={submit} noValidate className="space-y-4">
        <Field label="Customer" error={errors.customer}>
          {(a) => (
            <select {...a} className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)} data-testid="job-customer">
              <option value="">Choose a customer</option>
              {sorted.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_demo ? " (demo)" : ""}</option>)}
              <option value="__new">+ New customer</option>
            </select>
          )}
        </Field>
        {adding && (
          <div className="grid gap-4 rounded-[14px] bg-fill p-3">
            <TextField label="New customer's name" value={newCust.name} onChange={(e) => setNewCust((n) => ({ ...n, name: e.target.value }))} error={errors.newName} />
            <TextField label="Mobile (WhatsApp)" type="tel" inputMode="tel" value={newCust.phone} onChange={(e) => setNewCust((n) => ({ ...n, phone: e.target.value }))} error={errors.newPhone} optional />
          </div>
        )}
        <TextField label="What was the job?" value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description}
          help="Shows in the message: “thanks for choosing us for the geyser replacement”." data-testid="job-description" />
        <label className="flex items-center justify-between gap-4 min-h-[52px] cursor-pointer">
          <span><span className="block text-[15px] font-medium">Finished</span><span className="block text-[13px] text-ink-3">Untick for a job that's booked but not done yet.</span></span>
          <input type="checkbox" className="h-6 w-6 accent-[#0071e3]" checked={finished} onChange={(e) => setFinished(e.target.checked)} />
        </label>
        {finished && <TextField label="Finished on" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} error={errors.date} />}
        {errors.form && <p className="field-error" role="alert"><Icon name="alert" size={15} />{errors.form}</p>}
        {job && onDelete && <button type="button" className="btn-plain text-bad -ml-3" onClick={onDelete}>Delete job</button>}
      </form>
    </Sheet>
  );
}

const FIELDS = [
  { id: "name", label: "Name" }, { id: "first", label: "First name" }, { id: "last", label: "Surname" },
  { id: "phone", label: "Phone" }, { id: "email", label: "Email" },
];

/** CSV import: pick file -> confirm columns + preview -> result. Nothing dropped silently. */
export function ImportSheet({ onClose }) {
  const { importCustomers } = useData();
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const { headers, rows } = parseCsv(await file.text());
      if (headers.length === 0) return setError("That file looks empty.");
      setParsed({ headers, rows, fileName: file.name });
      setMapping(guessMapping(headers));
    } catch (err) { setError(`Couldn't read the file: ${err.message}`); }
  }
  const plan = useMemo(() => (parsed && mapping ? buildImportPlan(parsed.rows, mapping) : []), [parsed, mapping]);
  const ok = plan.filter((p) => p.status === "ok");
  const skipped = plan.filter((p) => p.status === "skip");
  const noted = ok.filter((p) => p.notes.length);
  const hasName = mapping && (mapping.name >= 0 || mapping.first >= 0 || mapping.last >= 0);

  async function run() {
    setBusy(true); setError(null);
    try { setResult(await importCustomers(ok.map((p) => p.customer))); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }

  const footer = result
    ? <button className="btn-primary w-full text-[17px]" onClick={() => onClose(true)}>Done</button>
    : parsed ? <button className="btn-primary w-full text-[17px]" disabled={busy || !ok.length || !hasName} onClick={run} data-testid="import-run">{busy ? "Importing…" : `Import ${ok.length} customer${ok.length === 1 ? "" : "s"}`}</button>
    : null;

  return (
    <Sheet onClose={() => onClose(Boolean(result))} title="Import customers" footer={footer} wide>
      <div className="space-y-4 text-[15px]">
        {!parsed && (
          <>
            <p className="text-ink-3">A CSV from Excel, Google Sheets or your phone's contacts. Column names don't need to match; you'll confirm them next.</p>
            <label className="btn-secondary w-full cursor-pointer"><Icon name="upload" /> Choose a CSV file
              <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={onFile} data-testid="import-file" />
            </label>
          </>
        )}
        {parsed && !result && (
          <>
            <p className="text-ink-3">{parsed.fileName}: {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}. Check which column is which.</p>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map((f) => (
                <Field key={f.id} label={f.label}>
                  {(a) => (
                    <select {...a} className="input" value={mapping[f.id]} onChange={(e) => setMapping((m) => ({ ...m, [f.id]: Number(e.target.value) }))}>
                      <option value={-1}>(none)</option>
                      {parsed.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  )}
                </Field>
              ))}
            </div>
            {!hasName && <p className="field-error"><Icon name="alert" size={15} />Pick the column with names.</p>}
            <div className="rounded-[14px] bg-fill p-3 text-[14px] space-y-1" data-testid="import-summary">
              <div><strong className="tabular">{ok.length}</strong> ready to import{noted.length ? `, ${noted.length} with a note` : ""}</div>
              {skipped.length > 0 && <div><strong className="tabular">{skipped.length}</strong> skipped, each with a reason below</div>}
            </div>
            {(skipped.length > 0 || noted.length > 0) && (
              <ul className="max-h-48 overflow-y-auto text-[13px] text-ink-3 space-y-1">
                {skipped.map((p) => <li key={`s${p.line}`}>Line {p.line}: skipped, {p.reason.toLowerCase()}</li>)}
                {noted.map((p) => <li key={`n${p.line}`}>Line {p.line} ({p.customer.name}): {p.notes.join("; ")}</li>)}
              </ul>
            )}
          </>
        )}
        {result && (
          <div className="space-y-2" data-testid="import-result">
            <p><strong className="tabular">{result.inserted}</strong> customer{result.inserted === 1 ? "" : "s"} imported.</p>
            {result.existing.length > 0 && <p className="text-ink-3">{result.existing.length} already existed with the same phone and were left unchanged: {result.existing.map((c) => c.name).join(", ")}.</p>}
            {skipped.length > 0 && <p className="text-ink-3">{skipped.length} row{skipped.length === 1 ? " was" : "s were"} skipped before import (reasons listed on the previous step).</p>}
          </div>
        )}
        {error && <p className="field-error" role="alert"><Icon name="alert" size={15} />{error}</p>}
      </div>
    </Sheet>
  );
}

/** A featured review for the showcase strip: copied from Google, never made up. */
export function ShowcaseFormSheet({ item = null, onClose }) {
  const { saveShowcase } = useData();
  const [form, setForm] = useState({ author_name: item?.author_name ?? "", rating: item?.rating ?? 5, body: item?.body ?? "", reviewed_on: item?.reviewed_on ?? "", published: item?.published ?? true });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  async function submit(ev) {
    ev.preventDefault();
    const e = {};
    if (!form.author_name.trim()) e.author_name = "Enter how the reviewer's name shows on Google, e.g. \"Thandi M.\"";
    if (!form.body.trim()) e.body = "Paste the review text from Google.";
    if (form.body.length > 600) e.body = "Keep it under 600 characters; trim with … if needed.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await saveShowcase({ ...form, id: item?.id }); onClose(true); } catch (err) { setErrors({ form: err.message }); setBusy(false); }
  }
  return (
    <Sheet onClose={() => onClose(false)} title={item ? "Edit featured review" : "Feature a review"}
      footer={<button form="sc-form" type="submit" className="btn-primary w-full text-[17px]" disabled={busy}>{busy ? "Saving…" : "Save review"}</button>}>
      <form id="sc-form" onSubmit={submit} noValidate className="space-y-4">
        <p className="text-[14px] text-ink-3">Copy a real review from your Google profile. Only publish reviews customers actually wrote.</p>
        <TextField label="Reviewer" value={form.author_name} onChange={(e) => setForm({ ...form, author_name: e.target.value })} error={errors.author_name} />
        <Field label="Stars">
          {(a) => (
            <div {...a} role="radiogroup" className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={form.rating === n} aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  onClick={() => setForm({ ...form, rating: n })}
                  className={`h-11 w-11 rounded-[10px] inline-flex items-center justify-center ${n <= form.rating ? "text-[#ff9500]" : "text-ink-4"}`}>
                  <Icon name="star" size={24} />
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Review text" error={errors.body}>
          {(a) => <textarea {...a} className="input min-h-[120px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />}
        </Field>
        <TextField label="Date on Google" type="date" value={form.reviewed_on ?? ""} onChange={(e) => setForm({ ...form, reviewed_on: e.target.value })} optional />
        <label className="flex items-center justify-between min-h-[52px]"><span className="text-[15px] font-medium">Show in the strip</span>
          <input type="checkbox" className="h-6 w-6 accent-[#0071e3]" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} /></label>
        {errors.form && <p className="field-error" role="alert"><Icon name="alert" size={15} />{errors.form}</p>}
      </form>
    </Sheet>
  );
}
