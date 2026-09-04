import Link from 'next/link';
import {
  Hero, PayerStrip, PracticeBand, Section, ServicesGrid, CareModel, BranchGrid, Faq,
  CallToAction,
} from '@/components/marketing/sections';
import { IconArrow } from '@/components/icons';

export default function HomePage() {
  return (
    <>
      <Hero />
      <PayerStrip />

      <Section
        eyebrow="What we treat"
        title="Seven disciplines, one coordinated plan"
        lead="You are not handed between unrelated clinics. The physician who assesses you writes the plan, and the therapists work to it."
      >
        <ServicesGrid />
        <div className="mt-8">
          <Link href="/services" className="btn-secondary">
            More about each service <IconArrow width={16} height={16} />
          </Link>
        </div>
      </Section>

      <PracticeBand />

      <div className="border-y border-line bg-surface">
        <Section
          eyebrow="How care works"
          title="Progress gets checked, not assumed"
          lead="Rehabilitation drifts when nobody is counting. We schedule the doctor's review into the plan from the first day."
        >
          <CareModel />
        </Section>
      </div>

      <Section
        eyebrow="Where to find us"
        title="Five branches, each with its own team"
        lead="Your care stays at one branch so one team remains responsible for it. Call the branch nearest you to book."
      >
        <BranchGrid />
      </Section>

      <div className="border-y border-line bg-surface">
        <Section eyebrow="Before you come in" title="Questions we are asked most">
          <div className="max-w-3xl"><Faq /></div>
        </Section>
      </div>

      <CallToAction />
    </>
  );
}
