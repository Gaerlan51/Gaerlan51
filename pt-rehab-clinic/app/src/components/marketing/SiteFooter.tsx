import Link from 'next/link';
import { Logo, IconPhone, IconMail, IconClock } from '@/components/icons';
import { site, branches, services } from '@/lib/site';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="shell grid gap-10 py-14 md:grid-cols-4">
        <div className="md:col-span-1">
          <Link href="/" className="flex items-center gap-2.5 font-semibold">
            <Logo className="h-8 w-8" />
            {site.name}
          </Link>
          <p className="mt-3 text-sm leading-relaxed text-muted text-pretty">{site.tagline}.</p>
        </div>

        <div>
          <h2 className="text-sm font-semibold">Services</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {services.slice(0, 5).map((s) => (
              <li key={s.slug}>
                <Link href={`/services#${s.slug}`} className="hover:text-ink">{s.name}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-semibold">Branches</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {branches.map((b) => (
              <li key={b.id}>
                <Link href={`/branches#${b.id}`} className="hover:text-ink">
                  {b.name} — {b.area}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-semibold">Get in touch</h2>
          <ul className="mt-3 space-y-2.5 text-sm text-muted">
            <li className="flex items-center gap-2">
              <IconPhone width={16} height={16} />
              <a href={`tel:${site.phone.replace(/[^\d+]/g, '')}`} className="hover:text-ink">{site.phone}</a>
            </li>
            <li className="flex items-center gap-2">
              <IconMail width={16} height={16} />
              <a href={`mailto:${site.email}`} className="hover:text-ink">{site.email}</a>
            </li>
            <li className="flex items-start gap-2">
              <IconClock width={16} height={16} className="mt-0.5 shrink-0" />
              <span>{site.hours}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="shell flex flex-col gap-3 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {site.name}. All rights reserved.</p>
          <p className="text-pretty">
            Health information is handled under the Data Privacy Act (RA 10173). This site is
            general information, not medical advice.
          </p>
          <Link href="/login" className="font-medium hover:text-ink">Staff sign in</Link>
        </div>
      </div>
    </footer>
  );
}
