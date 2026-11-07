import { useState } from "react";
import Icon from "./ui/Icon.jsx";
import useCountUp from "../hooks/useCountUp.js";
import { STEPS, checklistState } from "../lib/onboarding.js";
import { prefs } from "../lib/cache.js";
import { linkProps } from "../hooks/useRoute.js";
import { useData } from "../state/DataStore.jsx";
import { reviewUrlStatus, REVIEW_URL_WARNINGS } from "../lib/reviewUrl.js";
import { formatPercent, STAGE_LABELS, requestStage } from "../lib/responses.js";
import { companyConfig } from "../../companyConfig.js";

export const confirmKey = (uid) => `configConfirmed:${uid}`;
const dismissKey = (uid) => `checklistDismissed:${uid}`;

/**
 * First-run checklist: details -> demo or first job -> first request sent.
 * Shown until complete, dismissible after. Each step has exactly one action.
 */
export function Checklist({ onLoadDemo, onAddJob, firstAsk, onAskFirst }) {
  const { user, customers, jobs, requests, schema } = useData();
  const [dismissed, setDismissed] = useState(() => Boolean(prefs.get(dismissKey(user.id))));
  const s = checklistState({ configConfirmed: prefs.get(confirmKey(user.id)), customers, jobs, requests, dismissed });
  if (!s.show) return null;
  const canDemo = companyConfig.demo?.allowed !== false && schema === "v2";

  const action = (key) => {
    if (s.done[key] || s.next !== key) return null;
    if (key === "config") return <a className="btn-primary !py-2.5" {...linkProps("/setup")} data-testid="checklist-config">Check details</a>;
    if (key === "data") return canDemo
      ? <button className="btn-primary !py-2.5" onClick={onLoadDemo} data-testid="checklist-demo">Load demo</button>
      : <button className="btn-primary !py-2.5" onClick={onAddJob} data-testid="checklist-job">Add job</button>;
    if (key === "action") return firstAsk
      ? <button className="btn-primary !py-2.5" onClick={onAskFirst} data-testid="checklist-ask">Ask {firstAsk.customer.name.split(" ")[0]}</button>
      : <button className="btn-primary !py-2.5" onClick={onAddJob}>Add job</button>;
    return null;
  };

  return (
    <section className="card p-5 animate-rise" aria-labelledby="checklist-h" data-testid="checklist">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="checklist-h" className="text-[17px] font-semibold">{s.complete ? "You're set up" : "Get going in a minute"}</h2>
        <span className="text-[13px] text-ink-3 tabular">{s.count} of {STEPS.length}</span>
      </div>
      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const done = s.done[step.key];
          return (
            <li key={step.key} className="flex items-center gap-3">
              <span className={`h-7 w-7 rounded-full flex-shrink-0 inline-flex items-center justify-center text-[13px] font-semibold ${done ? "bg-good-soft text-good" : s.next === step.key ? "bg-info-soft text-info" : "bg-fill text-ink-3"}`}>
                {done ? <Icon name="check" size={16} /> : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`text-[15px] ${done ? "text-ink-3 line-through decoration-ink-4" : "font-medium"}`}>{step.label}</div>
                {s.next === step.key && <div className="text-[13px] text-ink-3">{step.help}</div>}
              </div>
              {action(step.key)}
            </li>
          );
        })}
      </ol>
      {s.canDismiss && (
        <button className="btn-plain mt-3 -ml-3" onClick={() => { prefs.set(dismissKey(user.id), true); setDismissed(true); }}>Hide this</button>
      )}
    </section>
  );
}

function Stat({ label, value, display, sub, testid }) {
  const n = useCountUp(typeof value === "number" ? Math.round(value * 10) : 0);
  const shown = display ?? (typeof value === "number" ? String(Math.round(n / 10)) : "–");
  return (
    <div className="min-w-0" data-testid={testid}>
      <div className="stat-figure">{shown}</div>
      <div className="mt-1.5 text-[13px] text-ink-3 leading-snug">{label}</div>
      {sub && <div className="text-[12px] text-ink-4 leading-snug">{sub}</div>}
    </div>
  );
}

