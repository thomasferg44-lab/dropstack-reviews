import { useEffect, useRef, useState } from "react";
import { Button, ErrorNotice } from "../../components/ui.jsx";

// Shown after a request row has been created. The owner sends the message from
// their own WhatsApp, so this is a real anchor rather than a scripted popup:
// popup blockers silently eat window.open() calls made after an await.
export default function SendPanel({ send, onUndo, onClose }) {
  const [copied, setCopied] = useState("");
  const [undoing, setUndoing] = useState(false);
  const linkRef = useRef(null);

  useEffect(() => {
    linkRef.current?.focus();
  }, []);

  async function copy(what, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-mute">Message to {send.customerName}</p>
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg p-3 text-text">
{send.message}
        </pre>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-mute">Tracked link</p>
        <p className="break-all rounded-lg border border-border bg-bg p-2 text-xs text-text-mute">{send.reviewLink}</p>
      </div>

      <a
        ref={linkRef}
        href={send.link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClose}
        className="inline-flex w-full items-center justify-center rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-medium text-bg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-1/60"
      >
        Open WhatsApp
      </a>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => copy("message", send.message)}>
          {copied === "message" ? "Copied" : "Copy message"}
        </Button>
        <Button variant="secondary" onClick={() => copy("link", send.reviewLink)}>
          {copied === "link" ? "Copied" : "Copy link"}
        </Button>
      </div>
      {copied === "failed" && <ErrorNotice>Couldn’t copy. Select the text above instead.</ErrorNotice>}

      <div className="border-t border-border pt-3">
        <p className="text-xs text-text-dim">
          Marked as sent, so {send.customerName} is now hidden from the queue for the cooldown period.
        </p>
        <Button
          variant="ghost"
          className="mt-1 px-0"
          disabled={undoing}
          onClick={async () => { setUndoing(true); await onUndo(); }}
        >
          {undoing ? "Undoing…" : "Didn’t send it? Undo"}
        </Button>
      </div>
    </div>
  );
}
