import { useEffect, useMemo, useRef, useState } from "react";
import Sheet from "./ui/Sheet.jsx";
import Icon from "./ui/Icon.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { Segmented } from "./ui/Field.jsx";
import { useToast } from "./ui/Toast.jsx";
import { useData } from "../state/DataStore.jsx";
import { composeMessage, whatsappLink, defaultChannel } from "../lib/compose.js";
import { canFollowUp, followUpChannels, followUpSettings, FOLLOW_UP_REFUSALS } from "../lib/followup.js";
import { buildTrackedLink, buildWaLink } from "../lib/templates.js";
import { reviewUrlStatus } from "../lib/reviewUrl.js";
import { saveDraft, loadDraft, clearDraft } from "../lib/cache.js";
import { formatDate } from "../lib/format.js";
import { companyConfig } from "../../companyConfig.js";

const DAY = 86400000;
const first = (name) => String(name ?? "").trim().split(/\s+/)[0] || "them";

/**
 * Sends ONE review request (kind "request") or the ONE follow-up (kind
 * "followup"). WhatsApp first: the owner's own WhatsApp opens with a message
 * written for this customer. Email is the second channel. Nothing is sent
 * automatically; every send is the owner's tap.
 */
export default function ComposerSheet({ customer, job, kind = "request", request: existing = null, onClose, onNext }) {
  const data = useData();
  const toast = useToast();
  const isFollowUp = kind === "followup";
  const settings = followUpSettings(companyConfig);
  const url = reviewUrlStatus(companyConfig.reviewUrl);
  // A real customer's one consent-based ask would be wasted on a link that
  // leads nowhere, so real sends wait for the review link. Demo customers
  // have placeholder numbers, so trying the loop in demo mode is harmless.
  const blockedByUrl = !url.ok && !customer.is_demo;

  // Cooldown applies to the first ask only (the follow-up has its own rules).
  const lastAsk = useMemo(() => data.requests.filter((r) => r.customer_id === customer.id && r.sent_at)
    .sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))[0] ?? null, [data.requests, customer.id]);
  const cooling = !isFollowUp && lastAsk && Date.now() - Date.parse(lastAsk.sent_at) < companyConfig.cooldownDays * DAY;
  const followCheck = isFollowUp ? canFollowUp(existing, { afterDays: settings.afterDays, maxDays: settings.maxDays }) : { ok: true };

  const channels = isFollowUp ? followUpChannels(customer, settings) : ["whatsapp", ...(customer.email ? ["email"] : [])];
  const [channel, setChannel] = useState(() => (isFollowUp ? channels[0] ?? "whatsapp" : defaultChannel(customer)));
  const [request, setRequest] = useState(existing);
  const [prepError, setPrepError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [done, setDone] = useState(null); // { channel, note }
  const sentRef = useRef(false);
  const draftRef = useRef(null);
  const canSend = !blockedByUrl && !cooling && followCheck.ok;

  // Reserve the request row (sent_at null) so the tracked link exists before
  // the tap. Unsent rows count for nothing, and are cleared if not sent.
  useEffect(() => {
    if (isFollowUp || !canSend) return;
    let alive = true;
    data.createDraftRequest({ customerId: customer.id, jobId: job?.id ?? null, channel: defaultChannel(customer) })
      .then((row) => { if (alive) { setRequest(row); draftRef.current = row; } else data.discardDraft(row.id).catch(() => {}); })
      .catch((e) => alive && setPrepError(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reviewLink = request ? buildTrackedLink(window.location.origin, request.token) : null;
  const composed = useMemo(() => (reviewLink
    ? composeMessage({ customer, job, config: companyConfig, reviewLink, channel, kind: isFollowUp ? "followup" : "request", seed: data.requests.filter((r) => r.sent_at).length })
    : null), [reviewLink, channel, customer, job, isFollowUp]); // eslint-disable-line react-hooks/exhaustive-deps

  // The WhatsApp text is editable (owner's voice) and survives a reload.
  const draftKey = `${kind}:${customer.id}:${job?.id ?? "none"}`;
  const [text, setText] = useState(null);
  useEffect(() => {
    if (composed?.channel === "whatsapp" && text === null) setText(loadDraft(data.user.id, draftKey)?.text ?? composed.text);
  }, [composed]); // eslint-disable-line react-hooks/exhaustive-deps
  const wa = channel === "whatsapp" && text !== null && reviewLink ? whatsappLink(customer, text, reviewLink) : null;

  async function close() {
    // Opened but never sent: remove the reserved row.
    if (!sentRef.current && draftRef.current) data.discardDraft(draftRef.current.id).catch(() => {});
    onClose?.(done);
  }

  async function onWhatsapp() {
    // The anchor opens WhatsApp itself (no popup blocker); we record the send.
    sentRef.current = true;
    try {
      if (isFollowUp) await data.recordFollowUp(request.id, "whatsapp");
      else await data.markSent(request.id, "whatsapp");
      clearDraft(data.user.id, draftKey);
      setDone({ channel: "whatsapp" });
    } catch (e) {
      sentRef.current = false;
      setSendError(e.message);
    }
  }

  async function onEmail() {
    setBusy(true); setSendError(null);
    try {
      const res = await data.sendEmail(request.id, { followUp: isFollowUp });
      sentRef.current = true;
      if (isFollowUp) await data.recordFollowUp(request.id, "email");
      else await data.markSent(request.id, "email");
      setDone({ channel: "email", note: res.blocked ? `Test mode: nothing was actually emailed. It would have gone to ${res.to}.` : null });
    } catch (e) {
      setSendError(`${e.message} Nothing was recorded as sent, so ${first(customer.name)} stays in the list.`);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    try {
      await data.deleteRequest(request.id);
      toast("Undone. They're back in Ask now.");
      onClose?.(null);
    } catch (e) { setSendError(e.message); }
  }

  const title = isFollowUp ? `Follow up with ${first(customer.name)}` : `Ask ${first(customer.name)} for a review`;

  if (done) {
    return (
      <Sheet onClose={() => onClose?.(done)} title={isFollowUp ? "Follow-up sent" : "Request sent"}
        footer={
          <div className="space-y-2">
            {onNext ? <button type="button" className="btn-primary w-full text-[17px]" onClick={() => onNext(done)} data-testid="composer-next">Next customer</button>
              : <button type="button" className="btn-primary w-full text-[17px]" onClick={() => onClose?.(done)} data-testid="composer-done">Done</button>}
            {!isFollowUp && done.channel === "whatsapp" && <button type="button" className="btn-plain w-full" onClick={undo} data-testid="composer-undo">Didn't send it? Undo</button>}
          </div>
        }>
        <div className="text-center space-y-3 py-2" data-testid="composer-success">
          <span className="mx-auto h-14 w-14 rounded-full bg-good-soft text-good inline-flex items-center justify-center"><Icon name="check" size={28} /></span>
          <p className="text-[17px] font-semibold">{done.channel === "whatsapp" ? `Sent to ${first(customer.name)} on WhatsApp` : `Emailed ${first(customer.name)}`}</p>
          <p className="text-[15px] text-ink-3 max-w-sm mx-auto">
            {isFollowUp
              ? `That was the one follow-up. ${first(customer.name)} won't be offered another, whatever happens.`
              : `You'll see it here when they open the link, answer, or tap through to Google. If they don't respond in ${settings.afterDays} days, they'll get one gentle follow-up slot.`}
          </p>
          {done.note && <p className="rounded-[12px] bg-warn-soft text-warn px-3 py-2 text-[14px]">{done.note}</p>}
        </div>
      </Sheet>
    );
  }

  const footer = !canSend ? (
    <button type="button" className="btn-secondary w-full text-[17px]" onClick={close}>Close</button>
  ) : channel === "whatsapp" ? (
    <div className="space-y-2">
      <a href={wa?.link ?? undefined} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (!wa?.link) { e.preventDefault(); return; } onWhatsapp(); }}
        aria-disabled={!wa?.link} data-testid="composer-whatsapp"
        className={`btn-primary w-full text-[17px] ${wa?.link ? "" : "opacity-45 pointer-events-none"}`}>
        <Icon name="chat" /> {isFollowUp ? "Send follow-up on WhatsApp" : "Open WhatsApp"}
      </a>
      <button type="button" className="btn-plain w-full" onClick={close}>Not now</button>
    </div>
  ) : (
    <div className="space-y-2">
      <button type="button" className="btn-primary w-full text-[17px]" disabled={busy || !composed || composed.error} onClick={onEmail} data-testid="composer-email">
        <Icon name="mail" /> {busy ? "Sending…" : isFollowUp ? "Send follow-up email" : "Send email"}
      </button>
      <button type="button" className="btn-plain w-full" onClick={close}>Not now</button>
    </div>
  );

  return (
    <Sheet onClose={close} title={title} footer={footer} wide>
      <div className="space-y-4" data-testid="composer">
        <div className="flex items-start gap-3">
          <span className="h-10 w-10 rounded-full bg-fill inline-flex items-center justify-center text-[15px] font-semibold text-ink-2 flex-shrink-0">{first(customer.name)[0]}</span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold flex items-center gap-2">{customer.name}{customer.is_demo && <span className="pill-warn">Demo</span>}</div>
            <div className="text-[13px] text-ink-3 truncate">{job?.description ?? "No job description"}{job?.completed_at ? ` · finished ${formatDate(job.completed_at)}` : ""}</div>
          </div>
        </div>

        {blockedByUrl && (
          <div className="rounded-[12px] bg-bad-soft text-bad px-3.5 py-3 text-[14px]" role="alert" data-testid="composer-blocked">
            <strong className="block">Set your Google review link first.</strong>
            A request sent now would lead {first(customer.name)} to a page that can't take a review, and use up your one ask. Add it in Setup.
          </div>
        )}
        {cooling && (
          <div className="rounded-[12px] bg-warn-soft text-warn px-3.5 py-3 text-[14px]" data-testid="composer-cooldown">
            <strong className="block">Asked {formatDate(lastAsk.sent_at)}.</strong>
            We hold off for {companyConfig.cooldownDays} days between asks so customers don't feel nagged. {first(customer.name)} comes back on {formatDate(Date.parse(lastAsk.sent_at) + companyConfig.cooldownDays * DAY)}.
          </div>
        )}
        {isFollowUp && !followCheck.ok && (
          <div className="rounded-[12px] bg-warn-soft text-warn px-3.5 py-3 text-[14px]" role="alert" data-testid="composer-refused">{FOLLOW_UP_REFUSALS[followCheck.reason]}</div>
        )}

        {canSend && (
          <>
            {channels.length > 1 && (
              <Segmented label="Channel" value={channel} onChange={(v) => { setChannel(v); setSendError(null); }}
                options={channels.map((c) => ({ value: c, label: c === "whatsapp" ? "WhatsApp" : "Email" }))} />
            )}
            {!request && !prepError && <div className="space-y-2" aria-hidden><Skeleton className="h-4 w-1/3" /><Skeleton className="h-24 w-full" /></div>}
            {prepError && <p className="field-error" role="alert"><Icon name="alert" size={15} />{prepError}</p>}

            {channel === "whatsapp" && text !== null && (
              <div>
                <label htmlFor="wa-text" className="field-label">Message</label>
                <textarea id="wa-text" className="input min-h-[132px]" value={text} data-testid="composer-text"
                  onChange={(e) => { setText(e.target.value); saveDraft(data.user.id, draftKey, e.target.value); }} />
                {wa?.error ? <p className="field-error" role="alert"><Icon name="alert" size={15} />{wa.error}</p>
                  : <p className="field-help">Written for {first(customer.name)}: their name, the job and when. Edit it if you like; keep the link.</p>}
                {text !== composed?.text && <button type="button" className="btn-plain -ml-3 mt-1" onClick={() => { setText(composed.text); clearDraft(data.user.id, draftKey); }}>Reset message</button>}
                {!buildWaLink(customer.phone, "x") && <p className="field-error"><Icon name="alert" size={15} />{customer.phone ? `${customer.phone} isn't in international format.` : "No phone number."} Edit the customer, or use email.</p>}
              </div>
            )}
            {channel === "email" && composed && (
              composed.error ? <p className="field-error" role="alert"><Icon name="alert" size={15} />{composed.error}</p> : (
                <div className="rounded-[14px] border border-hairline p-4 space-y-2 text-[15px]" data-testid="composer-email-preview">
                  <div className="text-[13px] text-ink-3">To {composed.to}</div>
                  <div className="font-semibold">{composed.subject}</div>
                  <p className="whitespace-pre-line text-ink-2">{composed.text}</p>
                  <p className="text-[13px] text-ink-3">Sent from {companyConfig.fromEmail} with a "Leave a Google review" button.</p>
                </div>
              )
            )}
            {reviewLink && <p className="text-[13px] text-ink-3 break-all">Tracked link: <span className="text-ink-2">{reviewLink}</span></p>}
            {sendError && <p className="field-error" role="alert"><Icon name="alert" size={15} />{sendError}</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
