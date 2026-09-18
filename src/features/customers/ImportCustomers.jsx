import { useMemo, useState } from "react";
import { parseCsv } from "../../lib/csv.js";
import { guessMapping, buildImportPlan } from "./importMapping.js";
import { Button, ErrorNotice, Badge } from "../../components/ui.jsx";

const FIELDS = [
  { id: "name", label: "Name" },
  { id: "first", label: "First name" },
  { id: "last", label: "Surname" },
  { id: "phone", label: "Phone" },
  { id: "email", label: "Email" },
];

// Three steps in one panel: pick file → confirm column mapping + preview → result.
export default function ImportCustomers({ onImport, onDone }) {
  const [parsed, setParsed] = useState(null);      // { headers, rows, fileName }
  const [mapping, setMapping] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const { headers, rows } = parseCsv(text);
      if (headers.length === 0) return setError("That file looks empty.");
      setParsed({ headers, rows, fileName: file.name });
      setMapping(guessMapping(headers));
    } catch (err) {
      setError(`Couldn’t read the file: ${err.message}`);
    }
  }

  const plan = useMemo(() => (parsed && mapping ? buildImportPlan(parsed.rows, mapping) : []), [parsed, mapping]);
  const ok = plan.filter((p) => p.status === "ok");
  const skipped = plan.filter((p) => p.status === "skip");
  const hasNameSource = mapping && (mapping.name >= 0 || mapping.first >= 0 || mapping.last >= 0);

  async function runImport() {
    setBusy(true);
    setError("");
    const res = await onImport(ok.map((p) => p.customer));
    setBusy(false);
    if (res.error) setError(res.error);
    setResult(res);
  }

  if (result) {
    return (
      <div className="space-y-4 text-sm">
        <p className="text-text">
          Imported <strong>{result.inserted}</strong> customer{result.inserted === 1 ? "" : "s"} from {parsed.fileName}.
        </p>
        {result.existing.length > 0 && (
          <div>
            <p className="text-text-mute">{result.existing.length} already existed (same phone) and were left unchanged:</p>
            <ul className="mt-1 max-h-40 overflow-y-auto text-text-dim">
              {result.existing.map((c, i) => <li key={i}>{c.name} · {c.phone}</li>)}
            </ul>
          </div>
        )}
        {skipped.length > 0 && (
          <div>
            <p className="text-text-mute">{skipped.length} row{skipped.length === 1 ? "" : "s"} skipped before import:</p>
            <ul className="mt-1 max-h-40 overflow-y-auto text-text-dim">
              {skipped.map((p) => <li key={p.line}>Line {p.line}: {p.reason}</li>)}
            </ul>
          </div>
        )}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="flex justify-end"><Button variant="primary" onClick={onDone}>Done</Button></div>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {!parsed && (
        <div className="space-y-3">
          <p className="text-text-mute">
            Upload a CSV exported from Excel, Google Sheets or your phone. Column names don’t need to match —
            you’ll confirm which column is which on the next step.
          </p>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={onFile}
            className="block w-full text-text-mute file:mr-3 file:rounded-lg file:border file:border-border file:bg-bg file:px-3 file:py-2 file:text-text"
          />
        </div>
      )}

      {parsed && (
        <>
          <p className="text-text-mute">
            <span className="text-text">{parsed.fileName}</span> · {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"} found
          </p>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2">
                <span className="text-text-mute">{f.label}</span>
                <select
                  value={mapping[f.id]}
                  onChange={(e) => setMapping({ ...mapping, [f.id]: Number(e.target.value) })}
                  className="rounded bg-surface px-2 py-1 text-text"
                >
                  <option value={-1}>— not in file —</option>
                  {parsed.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>

          {!hasNameSource && (
            <ErrorNotice>No name column selected. Rows will be named after their phone or email.</ErrorNotice>
          )}

          <div className="flex flex-wrap gap-2">
            <Badge tone="accent">{ok.length} ready</Badge>
            {skipped.length > 0 && <Badge>{skipped.length} skipped</Badge>}
            {ok.filter((p) => p.notes.length).length > 0 && <Badge>{ok.filter((p) => p.notes.length).length} with warnings</Badge>}
          </div>

          <div className="max-h-64 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface text-text-mute">
                <tr>
                  <th className="px-2 py-2">Line</th><th className="px-2 py-2">Name</th><th className="px-2 py-2">Phone</th>
                  <th className="px-2 py-2">Email</th><th className="px-2 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {plan.map((p) => (
                  <tr key={p.line} className={p.status === "skip" ? "text-text-dim" : "text-text"}>
                    <td className="px-2 py-1.5">{p.line}</td>
                    <td className="px-2 py-1.5">{p.customer?.name ?? ""}</td>
                    <td className="px-2 py-1.5">{p.customer?.phone ?? ""}</td>
                    <td className="px-2 py-1.5">{p.customer?.email ?? ""}</td>
                    <td className="px-2 py-1.5 text-text-mute">{p.status === "skip" ? `Skipped: ${p.reason}` : p.notes.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <ErrorNotice>{error}</ErrorNotice>}

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => { setParsed(null); setMapping(null); }} disabled={busy}>Choose another file</Button>
            <Button variant="primary" onClick={runImport} disabled={busy || ok.length === 0}>
              {busy ? "Importing…" : `Import ${ok.length}`}
            </Button>
          </div>
        </>
      )}
      {!parsed && error && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  );
}
