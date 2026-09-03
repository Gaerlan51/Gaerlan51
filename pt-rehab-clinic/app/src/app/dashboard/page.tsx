import Link from 'next/link';
import { requireStaff, can } from '@/server/session';
import { dashboardStats } from '@/server/dashboard';
import type { Period } from '@/domain/period';
import { Card, Stat, Badge } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Spec §11. Read-only: the page renders counts and links through to lists.
 * There is no edit affordance anywhere on another branch's data, and no write
 * path exists in src/server/dashboard.ts to reach one.
 */
export default async function DashboardPage({
  searchParams,
}: { searchParams: Promise<{ period?: string }> }) {
  const staff = await requireStaff();
  const period = ((await searchParams).period as Period) ?? 'month';
  const { rows, combined, from, to } = await dashboardStats(period);

  const range = `${from.toLocaleDateString('en-PH')} – ${to.toLocaleDateString('en-PH')}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            {can.seeAllBranches(staff) ? 'Owner Dashboard' : 'Branch Dashboard'}
          </h1>
          <p className="text-sm text-slate-500">{range}</p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/dashboard?period=week" className={period === 'week' ? 'btn-primary' : 'btn-ghost'}>
            This week
          </Link>
          <Link href="/dashboard?period=month" className={period === 'month' ? 'btn-primary' : 'btn-ghost'}>
            This month
          </Link>
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Consultations" value={combined.consultations} />
        <Stat label="Therapy sessions" value={combined.therapy_sessions} />
        <Stat label="Active patients" value={combined.active_patients} />
        <Stat label="New patients" value={combined.new_patients} />
        <Stat label="Follow-ups due" value={combined.followups_due} hint="Needs an MD review" />
        <Stat label="No-shows" value={combined.no_shows} />
      </div>

      <Card title={can.seeAllBranches(staff) ? 'By branch' : 'Your branch'}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className="th">Branch</th>
                <th className="th">Consults</th>
                <th className="th">Sessions</th>
                <th className="th">Active</th>
                <th className="th">New</th>
                <th className="th">Follow-ups due</th>
                <th className="th">No-shows</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.clinic_id}>
                  <td className="td font-medium">{row.clinic_name}</td>
                  <td className="td tabular-nums">{row.consultations}</td>
                  <td className="td tabular-nums">{row.therapy_sessions}</td>
                  <td className="td tabular-nums">{row.active_patients}</td>
                  <td className="td tabular-nums">{row.new_patients}</td>
                  <td className="td tabular-nums">
                    {row.followups_due > 0
                      ? <Link href="/followups" className="text-brand underline">{row.followups_due}</Link>
                      : 0}
                  </td>
                  <td className="td tabular-nums">{row.no_shows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can.seeAllBranches(staff) && (
          <p className="mt-3 text-xs text-slate-500">
            Cross-branch view is read-only. Records are edited at the branch that owns them.
          </p>
        )}
      </Card>

      <Card title="Billing and claims">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="neutral">Available in Phase 2</Badge>
          <p className="text-sm text-slate-600">
            Outstanding claims value and cash collected vs. pending arrive with the claims
            tracker. They are shown as unavailable rather than as zero, so nobody reads an
            empty figure as a real one.
          </p>
        </div>
      </Card>
    </div>
  );
}
