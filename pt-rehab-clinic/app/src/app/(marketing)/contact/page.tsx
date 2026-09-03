import type { Metadata } from 'next';
import { Section } from '@/components/marketing/sections';
import { IconPhone, IconMail, IconClock, IconPin, IconArrow } from '@/components/icons';
import { site, branches } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Call or email the branch nearest you to book a consultation.',
};

const tel = (value: string) => `tel:${value.replace(/[^\d+]/g, '')}`;

/**
 * Deliberately no web form.
 *
 * A form that posts nowhere is worse than none — a patient would believe they
 * had reached us. Inbound inquiry capture is the Phase 3 lead tracker; until it
 * exists and someone is accountable for answering it, the page hands people a
 * phone number and a pre-composed email instead.
 */
export default function ContactPage() {
  const mailto =
    `mailto:${site.email}` +
    `?subject=${encodeURIComponent('Consultation inquiry')}` +
    `&body=${encodeURIComponent(
      'Hello,\n\nI would like to ask about booking a consultation.\n\n' +
      'Name:\nPreferred branch:\nPreferred day/time:\nContact number:\n' +
      'What I need help with:\n\nThank you.',
    )}`;

  return (
    <>
      <Section
        level={1}
        eyebrow="Contact"
        title="Talk to the branch nearest you"
        lead="The front desk books your slot, confirms what your PhilHealth or HMO covers, and tells you what to bring. They answer during clinic hours."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          <a href={tel(site.phone)} className="card-interactive group">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <IconPhone className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-base font-semibold">Call us</h2>
            <p className="mt-1 text-lg font-semibold text-brand">{site.phone}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Fastest way to book. Ask for the branch you want.
            </p>
          </a>

          <a href={mailto} className="card-interactive group">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <IconMail className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-base font-semibold">Email us</h2>
            <p className="mt-1 break-all text-sm font-medium text-brand">{site.email}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">
              Opens a message with the details we need already filled in.
            </p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand">
              Compose <IconArrow width={15} height={15} />
            </span>
          </a>

          <div className="card">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <IconClock className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-base font-semibold">Clinic hours</h2>
            <p className="mt-1 text-sm font-medium">{site.hours}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">
              Closed on Sundays and public holidays.
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-caution/30 bg-caution/5 px-5 py-4">
          <p className="text-sm leading-relaxed text-pretty">
            <strong className="font-semibold">In an emergency, do not use this page.</strong>{' '}
            <span className="text-muted">
              Go to the nearest emergency department. Please do not send medical details or
              images by email — bring them to your appointment instead.
            </span>
          </p>
        </div>
      </Section>

      <div className="border-y border-line bg-surface">
        <Section eyebrow="Direct lines" title="Branch numbers">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {branches.map((branch) => (
              <li key={branch.id}>
                <a href={tel(branch.phone)} className="card-interactive flex items-start gap-3">
                  <IconPin className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                  <span>
                    <span className="block text-sm font-semibold">{branch.name}</span>
                    <span className="block text-sm text-muted">{branch.area}</span>
                    <span className="mt-1 block text-sm font-medium text-brand">{branch.phone}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
