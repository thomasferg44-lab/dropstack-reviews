import { useMemo, useState } from "react";
import Icon from "../components/ui/Icon.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import { Segmented } from "../components/ui/Field.jsx";
import { useToast } from "../components/ui/Toast.jsx";
import { StagePill, ChannelLabel, Stars, NeedsPatch } from "../components/Bits.jsx";
import { useData } from "../state/DataStore.jsx";
import useDerived from "../state/useDerived.js";
import { navigate, linkProps } from "../hooks/useRoute.js";
import { feedbackList } from "../lib/responses.js";
import { replyDraft } from "../lib/replyDrafts.js";
import { buildWaLink } from "../lib/templates.js";
import { formatDate } from "../lib/format.js";
import { companyConfig } from "../../companyConfig.js";

/**
 * Activity: every request (what happened to it) and every feedback answer,
 * with a ready-to-paste reply in the owner's voice. "Went to Google" is a tap,
 * not a review: Google tells nobody whether one was written.
 */
export default function ActivityPage({ tab }) {
  const { schema } = useData();
  const { sent } = useDerived();
  return (
    <div className="space-y-4">
      <Segmented label="Show" value={tab} onChange={(v) => navigate(v === "feedback" ? "/activity?tab=feedback" : "/activity", { replace: true })}
        options={[{ value: "requests", label: "Requests" }, { value: "feedback", label: "Feedback" }]} />
      {tab === "feedback" ? (schema === "v1" ? <NeedsPatch what="Customer feedback" /> : <FeedbackList />) : <RequestList sent={sent} />}
    </div>
  );
}

function RequestList({ sent }) {
  const { customerById, jobById } = useDerived();
  const rows = useMemo(() => [...sent].sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at)), [sent]);
  if (rows.length === 0) {
    return <EmptyState icon="send" title="Nothing sent yet" action={<a className="btn-primary w-full sm:w-auto" {...linkProps("/")}>Go to Ask now</a>}>Every request you send shows here, with whether they opened it, answered, or went on to Google.</EmptyState>;
  }
  return (
    <ul className="group-list" data-testid="request-list">
      {rows.map((r) => {
        const c = customerById.get(r.customer_id);
        return (
          <li key={r.id}>
            <a {...linkProps(`/customers/${r.customer_id}`)} className="group-row items-start hover:bg-fill/50" data-testid="request-row">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="text-[16px] font-semibold truncate flex items-center gap-2">{c?.name ?? "Deleted customer"}{r.is_demo && <span className="pill-warn">Demo</span>}</div>
                <div className="text-[14px] text-ink-3 truncate">{formatDate(r.sent_at)} · <ChannelLabel channel={r.channel} />{jobById.get(r.job_id) ? ` · ${jobById.get(r.job_id).description}` : ""}</div>
                {r.followed_up_at && <div className="text-[13px] text-ink-3">Followed up {formatDate(r.followed_up_at)} (the one follow-up)</div>}
              </div>
              <StagePill request={r} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function FeedbackList() {
  const { requests } = useData();
  const { customerById, jobById } = useDerived();
  const toast = useToast();
  const list = useMemo(() => feedbackList(requests), [requests]);
  const [band, setBand] = useState("all");
  const shown = band === "low" ? list.filter((r) => r.feedback_rating <= 3) : list;

  if (list.length === 0) {
    return <EmptyState icon="quote" title="No feedback yet" action={<a className="btn-primary w-full sm:w-auto" {...linkProps("/")}>Ask a customer</a>}>
      When a customer answers “How was your experience?” on the review page, it lands here with a reply ready to send.</EmptyState>;
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Reply copied."); } catch { toast("Couldn't copy. Select the text instead."); }
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button className={band === "all" ? "pill-info" : "pill-neutral"} onClick={() => setBand("all")} style={{ height: 36 }}>All {list.length}</button>
        <button className={band === "low" ? "pill-info" : "pill-neutral"} onClick={() => setBand("low")} style={{ height: 36 }}>3 or lower {list.filter((r) => r.feedback_rating <= 3).length}</button>
      </div>
      <p className="text-[13px] text-ink-3 px-1">Private answers from the review page. Everyone who answered was also shown the Google button, whatever they said.</p>
      <ul className="space-y-3" data-testid="feedback-list">
        {shown.map((r) => {
          const c = customerById.get(r.customer_id);
          const draft = replyDraft({ rating: r.feedback_rating, customer: c, job: jobById.get(r.job_id), config: companyConfig });
          const wa = c?.phone ? buildWaLink(c.phone, draft.text) : null;
          return (
            <li key={r.id} className="card p-4 space-y-3" data-testid="feedback-item">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold flex items-center gap-2">{c?.name ?? "Deleted customer"}{r.is_demo && <span className="pill-warn">Demo</span>}</div>
                  <div className="text-[13px] text-ink-3">{formatDate(r.feedback_at)}{jobById.get(r.job_id) ? ` · ${jobById.get(r.job_id).description}` : ""}</div>
                </div>
                <div className="text-right"><Stars rating={r.feedback_rating} size={16} /><div className="text-[12px] text-ink-3 mt-0.5">{r.google_clicked_at ? "Went to Google" : "Didn't go to Google"}</div></div>
              </div>
              {r.feedback_comment ? <blockquote className="text-[15px] text-ink-2 border-l-2 border-hairline pl-3">{r.feedback_comment}</blockquote> : <p className="text-[14px] text-ink-3">No comment, just the score.</p>}
              <div className="rounded-[14px] bg-fill p-3 space-y-2" data-testid="reply-draft" data-band={draft.band}>
                <div className="text-[12px] font-semibold text-ink-3">Reply draft · {draft.label}</div>
                <p className="text-[15px]">{draft.text}</p>
                <div className="flex flex-wrap gap-2">
                  {wa && <a className="btn-primary !min-h-[44px]" href={wa} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={18} /> Reply on WhatsApp</a>}
                  <button className="btn-secondary" onClick={() => copy(draft.text)} data-testid="reply-copy"><Icon name="copy" size={18} /> Copy</button>
                </div>
                <p className="text-[12px] text-ink-3">Also works as your public reply on Google if they post a review there.</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
