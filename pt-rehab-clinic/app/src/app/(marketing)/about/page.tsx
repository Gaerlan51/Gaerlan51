import type { Metadata } from 'next';
import { Section, CareModel, CallToAction } from '@/components/marketing/sections';
import { IconShield, IconCheck } from '@/components/icons';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: 'About',
  description:
    'A physician-led rehabilitation practice built around scheduled review, ' +
    'coordinated disciplines and careful handling of health information.',
};

const PRINCIPLES = [
  {
    title: 'One physician owns the plan',
    body: 'Rehabilitation fails when nobody is accountable for the whole picture. A ' +
          'rehabilitation physician assesses you, writes the plan, and stays responsible ' +
          'for changing it.',
  },
  {
    title: 'Review is scheduled, not requested',
    body: 'After every six therapy sessions — monthly for paediatric cases — your progress ' +
          'goes back to the doctor. You do not have to ask for it, and it does not depend ' +
          'on anyone remembering.',
  },
  {
    title: 'Branches stay local',
    body: 'Each branch keeps its own front desk, schedule and records. The team that treats ' +
          'you is the team that knows your case.',
  },
  {
    title: 'Therapy is measured',
    body: 'Every session is recorded against your plan, so a conversation about progress ' +
          'starts from what actually happened rather than an impression.',
  },
];

export default function AboutPage() {
  return (
    <>
      <Section
        level={1}
        eyebrow="About us"
        title="Rehabilitation medicine, practised deliberately"
        lead={`${site.name} is a physician-led practice across five branches. We treat function — walking, gripping, speaking, working — and we structure care so that progress is verified rather than hoped for.`}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <article key={p.title} className="card">
              <h3 className="text-base font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">{p.body}</p>
            </article>
          ))}
        </div>
      </Section>

      <div className="border-y border-line bg-surface">
        <Section eyebrow="How care works" title="What to expect, step by step">
          <CareModel />
        </Section>
      </div>

      <Section eyebrow="Your information" title="How we handle your health records">
        <div className="grid max-w-4xl gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="card">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <IconShield className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-base font-semibold">Data Privacy Act (RA 10173)</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">
              Your records are held in a system built for this practice, with access limited by
              role and every view, change and printout recorded. Staff at one branch cannot open
              another branch&apos;s records. If you want to know what we hold about you, or want a
              copy, ask the front desk.
            </p>
          </div>
          <ul className="space-y-3">
            {[
              'Access limited by role and by branch',
              'Every view and change is logged',
              'Prescriptions require the doctor’s signature',
              'Your records can be exported for you on request',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-muted">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <span className="text-pretty">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <CallToAction />
    </>
  );
}
