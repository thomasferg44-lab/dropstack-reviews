// Small primitives on the DropStack dashboard tokens. Keep this file boring.

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-1/60 disabled:opacity-50 disabled:cursor-not-allowed";

const variants = {
  primary: "bg-brand-gradient text-bg hover:opacity-90",
  secondary: "bg-surface border border-border text-text hover:border-text-dim",
  ghost: "text-text-mute hover:text-text hover:bg-surface",
};

export function Button({ variant = "secondary", className = "", ...props }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }) {
  return (
    <input
      className={
        "w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim " +
        "focus:outline-none focus:border-accent-1 " +
        className
      }
      {...props}
    />
  );
}

export function Label({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-mute">
      {children}
    </label>
  );
}

export function Badge({ children, tone = "mute" }) {
  const tones = {
    mute: "border-border text-text-mute",
    accent: "border-accent-1/40 text-accent-1",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ className = "", children }) {
  return <div className={`rounded-xl border border-border bg-surface ${className}`}>{children}</div>;
}

export function EmptyState({ title, body }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <p className="text-base font-medium text-text">{title}</p>
      {body && <p className="mt-1 text-sm text-text-mute">{body}</p>}
    </div>
  );
}

export function ErrorNotice({ children }) {
  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <span
      aria-label="Loading"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-text-dim border-t-accent-1"
    />
  );
}
