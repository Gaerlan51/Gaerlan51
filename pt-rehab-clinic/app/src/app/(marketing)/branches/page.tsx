import type { Metadata } from 'next';
import { Section, BranchGrid, CallToAction } from '@/components/marketing/sections';
import { site } from '@/lib/site';
import { IconClock } from '@/components/icons';

export const metadata: Metadata = {
  title: 'Branches',
  description: 'Five rehabilitation branches, each with its own team and schedule.',
};

export default function BranchesPage() {
  return (
    <>
      <Section
        level={1}
        eyebrow="Branches"
        title="Five branches, one standard of care"
        lead="Each branch runs its own schedule and front desk, so the people who know your case are the people who answer the phone."
      >
        <BranchGrid />
        <p className="mt-8 inline-flex items-center gap-2 rounded-lg bg-raised px-4 py-3 text-sm text-muted">
          <IconClock width={16} height={16} className="text-brand" />
          {site.hours}
        </p>
      </Section>
      <CallToAction />
    </>
  );
}
