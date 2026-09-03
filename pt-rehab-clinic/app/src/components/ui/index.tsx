import React from 'react';

export function PageHeader({
  title, lead, actions,
}: { title: string; lead?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {lead ? <p className="mt-1.5 max-w-2xl text-sm text-muted text-pretty">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, action, children, className = '' }: {
  title?: React.ReactNode; action?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const TONES = {
  neutral: 'bg-raised text-muted',
  ok: 'bg-positive/12 text-positive',
  due: 'bg-caution/12 text-caution',
  draft: 'bg-accent/12 text-accent',
  danger: 'bg-critical/12 text-critical',
  brand: 'bg-brand/12 text-brand',
} as const;

export function Badge({ tone = 'neutral', children }: {
  tone?: keyof typeof TONES; children: React.ReactNode;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: {
  label: string; value: React.ReactNode; hint?: string; tone?: keyof typeof TONES;
}) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${tone === 'due' ? 'text-caution' : 'text-ink'}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

export function Field({ label, children, hint }: {
  label: string; children: React.ReactNode; hint?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span> : null}
    </label>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm text-muted text-pretty">{children}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Horizontal scroll is contained here so the page body never scrolls sideways. */
export function TableWrap({ children, minWidth = 640 }: {
  children: React.ReactNode; minWidth?: number;
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full" style={{ minWidth }}>{children}</table>
    </div>
  );
}

export function Note({ tone = 'neutral', children }: {
  tone?: 'neutral' | 'caution' | 'brand'; children: React.ReactNode;
}) {
  const styles = {
    neutral: 'border-line bg-raised/60 text-muted',
    caution: 'border-caution/30 bg-caution/5 text-ink',
    brand: 'border-brand/25 bg-brand/5 text-ink',
  }[tone];
  return (
    <p className={`rounded-lg border px-4 py-3 text-sm leading-relaxed text-pretty ${styles}`}>
      {children}
    </p>
  );
}
