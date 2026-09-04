import type { Metadata } from 'next';
import { Section, ServicesGrid, CallToAction } from '@/components/marketing/sections';
import { Figure } from '@/components/marketing/Figure';

export const metadata: Metadata = {
  title: 'Services',
  description:
    'Physiatry consultations, medical acupuncture, physical, occupational, speech and ' +
    'psychological therapy, and prosthetics and orthotics programmes.',
};

export default function ServicesPage() {
  return (
    <>
      <Section
        level={1}
        eyebrow="Services"
        title="Rehabilitation medicine, end to end"
        lead="Each service below is delivered under a plan written by a rehabilitation physician, not booked in isolation. If you are unsure which you need, start with a consultation."
      >
        <Figure slot="services" priority sizes="(min-width: 1280px) 72rem, 100vw" className="mb-12" />
        <ServicesGrid detailed />
      </Section>

      <div className="border-y border-line bg-surface">
        <Section eyebrow="A note on referrals" title="Working with your other doctors">
          <div className="grid max-w-4xl gap-5 sm:grid-cols-2">
            <div className="card">
              <h3 className="text-base font-semibold">If a doctor referred you</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">
                Bring their letter. We write back to them with our findings and the plan, so
                your care stays joined up rather than running in parallel.
              </p>
            </div>
            <div className="card">
              <h3 className="text-base font-semibold">If you came on your own</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">
                No referral is needed. If your case needs a service we do not provide, we will
                refer you onward and tell you exactly why.
              </p>
            </div>
          </div>
        </Section>
      </div>

      <CallToAction />
    </>
  );
}
