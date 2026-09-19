import { useState } from "react";
import { useQueue } from "./useQueue.js";
import { SUPPRESSION_LABELS } from "./eligibility.js";
import { companyConfig } from "../../../companyConfig.js";
import { formatDate } from "../../lib/format.js";
import { Card, EmptyState, ErrorNotice, Spinner, Button, Badge } from "../../components/ui.jsx";

function daysWaiting(completedAt) {
  const days = Math.floor((Date.now() - new Date(completedAt).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Every row below gets the same two buttons and, from Stage 6, the same public
// review link. There is no satisfaction question in this flow by design — see
// the review-gating section of CLAUDE.md.
function AskRow({ entry }) {
  const { customer, job } = entry;
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-text">{customer.name}</p>
          <p className="mt-0.5 truncate text-sm text-text-mute">{job.description || "No job description"}</p>
          <p className="mt-0.5 text-xs text-text-dim">Finished {daysWaiting(job.completed_at)} · {formatDate(job.completed_at)}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            disabled
            title="WhatsApp link generation lands in Stage 6"
            aria-label={`Ask ${customer.name} by WhatsApp`}
          >
            WhatsApp
          </Button>
          <Button
            variant="secondary"
            disabled
            title="Email sending lands in Stage 8"
            aria-label={`Ask ${customer.name} by email`}
          >
            Email
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function AskQueue() {
  const { ready, suppressed, loading, error, refresh } = useQueue();
  const [showHidden, setShowHidden] = useState(false);

  const noContact = suppressed.filter((s) => s.reason === "no-contact");

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text">Ask now</h1>
          <p className="text-sm text-text-mute">
            {loading ? "Loading…" : `${ready.length} customer${ready.length === 1 ? "" : "s"} ready to ask`}
          </p>
        </div>
        <Button variant="ghost" onClick={refresh} disabled={loading} aria-label="Refresh">
          {loading ? <Spinner /> : "Refresh"}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-mute">
        Sending is wired up in the next stage. This stage decides <em>who</em> to ask.
      </div>

      {error && <ErrorNotice>Couldn’t build the queue: {error}</ErrorNotice>}

      {!loading && !error && ready.length === 0 && (
        <EmptyState
          title="Nobody to ask right now"
          body={
            suppressed.length > 0
              ? "Everyone with a finished job has been asked recently. Log a new completed job to add someone here."
              : "Log a completed job against a customer and they’ll appear here."
          }
        />
      )}

      {ready.length > 0 && (
        <ul className="space-y-2">
          {ready.map((entry) => (
            <li key={entry.customer.id}><AskRow entry={entry} /></li>
          ))}
        </ul>
      )}

      {noContact.length > 0 && (
        <ErrorNotice>
          {noContact.length} customer{noContact.length === 1 ? " has" : "s have"} a finished job but no phone or email,
          so they can’t be asked: {noContact.map((s) => s.customer.name).join(", ")}.
        </ErrorNotice>
      )}

      {suppressed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="text-sm text-text-mute underline-offset-4 hover:text-text hover:underline"
          >
            {showHidden ? "Hide" : "Show"} {suppressed.length} hidden customer{suppressed.length === 1 ? "" : "s"}
          </button>

          {showHidden && (
            <Card className="mt-2 overflow-hidden">
              <p className="border-b border-border px-4 py-2 text-xs text-text-dim">
                Hidden so you don’t nag anyone. Cooldown is {companyConfig.cooldownDays} days, set in companyConfig.js.
              </p>
              <ul className="divide-y divide-border">
                {suppressed.map((s) => (
                  <li key={s.customer.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="text-text">{s.customer.name}</span>
                    <span className="flex items-center gap-2 text-text-mute">
                      <Badge>{SUPPRESSION_LABELS[s.reason]}</Badge>
                      {s.reason === "cooldown" && (
                        <span className="text-xs text-text-dim">
                          asked {s.daysSinceAsk} day{s.daysSinceAsk === 1 ? "" : "s"} ago · free on {formatDate(s.availableOn)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}
