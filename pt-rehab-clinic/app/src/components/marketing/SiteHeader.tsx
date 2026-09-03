'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo, IconMenu, IconClose, IconArrow } from '@/components/icons';
import { site } from '@/lib/site';

const LINKS = [
  { href: '/services', label: 'Services' },
  { href: '/branches', label: 'Branches' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/85 backdrop-blur-md">
      <div className="shell flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <Logo className="h-8 w-8 shrink-0" />
          <span className="truncate text-sm sm:text-base">{site.name}</span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <a href={`tel:${site.phone.replace(/[^\d+]/g, '')}`} className="btn-secondary btn-sm ml-2">
            {site.phone}
          </a>
          <Link href="/login" className="btn-primary btn-sm">
            Staff sign in <IconArrow width={14} height={14} />
          </Link>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="btn-ghost ml-auto p-2 md:hidden"
        >
          {open ? <IconClose /> : <IconMenu />}
        </button>
      </div>

      {open && (
        <nav id="mobile-nav" className="border-t border-line bg-surface md:hidden" aria-label="Main">
          <div className="shell flex flex-col gap-1 py-3">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-raised hover:text-ink">
                {link.label}
              </Link>
            ))}
            <a href={`tel:${site.phone.replace(/[^\d+]/g, '')}`} className="btn-secondary mt-2">
              Call {site.phone}
            </a>
            <Link href="/login" className="btn-primary" onClick={() => setOpen(false)}>
              Staff sign in
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
