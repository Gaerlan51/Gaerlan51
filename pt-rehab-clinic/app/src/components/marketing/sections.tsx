import Link from 'next/link';
import {
  IconStethoscope, IconNeedle, IconPulse, IconHand, IconSpeech, IconBrain, IconLimb,
  IconCheck, IconArrow, IconPin, IconPhone, IconShield, IconClock, IconUsers,
} from '@/components/icons';
import { site, services, branches, payers, faqs, type ServiceEntry } from '@/lib/site';
import { Figure } from './Figure';
import type { ImageKey } from '@/lib/images';

const SERVICE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  physiatry: IconStethoscope,
  acupuncture: IconNeedle,
  'physical-therapy': IconPulse,
  'occupational-therapy': IconHand,
  'speech-therapy': IconSpeech,
  'psychological-services': IconBrain,
  'prosthetics-orthotics': IconLimb,
};

export function Section({
  id, eyebrow, title, lead, children, className = '', level = 2,
}: {
  id?: string; eyebrow?: string; title?: string; lead?: string;
  children: React.ReactNode; className?: string;
  /** Use 1 for the page's primary heading — every page needs exactly one h1. */
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <section id={id} className={`shell scroll-mt-24 py-16 sm:py-20 ${className}`}>
      {(eyebrow || title) && (
        <header className="max-w-2xl">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          {title ? (
            <Heading className={`mt-2 font-semibold ${
              level === 1 ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'
            }`}>
              {title}
            </Heading>
          ) : null}
          {lead ? <p className="prose-lead mt-3 text-pretty">{lead}</p> : null}
        </header>
      )}
      <div className={eyebrow || title ? 'mt-10' : ''}>{children}</div>
    </section>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="grid-lines mask-fade-b pointer-events-none absolute inset-0 opacity-60" />
      <div
        className="pointer-events-none absolute -top-40 right-[-10%] h-[32rem] w-[32rem] rounded-full
                   bg-brand/15 blur-3xl"
        aria-hidden="true"
      />
      <div className="shell relative grid items-center gap-14 py-20 sm:py-28 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="animate-fade-up">
          <p className="eyebrow">Physician-led rehabilitation · Five branches</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.08] sm:text-5xl lg:text-6xl">
            Recover the movement your day depends on.
          </h1>
          <p className="prose-lead mt-6 max-w-xl text-pretty">
            Every plan is written by a rehabilitation physician and reviewed on a
            schedule — so progress is checked, not assumed.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <a href={`tel:${site.phone.replace(/[^\d+]/g, '')}`} className="btn-primary">
              <IconPhone width={18} height={18} /> Book a consultation
            </a>
            <Link href="/branches" className="btn-secondary">
              Find your branch <IconArrow width={16} height={16} />
            </Link>
          </div>

          <dl className="mt-14 grid gap-6 sm:grid-cols-3 lg:grid-cols-1 lg:gap-5">
            {[
              { icon: IconUsers, term: 'Seven disciplines', desc: 'Physiatry, acupuncture, PT, OT, speech, psych and P&O under one plan.' },
              { icon: IconClock, term: 'Reviewed every 6 sessions', desc: 'Musculoskeletal and neurologic cases; monthly for paediatric rehab.' },
              { icon: IconShield, term: 'PhilHealth & HMO', desc: 'Coverage confirmed at the front desk before treatment begins.' },
            ].map(({ icon: Icon, term, desc }) => (
              <div key={term} className="flex gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                <div>
                  <dt className="text-sm font-semibold">{term}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-muted text-pretty">{desc}</dd>
                </div>
              </div>
            ))}
          </dl>

        </div>

        <div className="hidden lg:block">
          <PlanPreview />
        </div>
      </div>
    </section>
  );
}

/**
 * Illustrative, not a record: generic labels only, no patient and no data
 * fetched. It shows the one thing that makes this practice different — the
 * review is counted and scheduled — rather than a stock photo.
 */
