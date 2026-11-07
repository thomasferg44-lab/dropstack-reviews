import { useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import BrandMark from "../components/ui/BrandMark.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { DemoSheet, ShowcaseFormSheet } from "../components/Sheets.jsx";
import ConfirmSheet from "../components/ConfirmSheet.jsx";
import { Stars, NeedsPatch, confirmKey } from "../components/Bits.jsx";
import { DemoBadge } from "../components/AppShell.jsx";
import { useData } from "../state/DataStore.jsx";
import useDerived from "../state/useDerived.js";
import useHealth from "../hooks/useHealth.js";
import { healthSummary } from "../lib/health.js";
import { reviewUrlStatus } from "../lib/reviewUrl.js";
import { embedSnippet } from "../lib/showcase.js";
import { prefs } from "../lib/cache.js";
import { navigate } from "../hooks/useRoute.js";
import { companyConfig } from "../../companyConfig.js";

function Row({ label, value, ok, warn, testid }) {
  return (
    <div className="group-row items-start" data-testid={testid}>
      <span className={`mt-0.5 h-6 w-6 rounded-full inline-flex items-center justify-center flex-shrink-0 ${ok ? "bg-good-soft text-good" : warn ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"}`}>
        <Icon name={ok ? "check" : "alert"} size={14} />
      </span>
      <div className="flex-1 min-w-0"><div className="text-[13px] text-ink-3">{label}</div><div className="text-[15px] break-words">{value}</div></div>
    </div>
  );
}

export default function SetupPage() {
  const { user, schema, showcase, removeDemo, deleteShowcase } = useData();
  const { hasDemo } = useDerived();
  const toast = useToast();
  const health = useHealth();
  const [sheet, setSheet] = useState(null);
  const [confirmed, setConfirmed] = useState(() => Boolean(prefs.get(confirmKey(user.id))));
  const url = reviewUrlStatus(companyConfig.reviewUrl);
  const wa = String(companyConfig.whatsappNumber ?? "").replace(/[^\d]/g, "");
  const origin = window.location.origin;
  const snippet = embedSnippet(origin);
  const hs = healthSummary(health);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="section-label">Your details</h2>
        <div className="group-list">
          <div className="group-row"><BrandMark size={40} className="rounded-[12px]" /><div><div className="text-[16px] font-semibold">{companyConfig.businessName}</div><div className="text-[13px] text-ink-3">{companyConfig.logoUrl ? "Your logo" : "Initials shown until a logo is added"}</div></div></div>
          <Row testid="setup-reviewurl" label="Google review link" ok={url.ok} warn={url.ok && url.notGoogle}
            value={url.ok ? companyConfig.reviewUrl + (url.notGoogle ? " (not a Google address: check it)" : "") : url.state === "missing" ? "Not set. Customer links lead nowhere until it is." : "Not a working https:// address."} />
          <Row label="Your WhatsApp number" ok={wa.length >= 8} warn value={wa.length >= 8 ? `+${wa}` : "Not set. Unhappy customers can't be offered a direct line to you."} />
          <Row label="Email sender" ok={!/example\.com$/i.test(companyConfig.fromEmail ?? "")} warn value={/example\.com$/i.test(companyConfig.fromEmail ?? "") ? `${companyConfig.fromEmail} (placeholder: WhatsApp works, email won't deliver)` : companyConfig.fromEmail} />
          <Row label="Follow-up" ok value={`One gentle follow-up after ${companyConfig.followUp?.afterDays ?? 5} days without a response. Never a second.`} />
        </div>
        <p className="text-[13px] text-ink-3 px-1 mt-2">DropStack sets these up for you. To change one, message DropStack.</p>
        {confirmed ? <p className="mt-3 text-[15px] text-good flex items-center gap-2"><Icon name="check" size={18} /> Confirmed</p>
          : <button className="btn-primary w-full sm:w-auto mt-3" data-testid="setup-confirm" onClick={() => { prefs.set(confirmKey(user.id), true); setConfirmed(true); toast("Details confirmed."); navigate("/"); }}>These look right</button>}
      </section>

      <section>
        <h2 className="section-label">Demo mode</h2>
        {schema === "v1" ? <NeedsPatch what="Demo mode" /> : companyConfig.demo?.allowed === false ? <div className="card p-4 text-[15px] text-ink-3">Turned off for this business.</div> : (
          <div className="card p-4 space-y-3">
            {hasDemo ? (
              <>
                <p className="text-[15px] flex items-center gap-2"><DemoBadge /> Demo data is loaded.</p>
                <button className="btn-danger w-full sm:w-auto" onClick={() => setSheet("remove")} data-testid="demo-remove">Remove demo data</button>
              </>
            ) : (
              <>
                <p className="text-[15px] text-ink-3">See the whole loop working with a sample South African plumber, landscaper or electrician.</p>
                <button className="btn-secondary w-full sm:w-auto" onClick={() => setSheet("demo")} data-testid="setup-demo">Load demo data</button>
              </>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="section-label">Showcase on your website</h2>
        {schema === "v1" ? <NeedsPatch what="The showcase strip" /> : (
          <div className="card p-4 space-y-3" data-testid="showcase-setup">
            <p className="text-[15px] text-ink-3">A strip of your best Google reviews for your DropStack mini-site. Copy real reviews in; it shows nothing until you do.</p>
            {showcase.length > 0 && (
              <ul className="divide-y divide-hairline">
                {showcase.map((s) => (
                  <li key={s.id} className="py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-[15px] font-semibold">{s.author_name}<Stars rating={s.rating} />{s.is_demo && <span className="pill-warn">Sample, never shown publicly</span>}{!s.published && <span className="pill-neutral">Hidden</span>}</div>
                      <p className="text-[14px] text-ink-2 line-clamp-2">{s.body}</p>
                    </div>
                    <button className="btn-plain" onClick={() => setSheet({ edit: s })}>Edit</button>
                    <button className="btn-plain text-bad" aria-label={`Remove review by ${s.author_name}`} onClick={() => deleteShowcase(s.id)}><Icon name="trash" size={18} /></button>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn-secondary w-full sm:w-auto" onClick={() => setSheet({ edit: null })}><Icon name="plus" /> Feature a review</button>
            <div>
              <label htmlFor="embed" className="field-label">Embed code</label>
              <textarea id="embed" readOnly className="input font-mono text-[14px]" rows={2} value={snippet} onFocus={(e) => e.target.select()} />
              <div className="flex gap-2 mt-2">
                <button className="btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(snippet); toast("Embed code copied."); } catch { toast("Select the code and copy it."); } }}><Icon name="copy" size={18} /> Copy</button>
                <a className="btn-plain" href="/showcase" target="_blank" rel="noopener">Preview</a>
              </div>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="section-label">Status</h2>
        <div className="group-list">
          <Row label="Overall" ok={hs.tone === "good"} warn={hs.tone === "warn"} value={hs.text} />
          {health && !health.error && <Row label="Database" ok={health.database} value={health.database ? "Reachable" : "Not reachable"} />}
          <Row label="Database version" ok={schema === "v2"} warn value={schema === "v2" ? "Up to date" : "Waiting for the November update (feedback, follow-ups, demo, showcase)"} />
        </div>
      </section>

      {sheet === "demo" && <DemoSheet onClose={() => setSheet(null)} />}
      {sheet === "remove" && (
        <ConfirmSheet title="Remove demo data?" confirmLabel="Remove demo data" danger onClose={() => setSheet(null)}
          onConfirm={async () => { const r = await removeDemo(); toast(`Removed ${r.customers_removed} demo customers.`); }}>
          Every row marked DEMO goes: customers, jobs, requests, feedback and sample showcase entries. Your real customers stay exactly as they are.
        </ConfirmSheet>
      )}
      {sheet?.edit !== undefined && <ShowcaseFormSheet item={sheet.edit} onClose={() => setSheet(null)} />}
    </div>
  );
}
