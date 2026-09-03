import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { currentStaff } from '@/server/session';

export const metadata: Metadata = {
  title: 'Clinic Management — PT Rehab Network',
  description: 'Staff-facing clinic management for a five-branch rehabilitation practice.',
};

const NAV = [
  { href: '/dashboard', label: 'Dashboard', roles: ['owner', 'admin', 'therapist'] },
  { href: '/schedule', label: 'Schedule', roles: ['owner', 'admin', 'therapist'] },
  { href: '/patients', label: 'Patients', roles: ['owner', 'admin', 'therapist'] },
  { href: '/followups', label: 'Follow-ups due', roles: ['owner', 'admin', 'therapist'] },
  { href: '/reminders', label: 'Reminders', roles: ['owner', 'admin'] },
  { href: '/audit', label: 'Audit log', roles: ['owner', 'admin'] },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();

  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <Link href="/dashboard" className="text-sm font-semibold text-brand">
                PT Rehab Network
              </Link>
              {staff && (
                <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {NAV.filter((i) => i.roles.includes(staff.role)).map((item) => (
                    <Link key={item.href} href={item.href} className="text-slate-600 hover:text-brand">
                      {item.label}
                    </Link>
                  ))}
                </nav>
              )}
              {staff && (
                <p className="ml-auto text-xs text-slate-500">
                  {staff.full_name} · <span className="capitalize">{staff.role}</span>
                </p>
              )}
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