function PlanPreview() {
  const sessions = [true, true, true, true, false, false];
  return (
    <div className="animate-fade-up" aria-hidden="true">
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-panel">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Your rehabilitation plan
          </p>
          <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand">
            Active
          </span>
        </div>

        <p className="mt-4 text-lg font-semibold">Physical therapy · 2× weekly</p>
        <p className="mt-1 text-sm text-muted">Musculoskeletal case</p>

        <div className="mt-6">
          <div className="flex items-center justify-between text-xs font-medium text-muted">
            <span>Sessions since last review</span>
            <span className="tabular-nums">4 of 6</span>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            {sessions.map((done, i) => (
              <span
                key={i}
                className={`h-2 flex-1 rounded-full ${done ? 'bg-brand' : 'bg-raised'}`}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-xl bg-raised/70 p-4">
          <IconClock className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div>
            <p className="text-sm font-semibold">Doctor&apos;s review after session 6</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Scheduled with your plan — you do not have to ask for it.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-xl bg-raised/70 p-4">
          <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div>
            <p className="text-sm font-semibold">Home programme, printed</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              Exercises to continue between sessions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PracticeBand() {
  return (
    <div className="shell py-4">
      <Figure slot="practice" priority sizes="(min-width: 1280px) 72rem, 100vw" />
    </div>
  );
}

export function PayerStrip() {
  return (
    <div className="border-b border-line bg-surface">
      <div className="shell grid gap-6 py-8 sm:grid-cols-2 lg:grid-cols-4">
        {payers.map((payer) => (
          <div key={payer.name} className="flex items-start gap-2.5">
            <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <div>
              <p className="text-sm font-semibold">{payer.name}</p>
              <p className="text-xs leading-relaxed text-muted text-pretty">{payer.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServiceCard({ service, detailed = false }: { service: ServiceEntry; detailed?: boolean }) {
  const Icon = SERVICE_ICON[service.slug] ?? IconPulse;
  return (
    <article id={service.slug} className="card-interactive scroll-mt-24 flex flex-col">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-base font-semibold">{service.name}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">
        {detailed ? service.detail : service.short}
      </p>
      <ul className="mt-4 flex flex-wrap gap-1.5">
        {service.treats.map((t) => (
          <li key={t} className="rounded-md bg-raised px-2 py-1 text-[11px] font-medium text-muted">
            {t}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function ServicesGrid({ detailed = false }: { detailed?: boolean }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {services.map((service) => (
        <ServiceCard key={service.slug} service={service} detailed={detailed} />
      ))}
    </div>
  );
}

const STEPS = [
  { n: '01', title: 'Consultation', body: 'A rehabilitation physician examines you and writes the plan — which therapies, how often, and for how long.' },
  { n: '02', title: 'Your programme', body: 'You leave with a printed home programme for your condition, alongside your scheduled sessions.' },
  { n: '03', title: 'Therapy', body: 'Sessions run at your branch with the same team, and every session is recorded against your plan.' },
  { n: '04', title: 'Scheduled review', body: 'After six sessions — or monthly for children — the doctor reviews progress and adjusts the plan.' },
];

export function CareModel() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {STEPS.map((step) => (
        <div key={step.n} className="card">
          <span className="font-display text-3xl font-semibold text-brand/25">{step.n}</span>
          <h3 className="mt-3 text-base font-semibold">{step.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">{step.body}</p>
        </div>
      ))}
    </div>
  );
}

export function BranchGrid() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {branches.map((branch) => (
        <article key={branch.id} id={branch.id} className="card-interactive scroll-mt-24 p-0">
          <Figure
            slot={branch.id as ImageKey}
            rounded="rounded-t-xl"
            className="border-0 border-b"
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          />
          <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">{branch.name}</h3>
              <p className="mt-0.5 text-sm text-muted">{branch.area}</p>
            </div>
            <IconPin className="h-5 w-5 shrink-0 text-brand" />
          </div>
          <p className="mt-4 text-sm text-muted">{branch.address}</p>
          <a href={`tel:${branch.phone.replace(/[^\d+]/g, '')}`}
             className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            <IconPhone width={15} height={15} /> {branch.phone}
          </a>
          <ul className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4">
            {branch.services.map((s) => (
              <li key={s} className="rounded-md bg-raised px-2 py-1 text-[11px] font-medium text-muted">{s}</li>
            ))}
          </ul>
          </div>
        </article>
      ))}
    </div>
  );
}

export function Faq() {
  return (
    <div className="divide-y divide-line rounded-xl border border-line bg-surface">
      {faqs.map((faq) => (
        <details key={faq.q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold">
            {faq.q}
            <span className="shrink-0 text-muted transition-transform group-open:rotate-45" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-muted text-pretty">{faq.a}</p>
        </details>
      ))}
    </div>
  );
}

export function CallToAction() {
  return (
    <section className="shell py-16">
      <div className="relative overflow-hidden rounded-2xl bg-brand px-6 py-14 text-brand-ink shadow-panel sm:px-12">
        <div className="grid-lines pointer-events-none absolute inset-0 opacity-10" aria-hidden="true" />
        <div className="relative max-w-2xl">
          <h2 className="text-2xl font-semibold sm:text-3xl">Start with one consultation.</h2>
          <p className="mt-3 text-pretty opacity-90">
            Call the branch nearest you and the front desk will find a slot, confirm what your
            PhilHealth or HMO covers, and tell you what to bring.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={`tel:${site.phone.replace(/[^\d+]/g, '')}`}
               className="btn bg-surface px-5 py-3 text-ink hover:bg-raised">
              <IconPhone width={18} height={18} /> {site.phone}
            </a>
            <Link href="/branches" className="btn border border-brand-ink/30 px-5 py-3 text-brand-ink hover:bg-brand-ink/10">
              See all five branches
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