/**
 * The 3-second answer: how many asked, how many responded, how it went.
 * Real rows only. "Responded" = opened the link, answered, or tapped through
 * to Google. The score is the PRIVATE feedback average, labelled as such:
 * Google reports nothing about reviews, so there is no review count here.
 */
export function HeroStrip({ stats, loading }) {
  if (loading) return <div className="card aura-wash p-5 grid grid-cols-3 gap-4" aria-hidden><div className="skeleton h-14" /><div className="skeleton h-14" /><div className="skeleton h-14" /></div>;
  return (
    <section className="card aura-wash p-5" aria-label="Last 30 days" data-testid="hero">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[13px] font-medium text-ink-3">Last 30 days</h2>
        {stats.includesDemo && <span className="pill-warn" title="These numbers include demo data">Includes demo data</span>}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Stat testid="stat-sent" label="Requests sent" value={stats.sent} />
        <Stat testid="stat-rate" label="Responded" value={stats.responseRate === null ? null : stats.responseRate * 100}
          display={formatPercent(stats.responseRate)} sub={stats.sent ? `${stats.responded} of ${stats.sent}` : "Nothing sent yet"} />
        <Stat testid="stat-rating" label="Private score" value={stats.avgRating} display={stats.avgRating === null ? "–" : stats.avgRating.toFixed(1)}
          sub={stats.ratingCount ? `out of 5, ${stats.ratingCount} answer${stats.ratingCount === 1 ? "" : "s"}` : "No answers yet"} />
      </div>
      <p className="mt-4 text-[12px] text-ink-3">{stats.googleTaps} tapped through to Google. Google doesn't say who finished a review, so nothing here counts reviews.</p>
    </section>
  );
}

/** Loud, specific, never silent: what's wrong and what it does to customers. */
export function ReviewUrlBanner() {
  const s = reviewUrlStatus(companyConfig.reviewUrl);
  if (s.ok) return null;
  const w = REVIEW_URL_WARNINGS[s.state];
  return (
    <section role="alert" className="rounded-card bg-bad-soft text-bad p-4 flex gap-3" data-testid="reviewurl-warning">
      <Icon name="alert" size={22} className="flex-shrink-0 mt-0.5" />
      <div className="space-y-1">
        <h2 className="text-[15px] font-semibold">{w.title}</h2>
        <p className="text-[14px] text-ink-2">{w.body}</p>
        <a {...linkProps("/setup")} className="inline-flex items-center min-h-[44px] text-[15px] font-semibold text-bad underline underline-offset-2">Set your Google review link</a>
      </div>
    </section>
  );
}

export function StagePill({ request }) {
  const st = STAGE_LABELS[requestStage(request)];
  return <span className={`pill-${st.tone}`}>{st.label}</span>;
}

export function ChannelLabel({ channel }) {
  return <span className="inline-flex items-center gap-1"><Icon name={channel === "email" ? "mail" : "chat"} size={14} />{channel === "email" ? "Email" : "WhatsApp"}</span>;
}

export function Stars({ rating, size = 14 }) {
  return (
    <span className="inline-flex gap-0.5 text-[#ff9500]" role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden fill={i <= rating ? "currentColor" : "#e3e3e8"}>
          <path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.6l-5 2.6.9-5.6-4-3.9 5.6-.8z" />
        </svg>
      ))}
    </span>
  );
}

/** Shown where a feature needs the 2026-11-05 database patch. */
export function NeedsPatch({ what }) {
  return (
    <div className="card p-4 text-[14px] text-ink-3 flex gap-3" data-testid="needs-patch">
      <Icon name="database" className="flex-shrink-0 text-ink-4" />
      <p>{what} needs the November database update (supabase/patches/2026-11-05-compete-upgrades.sql). Everything else works as before.</p>
    </div>
  );
}
