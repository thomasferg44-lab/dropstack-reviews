import { useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import { Checklist, HeroStrip, ReviewUrlBanner, NeedsPatch } from "../components/Bits.jsx";
import { DemoSheet, JobFormSheet } from "../components/Sheets.jsx";
import ComposerSheet from "../components/ComposerSheet.jsx";
import { useData } from "../state/DataStore.jsx";
import useDerived from "../state/useDerived.js";
import { SUPPRESSION_LABELS } from "../features/queue/eligibility.js";
import { jobWhen } from "../lib/compose.js";
import { formatDate } from "../lib/format.js";
import { companyConfig } from "../../companyConfig.js";

/**
 * Today answers in 3 seconds: how it's going (hero strip), who to ask now,
 * and who is due their one follow-up. Every row has one primary action.
 */
export default function TodayPage() {
  const { status, schema, loaded } = useData();
  const { ask, followUps, stats } = useDerived();
  const [composer, setComposer] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [showHidden, setShowHidden] = useState(false);
  const loading = !loaded && status === "loading";
  const canDemo = companyConfig.demo?.allowed !== false && schema === "v2";

  const openAsk = (entry) => setComposer({ kind: "request", customer: entry.customer, job: entry.job });
  const nextAfter = (done) => {
    // "Next customer": straight on to the next one in the same queue.
    const list = composer.kind === "followup" ? followUps.filter((f) => f.request.id !== composer.request.id) : ask.ready.filter((e) => e.customer.id !== composer.customer.id);
    const n = list[0];
    if (!n || !done) return setComposer(null);
    setComposer(composer.kind === "followup" ? { kind: "followup", customer: n.customer, job: n.job, request: n.request } : { kind: "request", customer: n.customer, job: n.job });
  };

  return (
    <div className="space-y-6">
      <ReviewUrlBanner />
      <Checklist onLoadDemo={() => setSheet("demo")} onAddJob={() => setSheet("job")} firstAsk={ask.ready[0]} onAskFirst={() => openAsk(ask.ready[0])} />
      <HeroStrip stats={stats} loading={loading} />
      {schema === "v1" && <NeedsPatch what="Feedback, Google taps, the follow-up queue and demo mode" />}

      <section aria-labelledby="ask-h" data-testid="ask-now">
        <div className="flex items-end justify-between mb-2 px-1">
          <h2 id="ask-h" className="text-[20px] font-semibold">Ask now</h2>
          <span className="text-[13px] text-ink-3 tabular">{ask.ready.length} ready</span>
        </div>
        {loading ? <div className="group-list">{[0, 1, 2].map((i) => <div key={i} className="group-row"><div className="skeleton h-10 w-full" /></div>)}</div>
          : ask.ready.length === 0 ? (
            <EmptyState icon="star" title={ask.suppressed.length ? "Everyone's been asked" : "Nobody to ask yet"}
              action={<button className="btn-primary w-full sm:w-auto" onClick={() => setSheet("job")} data-testid="empty-add-job">Log a finished job</button>}
              secondary={!ask.suppressed.length && canDemo ? <button className="btn-plain" onClick={() => setSheet("demo")}>Or load demo data</button> : null}>
              Log a job you've finished and the customer appears here, ready to ask on WhatsApp.
            </EmptyState>
          ) : (
            <ul className="group-list">
              {ask.ready.map((e) => (
                <li key={e.customer.id} className="group-row" data-testid="ask-row">
                  <div className="flex-1 min-w-0">
                    <div className="text-[16px] font-semibold truncate flex items-center gap-2">{e.customer.name}{e.customer.is_demo && <span className="pill-warn">Demo</span>}</div>
                    <div className="text-[14px] text-ink-3 truncate">{e.job.description || "Job"} · finished {jobWhen(e.job.completed_at)}</div>
                  </div>
                  <button className="btn-primary !min-h-[44px]" onClick={() => openAsk(e)} aria-label={`Ask ${e.customer.name}`}>
                    <Icon name="chat" size={18} /> Ask
                  </button>
                </li>
              ))}
            </ul>
          )}
        {ask.suppressed.length > 0 && (
          <div className="mt-2">
            <button className="btn-plain -ml-3" onClick={() => setShowHidden((v) => !v)} aria-expanded={showHidden}>
              {showHidden ? "Hide" : "Show"} {ask.suppressed.length} not ready
            </button>
            {showHidden && (
              <ul className="group-list mt-1">
                {ask.suppressed.map((s) => (
                  <li key={s.customer.id} className="group-row text-[14px]">
                    <span className="flex-1 truncate">{s.customer.name}</span>
                    <span className="pill-neutral">{SUPPRESSION_LABELS[s.reason]}</span>
                    {s.reason === "cooldown" && <span className="text-[12px] text-ink-3 hidden sm:inline">back {formatDate(s.availableOn)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {schema === "v2" && (
        <section aria-labelledby="fu-h" data-testid="follow-up">
          <div className="flex items-end justify-between mb-1 px-1">
            <h2 id="fu-h" className="text-[20px] font-semibold">Follow up</h2>
            <span className="text-[13px] text-ink-3 tabular">{followUps.length} due</span>
          </div>
          <p className="text-[13px] text-ink-3 px-1 mb-2">No response after {companyConfig.followUp?.afterDays ?? 5} days. One gentle follow-up each, never a second.</p>
          {followUps.length === 0 ? (
            <div className="card px-4 py-5 text-[15px] text-ink-3 flex items-center gap-3"><Icon name="check" className="text-good" />Nobody's waiting on a follow-up.</div>
          ) : (
            <ul className="group-list">
              {followUps.map((f) => (
                <li key={f.request.id} className="group-row" data-testid="followup-row">
                  <div className="flex-1 min-w-0">
                    <div className="text-[16px] font-semibold truncate flex items-center gap-2">{f.customer.name}{f.customer.is_demo && <span className="pill-warn">Demo</span>}</div>
                    <div className="text-[14px] text-ink-3 truncate">Asked {f.daysSince} days ago · no response</div>
                  </div>
                  <button className="btn-secondary !min-h-[44px]" onClick={() => setComposer({ kind: "followup", customer: f.customer, job: f.job, request: f.request })}
                    aria-label={`Follow up with ${f.customer.name}`}>Follow up</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {composer && (
        <ComposerSheet key={`${composer.kind}-${composer.customer.id}`} {...composer}
          onClose={() => setComposer(null)}
          onNext={(composer.kind === "followup" ? followUps.length > 1 : ask.ready.length > 1) ? nextAfter : undefined} />
      )}
      {sheet === "demo" && <DemoSheet onClose={() => setSheet(null)} />}
      {sheet === "job" && <JobFormSheet onClose={(row, cust) => { setSheet(null); if (row?.completed_at && cust) setComposer({ kind: "request", customer: cust, job: row }); }} />}
    </div>
  );

}
