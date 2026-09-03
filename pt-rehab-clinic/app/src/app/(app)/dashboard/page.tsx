import Link from 'next/link';
import { requireStaff, can } from '@/server/session';
import { dashboardStats } from '@/server/dashboard';
import type { Period } from '@/domain/period';
import { PageHeader, Card, Stat, Note, TableWrap, Badge } from '@/components/ui';
import { IconArrow } from '@/components/icons';

export const dynamic = 'force-dynamic';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

/**
 * Spec §11. Read-only by construction: this page renders counts and links
 * through to lists. src/server/dashboard.ts has no write path, so there is no
 * route by which the owner could edit another branch's record from here.
 */
export default async function DashboardPage({
  searchParams,
}: { searchParams: Promise<{ period?: string }> }) {
  const staff = await requireStaff();
  const period = ((await searchParams).period as Period) ?? 'month';
  const { rows, combined, from, to } = await dashboardStats(period);

  const fmt = (d: Date) => d.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' });
  const crossBranch = can.seeAllBranches(staff);

  return (
    <>
      <PageHeader
        title={crossBranch ? 'Owner Dashboard' : 'Branch Dashboard'}
        lead={`${fmt(from)} – ${fmt(to)}${crossBranch ? ' · all five branches' : ''}`}
        actions={
          <div role="group" aria-label="Reporting period"
               className="inline-flex rounded-lg border border-line bg-surface p-1">
            {PERIODS.map((p) => (
              <Link
                key={p.key}
                href={`/dashboard?period=${p.key}`}
                aria-current={period === p.key ? 'true' : undefined}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  period === p.key ? 'bg-brand text-brand-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Consultations" value={combined.consultations} />
        <Stat label="Sessions" value={combined.therapy_sessions} />
        <Stat label="Active patients" value={combined.active_patients} />
        <Stat label="New patients" value={combined.new_patients} />
        <Stat label="Follow-ups due" value={combined.followups_due}
              tone={combined.followups_due > 0 ? 'due' : undefined}
              hint="Awaiting MD review" />
        <Stat label="No-shows" value={combined.no_shows} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title={crossBranch ? 'By branch' : 'Your branch'}
          action={
            combined.followups_due > 0 ? (
              <Link href="/followups" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                Review follow-ups <IconArrow width={13} height={13} />
              </Link>
            ) : null
          }
        >
          <TableWrap minWidth={620}>
            <thead>
              <tr>
                <th className="th">Branch</th>
                <th className="th text-right">Consults</th>
                <th className="th text-right">Sessions</th>
                <th className="th text-right">Active</th>
                <th className="th text-right">New</th>
                <th className="th text-right">Due</th>
                <th className="th text-right">No-shows</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.clinic_id} className="transition hover:bg-raised/50">
                  <td className="td font-medium">{row.clinic_name}</td>
                  <td className="td text-right tabular-nums">{row.consultations}</td>
                  <td className="td text-right tabular-nums">{row.therapy_sessions}</td>
                  <td className="td text-right tabular-nums">{row.active_patients}</td>
                  <td className="td text-right tabular-nums">{row.new_patients}</td>
                  <td className="td text-right tabular-nums">
                    {row.followups_due > 0 ? (
                      <Link href="/followups" className="font-semibold text-caution hover:underline">
                        {row.followups_due}
                      </Link>
                    ) : <span className="text-muted">0</span>}
                  </td>
                  <td className="td text-right tabular-nums">{row.no_shows}</td>
                </tr>
              ))}
              {rows.length > 1 && (
                <tr className="bg-raised/60">
                  <td className="td font-semibold">All branches</td>
                  <td className="td text-right font-semibold tabular-nums">{combined.consultations}</td>
                  <td className="td text-right font-semibold tabular-nums">{combined.therapy_sessions}</td>
                  <td className="td text-right font-semibold tabular-nums">{combined.active_patients}</td>
                  <td className="td text-right font-semibold tabular-nums">{combined.new_patients}</td>
                  <td className="td text-right font-semibold tabular-nums">{combined.followups_due}</td>
                  <td className="td text-right font-semibold tabular-nums">{combined.no_shows}</td>
                </tr>
              )}
            </tbody>
          </TableWrap>

          {crossBranch && (
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Cross-branch view is read-only. Records are edited at the branch that owns them,
              so two people never edit the same chart from different places.
            </p>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Billing &amp; claims" action={<Badge>Phase 2</Badge>}>
            <Note>
              Outstanding claims value and cash collected vs. pending arrive with the claims
              tracker. They are shown as unavailable rather than as zero, so an empty figure
              is never mistaken for a real one.
            </Note>
          </Card>

          <Card title="Export">
            <p className="text-sm leading-relaxed text-muted text-pretty">
              Your branch data leaves in CSV at any time — nothing here is locked in.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['patients', 'appointments', 'encounters'].map((table) => (
                <a key={table} href={`/api/export/${table}`} className="btn-secondary btn-sm">
                  {table}.csv
                </a>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Every export is written to the audit log.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
