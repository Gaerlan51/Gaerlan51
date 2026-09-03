'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  Logo, IconChart, IconCalendar, IconUsers, IconClock, IconBell, IconLog,
  IconMenu, IconClose,
} from '@/components/icons';
import type { StaffRole } from '@/lib/types';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: IconChart, roles: ['owner', 'admin', 'therapist'] },
  { href: '/schedule', label: 'Schedule', icon: IconCalendar, roles: ['owner', 'admin', 'therapist'] },
  { href: '/patients', label: 'Patients', icon: IconUsers, roles: ['owner', 'admin', 'therapist'] },
  { href: '/followups', label: 'Follow-ups due', icon: IconClock, roles: ['owner', 'admin', 'therapist'] },
  { href: '/reminders', label: 'Reminders', icon: IconBell, roles: ['owner', 'admin'] },
  { href: '/audit', label: 'Audit log', icon: IconLog, roles: ['owner', 'admin'] },
] as const;

const ROLE_LABEL: Record<StaffRole, string> = {
  owner: 'Owner / Doctor',
  admin: 'Front desk',
  therapist: 'Therapist',
};

export interface NavStaff {
  full_name: string;
  role: StaffRole;
  clinic_name: string;
}

function NavLinks({ role, onNavigate }: { role: StaffRole; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {NAV.filter((item) => (item.roles as readonly string[]).includes(role)).map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? 'bg-brand/10 text-brand'
                  : 'text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function StaffCard({ staff }: { staff: NavStaff }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await supabaseBrowser().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  const initials = staff.full_name.split(' ').filter(Boolean).slice(0, 2)
    .map((part) => part[0]).join('').toUpperCase();

  return (
    <div className="rounded-xl border border-line bg-raised/60 p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-ink">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{staff.full_name}</p>
          <p className="truncate text-xs text-muted">{ROLE_LABEL[staff.role]}</p>
        </div>
      </div>
      <p className="mt-2.5 truncate text-xs text-muted" title={staff.clinic_name}>
        {staff.clinic_name}
      </p>
      <button onClick={signOut} disabled={busy} className="btn-secondary btn-sm mt-3 w-full">
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

/** Sidebar on large screens, disclosure menu below that. */
export function AppNav({ staff }: { staff: NavStaff }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2.5 px-1 font-semibold">
          <Logo className="h-8 w-8" />
          <span className="text-sm">Clinic Management</span>
        </Link>
        <nav aria-label="Sections" className="flex-1">
          <NavLinks role={staff.role} />
        </nav>
        <StaffCard staff={staff} />
      </aside>

      <header className="no-print sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold">
            <Logo className="h-7 w-7" /> Clinic
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="app-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="btn-ghost ml-auto p-2"
          >
            {open ? <IconClose /> : <IconMenu />}
          </button>
        </div>
        {open && (
          <div id="app-nav" className="border-t border-line p-4">
            <nav aria-label="Sections"><NavLinks role={staff.role} onNavigate={() => setOpen(false)} /></nav>
            <div className="mt-4"><StaffCard staff={staff} /></div>
          </div>
        )}
      </header>
    </>
  );
}
