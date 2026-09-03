import React from 'react';

export function Card({ title, action, children, className = '' }: {
  title?: React.ReactNode; action?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title ? <h2 className="text-sm font-semibold text-slate-700">{title}</h2> : <span />}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const TONES = {
  neutral: 'bg-slate-100 text-slate-700',
  due: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-800',
  ok: 'bg-emerald-100 text-emerald-800',
  draft: 'bg-orange-100 text-orange-900',
} as const;

export function Badge({ tone = 'neutral', children }: {
  tone?: keyof typeof TONES; children: React.ReactNode;
}) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card">
      <p className="label">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
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
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</p>;
}
